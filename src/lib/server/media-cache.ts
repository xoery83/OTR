import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { decryptGoogleToken } from "@/lib/server/google-token";
import { refreshGoogleDriveAccessToken } from "@/lib/storage/google-drive";

const execFileAsync = promisify(execFile);

export type MediaVariantType = "thumbnail" | "preview";

type MediaAssetRow = {
  id: string;
  trip_id: string;
  original_drive_file_id: string | null;
  provider_file_id: string | null;
  mime_type: string | null;
};

type VariantRow = {
  id: string;
  media_asset_id: string;
  variant_type: MediaVariantType;
  relative_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  file_size: number;
  generated_at: string;
  last_accessed_at: string;
};

const variantConfig: Record<
  MediaVariantType,
  { maxDimension: number; quality: number; retentionDays: number | null }
> = {
  thumbnail: { maxDimension: 420, quality: 72, retentionDays: null },
  preview: { maxDimension: 1280, quality: 78, retentionDays: 90 },
};

export function getMediaCacheRoot() {
  return path.resolve(
    process.env.MEDIA_CACHE_DIR ??
      path.join(/* turbopackIgnore: true */ process.cwd(), ".media-cache"),
  );
}

function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase service environment variables.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function variantRelativePath(input: {
  tripId: string;
  mediaAssetId: string;
  variantType: MediaVariantType;
}) {
  return path.join(
    input.tripId,
    input.mediaAssetId.slice(0, 2),
    input.mediaAssetId,
    `${input.variantType}.webp`,
  );
}

function absoluteVariantPath(relativePath: string) {
  const root = getMediaCacheRoot();
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid media cache path.");
  }
  return resolved;
}

export async function getDiskUsagePercent() {
  const root = getMediaCacheRoot();
  await mkdir(root, { recursive: true });

  if (process.env.MEDIA_CACHE_DISK_USAGE_OVERRIDE) {
    return Number(process.env.MEDIA_CACHE_DISK_USAGE_OVERRIDE);
  }

  try {
    const { stdout } = await execFileAsync("df", ["-Pk", root]);
    const lines = stdout.trim().split(/\n/);
    const fields = lines[lines.length - 1]?.split(/\s+/) ?? [];
    const value = fields[4]?.replace("%", "");
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

async function downloadDriveOriginal(input: {
  supabase: SupabaseClient;
  asset: MediaAssetRow;
}) {
  const fileId = input.asset.original_drive_file_id ?? input.asset.provider_file_id;
  if (!fileId) throw new Error("Media asset has no Google Drive original.");

  const { data: connection, error } = await input.supabase
    .from("journey_storage_connections")
    .select("token_reference")
    .eq("trip_id", input.asset.trip_id)
    .eq("provider", "google_drive")
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw error;
  if (!connection?.token_reference) {
    throw new Error("Google Drive is not connected for this Journey.");
  }

  const accessToken = await refreshGoogleDriveAccessToken(
    decryptGoogleToken(connection.token_reference),
  );
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error(await response.text() || "Could not download Google Drive original.");
  }

  return Buffer.from(await response.arrayBuffer());
}

async function upsertVariantRecord(input: {
  supabase: SupabaseClient;
  mediaAssetId: string;
  variantType: MediaVariantType;
  relativePath: string;
  width: number | null;
  height: number | null;
  fileSize: number;
}) {
  const { data, error } = await input.supabase
    .from("media_asset_variants")
    .upsert(
      {
        media_asset_id: input.mediaAssetId,
        variant_type: input.variantType,
        storage_provider: "hetzner_disk",
        relative_path: input.relativePath,
        mime_type: "image/webp",
        width: input.width,
        height: input.height,
        file_size: input.fileSize,
        generated_at: new Date().toISOString(),
        last_accessed_at: new Date().toISOString(),
      },
      { onConflict: "media_asset_id,variant_type" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as VariantRow;
}

export async function generateMediaVariantFromBuffer(input: {
  supabase?: SupabaseClient;
  mediaAssetId: string;
  tripId: string;
  sourceBuffer: Buffer;
  variantType: MediaVariantType;
}) {
  const supabase = getServiceSupabase();
  const config = variantConfig[input.variantType];
  const output = await sharp(input.sourceBuffer, { failOn: "none" })
    .rotate()
    .resize({
      width: config.maxDimension,
      height: config.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: config.quality })
    .toBuffer();
  const metadata = await sharp(output).metadata();
  const relativePath = variantRelativePath({
    tripId: input.tripId,
    mediaAssetId: input.mediaAssetId,
    variantType: input.variantType,
  });
  const absolutePath = absoluteVariantPath(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, output);

  return upsertVariantRecord({
    supabase,
    mediaAssetId: input.mediaAssetId,
    variantType: input.variantType,
    relativePath,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    fileSize: output.length,
  });
}

export async function getOrGenerateMediaVariant(input: {
  mediaAssetId: string;
  variantType: MediaVariantType;
}) {
  const supabase = getServiceSupabase();
  const diskUsage = await getDiskUsagePercent();

  const { data: existing } = await supabase
    .from("media_asset_variants")
    .select("*")
    .eq("media_asset_id", input.mediaAssetId)
    .eq("variant_type", input.variantType)
    .maybeSingle();

  if (existing) {
    const row = existing as VariantRow;
    const absolutePath = absoluteVariantPath(row.relative_path);
    try {
      await stat(absolutePath);
      await supabase
        .from("media_asset_variants")
        .update({ last_accessed_at: new Date().toISOString() })
        .eq("id", row.id);
      return { row, buffer: await readFile(absolutePath), diskUsage };
    } catch {
      await supabase.from("media_asset_variants").delete().eq("id", row.id);
    }
  }

  if (input.variantType === "preview" && diskUsage >= 85) {
    throw new Error("Preview generation is temporarily disabled because disk usage is high.");
  }

  if (input.variantType === "preview" && diskUsage >= 70) {
    await cleanupMediaCache({ targetDiskUsagePercent: 70 });
  }

  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("id, trip_id, original_drive_file_id, provider_file_id, mime_type")
    .eq("id", input.mediaAssetId)
    .eq("asset_type", "image")
    .single();

  if (error || !asset) {
    throw error || new Error("Media asset was not found.");
  }

  const sourceBuffer = await downloadDriveOriginal({
    supabase,
    asset: asset as MediaAssetRow,
  });
  const row = await generateMediaVariantFromBuffer({
    supabase,
    mediaAssetId: input.mediaAssetId,
    tripId: (asset as MediaAssetRow).trip_id,
    sourceBuffer,
    variantType: input.variantType,
  });

  return {
    row,
    buffer: await readFile(absoluteVariantPath(row.relative_path)),
    diskUsage,
  };
}

export async function cleanupMediaCache(input?: {
  targetDiskUsagePercent?: number;
  previewRetentionDays?: number;
}) {
  const supabase = getServiceSupabase();
  const retentionDays = input?.previewRetentionDays ?? 90;
  const target = input?.targetDiskUsagePercent ?? 70;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deleted: string[] = [];

  async function deleteRows(rows: VariantRow[]) {
    for (const row of rows) {
      if (row.variant_type !== "preview") continue;
      await rm(absoluteVariantPath(row.relative_path), { force: true });
      await supabase.from("media_asset_variants").delete().eq("id", row.id);
      deleted.push(row.id);
    }
  }

  const { data: expiredRows, error: expiredError } = await supabase
    .from("media_asset_variants")
    .select("*")
    .eq("variant_type", "preview")
    .lt("last_accessed_at", cutoff)
    .order("last_accessed_at", { ascending: true })
    .limit(500);
  if (expiredError) throw expiredError;
  await deleteRows((expiredRows ?? []) as VariantRow[]);

  let diskUsage = await getDiskUsagePercent();
  while (diskUsage > target) {
    const { data: rows, error } = await supabase
      .from("media_asset_variants")
      .select("*")
      .eq("variant_type", "preview")
      .order("last_accessed_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    const batch = (rows ?? []) as VariantRow[];
    if (batch.length === 0) break;
    await deleteRows(batch);
    diskUsage = await getDiskUsagePercent();
  }

  return {
    deletedCount: deleted.length,
    diskUsagePercent: diskUsage,
    host: os.hostname(),
  };
}
