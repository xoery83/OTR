import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { decryptGoogleToken } from "@/lib/server/google-token";
import {
  ensureGoogleDriveMediaFolders,
  googleDriveImageViewUrl,
  makeGoogleDriveFileReadableByLink,
  refreshGoogleDriveAccessToken,
  uploadBufferToGoogleDrive,
} from "@/lib/storage/google-drive";

export const runtime = "nodejs";
export const maxDuration = 60;

type MigrateRequest = {
  tripId?: string;
  assetIds?: string[];
  dryRun?: boolean;
  limit?: number;
};

type MediaAssetRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  compressed_file_path: string | null;
  thumbnail_file_path: string | null;
  thumbnail_drive_file_id: string | null;
  provider_web_url: string | null;
  original_drive_file_id: string | null;
  original_drive_web_url: string | null;
  mime_type: string | null;
};

type StorageConnectionRow = {
  token_reference: string | null;
  journey_folder_id: string | null;
  metadata: {
    mediaFolders?: {
      originals?: { id?: string; folderId?: string; name?: string };
      thumbnails?: { id?: string; folderId?: string; name?: string };
    };
  } | null;
};

const bucketName = "trip-media";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getRequestSupabase(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !supabaseAnonKey) throw new Error("Missing Supabase env.");
  if (!authorization) throw new Error("Missing authorization header.");

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(Math.floor(parsed), 25));
}

function normalizeAssetIds(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.length > 0),
    ),
  ].slice(0, limit);
}

function folderId(folder?: { id?: string; folderId?: string } | null) {
  return folder?.id ?? folder?.folderId ?? null;
}

async function authorizeTrip(input: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}) {
  const [{ data: profile }, { data: trip }, { data: member }] = await Promise.all([
    input.supabase
      .from("profiles")
      .select("account_role")
      .eq("id", input.userId)
      .maybeSingle(),
    input.supabase
      .from("trips")
      .select("created_by")
      .eq("id", input.tripId)
      .maybeSingle(),
    input.supabase
      .from("journey_members")
      .select("role")
      .eq("trip_id", input.tripId)
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);
  const isAdmin =
    (profile as { account_role?: string | null } | null)?.account_role === "admin";
  const isCreator = (trip as { created_by?: string | null } | null)?.created_by === input.userId;
  const isOwner = (member as { role?: string | null } | null)?.role === "owner";
  return isAdmin || isCreator || isOwner;
}

async function loadCandidates(input: {
  supabase: SupabaseClient;
  tripId: string;
  assetIds: string[];
  limit: number;
}) {
  let query = input.supabase
    .from("media_assets")
    .select(
      "id, trip_id, user_id, compressed_file_path, thumbnail_file_path, thumbnail_drive_file_id, provider_web_url, original_drive_file_id, original_drive_web_url, mime_type",
    )
    .eq("trip_id", input.tripId)
    .eq("asset_type", "image")
    .not("compressed_file_path", "is", null)
    .or(
      "thumbnail_drive_file_id.is.null,provider_web_url.is.null,original_drive_web_url.is.null,original_drive_file_id.is.null",
    )
    .order("created_at", { ascending: true })
    .limit(input.limit);

  if (input.assetIds.length > 0) query = query.in("id", input.assetIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MediaAssetRow[];
}

async function ensureMediaFolders(input: {
  supabase: SupabaseClient;
  connection: StorageConnectionRow;
  tripId: string;
  accessToken: string;
}) {
  const existingOriginals = folderId(input.connection.metadata?.mediaFolders?.originals);
  const existingThumbnails = folderId(input.connection.metadata?.mediaFolders?.thumbnails);
  if (existingOriginals && existingThumbnails) {
    return { originalsFolderId: existingOriginals, thumbnailsFolderId: existingThumbnails };
  }
  if (!input.connection.journey_folder_id) {
    throw new Error("Google Drive journey folder was not found.");
  }

  const folders = await ensureGoogleDriveMediaFolders({
    accessToken: input.accessToken,
    journeyFolderId: input.connection.journey_folder_id,
  });
  const metadata = {
    ...(input.connection.metadata ?? {}),
    mediaFolders: {
      ...(input.connection.metadata?.mediaFolders ?? {}),
      originals: folders.originals,
      thumbnails: folders.thumbnails,
      ai: folders.ai,
      outsideJourneyDates: folders.outsideJourneyDates,
    },
  };
  const { error } = await input.supabase
    .from("journey_storage_connections")
    .update({ metadata })
    .eq("trip_id", input.tripId)
    .eq("provider", "google_drive")
    .eq("status", "connected");
  if (error) throw error;
  return {
    originalsFolderId: folders.originals.id,
    thumbnailsFolderId: folders.thumbnails.id,
  };
}

function filenameFromStoragePath(pathValue: string, fallback: string) {
  const name = pathValue.split("/").pop()?.trim();
  return name || fallback;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as MigrateRequest;
    const limit = normalizeLimit(body.limit);
    const assetIds = normalizeAssetIds(body.assetIds, limit);
    const tripId = typeof body.tripId === "string" ? body.tripId : "";
    const dryRun = body.dryRun !== false;

    if (!tripId) return jsonError("tripId is required.", 400);

    const requestSupabase = getRequestSupabase(request);
    const serviceSupabase = getServiceSupabase();
    if (!serviceSupabase) return jsonError("Service role key is not configured.", 500);

    const { data: userData, error: userError } = await requestSupabase.auth.getUser();
    if (userError || !userData.user) return jsonError("You must be logged in.", 401);
    const authorized = await authorizeTrip({
      supabase: requestSupabase,
      userId: userData.user.id,
      tripId,
    });
    if (!authorized) return jsonError("You cannot migrate this Journey.", 403);

    const { data: connection, error: connectionError } = await serviceSupabase
      .from("journey_storage_connections")
      .select("token_reference, journey_folder_id, metadata")
      .eq("trip_id", tripId)
      .eq("provider", "google_drive")
      .eq("status", "connected")
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.token_reference) {
      return jsonError("Google Drive is not connected for this Journey.", 409);
    }

    const candidates = await loadCandidates({
      supabase: serviceSupabase,
      tripId,
      assetIds,
      limit,
    });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        candidates: candidates.map((asset) => ({
          assetId: asset.id,
          sourcePath: asset.thumbnail_file_path ?? asset.compressed_file_path,
          needsOriginal:
            !asset.provider_web_url ||
            !asset.original_drive_web_url ||
            !asset.original_drive_file_id,
          needsThumbnail: !asset.thumbnail_drive_file_id,
        })),
      });
    }

    const accessToken = await refreshGoogleDriveAccessToken(
      decryptGoogleToken(connection.token_reference),
    );
    const { originalsFolderId, thumbnailsFolderId } = await ensureMediaFolders({
      supabase: serviceSupabase,
      connection: connection as StorageConnectionRow,
      tripId,
      accessToken,
    });

    const results = [];
    for (const asset of candidates) {
      const originalSourcePath = asset.compressed_file_path;
      const thumbnailSourcePath = asset.thumbnail_file_path ?? asset.compressed_file_path;
      if (!originalSourcePath || !thumbnailSourcePath) {
        results.push({ assetId: asset.id, status: "skipped", error: "Missing source path." });
        continue;
      }

      try {
        const { data: originalBlob, error: originalDownloadError } = await serviceSupabase.storage
          .from(bucketName)
          .download(originalSourcePath);
        if (originalDownloadError || !originalBlob) {
          throw originalDownloadError || new Error("Download failed.");
        }
        const originalBuffer = Buffer.from(await originalBlob.arrayBuffer());
        const update: Record<string, unknown> = {
          storage_provider: "google_drive",
          storage_bucket: "google-drive",
          legacy_supabase_path: asset.compressed_file_path,
          legacy_thumbnail_path: asset.thumbnail_file_path,
          processing_status: "legacy",
        };
        const result: Record<string, unknown> = {
          assetId: asset.id,
          status: "processed",
        };

        if (
          !asset.provider_web_url ||
          !asset.original_drive_web_url ||
          !asset.original_drive_file_id
        ) {
          const uploadedOriginal = await uploadBufferToGoogleDrive({
            accessToken,
            folderId: originalsFolderId,
            buffer: originalBuffer,
            filename: `${Date.now()}-${asset.id}-${filenameFromStoragePath(
              originalSourcePath,
              "legacy-photo.jpg",
            )}`,
            mimeType: asset.mime_type || originalBlob.type || "image/jpeg",
          });
          update.provider_file_id = uploadedOriginal.id;
          update.provider_web_url = uploadedOriginal.webViewLink ?? null;
          update.provider_original_reference = uploadedOriginal.webContentLink ?? null;
          update.original_drive_file_id = uploadedOriginal.id;
          update.original_drive_web_url = uploadedOriginal.webViewLink ?? null;
          update.original_file_path = uploadedOriginal.name;
          update.original_file_size = Number(uploadedOriginal.size) || originalBuffer.length;
          update.is_original_preserved = true;
          result.originalDriveWebUrl = uploadedOriginal.webViewLink ?? null;
        }

        if (!asset.thumbnail_drive_file_id) {
          const { data: thumbnailBlob } =
            asset.thumbnail_file_path && asset.thumbnail_file_path !== asset.compressed_file_path
              ? await serviceSupabase.storage
                  .from(bucketName)
                  .download(asset.thumbnail_file_path)
              : { data: null };
          const thumbnailSourceBuffer = thumbnailBlob
            ? Buffer.from(await thumbnailBlob.arrayBuffer())
            : originalBuffer;
          const thumbnailBuffer = await sharp(thumbnailSourceBuffer, { failOn: "none" })
            .rotate()
            .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 78 })
            .toBuffer();
          const metadata = await sharp(thumbnailBuffer).metadata();
          const uploadedThumbnail = await uploadBufferToGoogleDrive({
            accessToken,
            folderId: thumbnailsFolderId,
            buffer: thumbnailBuffer,
            filename: `${Date.now()}-${asset.id}-thumbnail.webp`,
            mimeType: "image/webp",
          });
          await makeGoogleDriveFileReadableByLink({
            accessToken,
            fileId: uploadedThumbnail.id,
          });
          const thumbnailUrl = googleDriveImageViewUrl(uploadedThumbnail.id);
          update.thumbnail_drive_file_id = uploadedThumbnail.id;
          update.thumbnail_drive_web_url = thumbnailUrl;
          update.provider_thumbnail_url = thumbnailUrl;
          update.thumbnail_size = thumbnailBuffer.length;
          update.thumbnail_width = metadata.width ?? null;
          update.thumbnail_height = metadata.height ?? null;
          result.thumbnailDriveWebUrl = thumbnailUrl;
        }

        const { error: updateError } = await serviceSupabase
          .from("media_assets")
          .update(update)
          .eq("id", asset.id);
        if (updateError) throw updateError;
        results.push(result);
      } catch (error) {
        results.push({
          assetId: asset.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Migration failed.",
        });
      }
    }

    return NextResponse.json({ dryRun: false, processed: results.length, results });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Migration failed.", 500);
  }
}
