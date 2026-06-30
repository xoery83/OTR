import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

type BackfillRequest = {
  tripId?: string;
  assetIds?: string[];
  limit?: number;
  dryRun?: boolean;
};

type MediaAssetRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  compressed_file_path: string | null;
  thumbnail_file_path: string | null;
};

type BackfillResult = {
  assetId: string;
  status: "processed" | "skipped" | "failed" | "dry_run";
  compressedPath: string | null;
  thumbnailPath: string | null;
  error?: string;
};

const bucketName = "trip-media";
const thumbnailMaxDimension = 480;
const thumbnailJpegQuality = 72;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `code: ${record.code}` : null,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  return fallback;
}

function getRequestSupabase(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }
  if (!authorization) {
    throw new Error("Missing authorization header.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

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

function thumbnailPathFor(asset: MediaAssetRow) {
  const sourcePath = asset.compressed_file_path;
  if (!sourcePath) return null;
  const filename = sourcePath.split("/").pop() || `${asset.id}.jpg`;
  return `${asset.trip_id}/${asset.user_id ?? "unknown"}/thumbnails/backfill/${asset.id}-${filename}`;
}

async function getAuthorization(input: {
  supabase: SupabaseClient;
  userId: string;
  tripId?: string;
}) {
  const { data: profile, error: profileError } = await input.supabase
    .from("profiles")
    .select("account_role")
    .eq("id", input.userId)
    .maybeSingle();

  if (profileError) throw profileError;
  const isAdmin =
    (profile as { account_role?: string | null } | null)?.account_role === "admin";
  if (isAdmin) return { isAdmin, canBackfillTrip: true };

  if (!input.tripId) return { isAdmin, canBackfillTrip: false };

  const [{ data: trip }, { data: member }] = await Promise.all([
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

  const isCreator =
    (trip as { created_by?: string | null } | null)?.created_by === input.userId;
  const isOwner = (member as { role?: string | null } | null)?.role === "owner";
  return { isAdmin, canBackfillTrip: isCreator || isOwner };
}

async function loadCandidates(input: {
  supabase: SupabaseClient;
  tripId?: string;
  assetIds?: string[];
  limit: number;
}) {
  let query = input.supabase
    .from("media_assets")
    .select("id, trip_id, user_id, compressed_file_path, thumbnail_file_path")
    .eq("asset_type", "image")
    .is("thumbnail_file_path", null)
    .not("compressed_file_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(input.limit);

  if (input.tripId) {
    query = query.eq("trip_id", input.tripId);
  }
  if (input.assetIds && input.assetIds.length > 0) {
    query = query.in("id", input.assetIds);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as MediaAssetRow[];
}

async function getAccessibleAssetIds(input: {
  supabase: SupabaseClient;
  assetIds: string[];
}) {
  if (input.assetIds.length === 0) return [];

  const { data, error } = await input.supabase
    .from("media_assets")
    .select("id")
    .in("id", input.assetIds);

  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

async function countRemaining(input: {
  supabase: SupabaseClient;
  tripId?: string;
}) {
  let query = input.supabase
    .from("media_assets")
    .select("id", { count: "exact", head: true })
    .eq("asset_type", "image")
    .is("thumbnail_file_path", null)
    .not("compressed_file_path", "is", null);

  if (input.tripId) {
    query = query.eq("trip_id", input.tripId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function backfillAsset(
  supabase: SupabaseClient,
  asset: MediaAssetRow,
): Promise<BackfillResult> {
  const compressedPath = asset.compressed_file_path;
  const thumbnailPath = thumbnailPathFor(asset);
  if (!compressedPath || !thumbnailPath) {
    return {
      assetId: asset.id,
      status: "skipped",
      compressedPath,
      thumbnailPath,
      error: "Missing source or thumbnail path.",
    };
  }

  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(compressedPath);
    if (downloadError || !fileBlob) {
      throw downloadError || new Error("Could not download compressed image.");
    }

    const sourceBuffer = Buffer.from(await fileBlob.arrayBuffer());
    const thumbnailBuffer = await sharp(sourceBuffer, { failOn: "none" })
      .rotate()
      .resize({
        width: thumbnailMaxDimension,
        height: thumbnailMaxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: thumbnailJpegQuality, mozjpeg: true })
      .toBuffer();

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(thumbnailPath, thumbnailBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { error: updateError } = await supabase
      .from("media_assets")
      .update({ thumbnail_file_path: thumbnailPath })
      .eq("id", asset.id)
      .is("thumbnail_file_path", null);
    if (updateError) throw updateError;

    return {
      assetId: asset.id,
      status: "processed",
      compressedPath,
      thumbnailPath,
    };
  } catch (error) {
    return {
      assetId: asset.id,
      status: "failed",
      compressedPath,
      thumbnailPath,
      error: errorMessage(error, "Could not backfill thumbnail."),
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BackfillRequest;
    const tripId = typeof body.tripId === "string" && body.tripId ? body.tripId : undefined;
    const limit = normalizeLimit(body.limit);
    const requestedAssetIds = normalizeAssetIds(body.assetIds, limit);
    const dryRun = Boolean(body.dryRun);

    const requestSupabase = getRequestSupabase(request);
    const { data: userData, error: userError } = await requestSupabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    let assetIds = requestedAssetIds;
    if (requestedAssetIds.length > 0) {
      assetIds = await getAccessibleAssetIds({
        supabase: requestSupabase,
        assetIds: requestedAssetIds,
      });
      if (assetIds.length === 0) {
        return jsonError("No accessible media assets were found.", 404);
      }
    } else {
      const authorization = await getAuthorization({
        supabase: requestSupabase,
        userId: userData.user.id,
        tripId,
      });
      if (!tripId && !authorization.isAdmin) {
        return jsonError("tripId is required unless you are a system admin.", 400);
      }
      if (tripId && !authorization.canBackfillTrip) {
        return jsonError("Only journey owners or system admins can backfill thumbnails.", 403);
      }
    }

    const serviceSupabase = getServiceSupabase();
    if (!serviceSupabase) {
      return jsonError("SUPABASE_SERVICE_ROLE_KEY is required for thumbnail backfill.", 500);
    }

    const candidates = await loadCandidates({
      supabase: serviceSupabase,
      tripId,
      assetIds,
      limit,
    });

    if (dryRun) {
      const remaining = await countRemaining({ supabase: serviceSupabase, tripId });
      return NextResponse.json({
        dryRun: true,
        limit,
        requestedAssetIds: assetIds,
        remaining,
        candidates: candidates.map((asset) => ({
          assetId: asset.id,
          compressedPath: asset.compressed_file_path,
          thumbnailPath: thumbnailPathFor(asset),
        })),
      });
    }

    const results: BackfillResult[] = [];
    for (const asset of candidates) {
      results.push(await backfillAsset(serviceSupabase, asset));
    }
    const remaining = await countRemaining({ supabase: serviceSupabase, tripId });

    return NextResponse.json({
      dryRun: false,
      limit,
      requestedAssetIds: assetIds,
      processed: results.filter((result) => result.status === "processed").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      remaining,
      done: remaining === 0,
      results,
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not backfill thumbnails."), 500);
  }
}
