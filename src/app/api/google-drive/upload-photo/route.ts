import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { generateHetznerMediaVariants } from "@/lib/server/media-worker";
import { decryptGoogleToken } from "@/lib/server/google-token";
import {
  ensureGoogleDriveFolder,
  ensureGoogleDriveMediaFolders,
  refreshGoogleDriveAccessToken,
  uploadBufferToGoogleDrive,
} from "@/lib/storage/google-drive";

export const runtime = "nodejs";
export const maxDuration = 60;

const GOOGLE_DRIVE_RECONNECT_REQUIRED_MESSAGE =
  "Google Drive 连接已失效，请到行程设置重新连接云盘后再上传。";

type StorageConnectionRow = {
  token_reference: string | null;
  journey_folder_id: string | null;
  metadata: {
    dayFolders?: { date: string; folderId: string; name: string }[];
    outsideJourneyFolder?: { folderId: string; name: string };
    mediaFolders?: {
      originals?: { id?: string; folderId?: string; name?: string };
      thumbnails?: { id?: string; folderId?: string; name?: string };
      ai?: { id?: string; folderId?: string; name?: string };
      outsideJourneyDates?: { id?: string; folderId?: string; name?: string };
    };
  } | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isGoogleDriveTokenExpiredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /token has been expired or revoked|invalid_grant|expired|revoked/i.test(
    message,
  );
}

async function markGoogleDriveConnectionError(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  metadata: Record<string, unknown> | null;
  reason: string;
}) {
  const metadata = {
    ...(input.metadata ?? {}),
    health: {
      status: "error",
      checkedAt: new Date().toISOString(),
      reason: input.reason,
    },
  };
  await Promise.allSettled([
    input.supabase
      .from("journey_storage_connections")
      .update({ status: "error", metadata })
      .eq("trip_id", input.tripId)
      .eq("provider", "google_drive"),
    input.supabase
      .from("trips")
      .update({ photo_storage_status: "error" })
      .eq("id", input.tripId),
  ]);
}

function getSupabaseForRequest(request: Request) {
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
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function safeOriginalFileName(fileName: string) {
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${baseName || "photo"}${extension || ".jpg"}`;
}

async function ensureMediaFolders(input: {
  accessToken: string;
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  connection: StorageConnectionRow;
}) {
  if (!input.connection.journey_folder_id) {
    throw new Error("Google Drive journey folder was not found.");
  }

  const existing = input.connection.metadata?.mediaFolders;
  const hasAllFolders =
    existing?.originals &&
    existing?.thumbnails &&
    existing?.ai &&
    existing?.outsideJourneyDates;

  if (hasAllFolders) {
    return existing;
  }

  const folders = await ensureGoogleDriveMediaFolders({
    accessToken: input.accessToken,
    journeyFolderId: input.connection.journey_folder_id,
  });
  const metadata = {
    ...(input.connection.metadata ?? {}),
    mediaFolders: {
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

  if (error) {
    throw error;
  }

  return metadata.mediaFolders;
}

function folderId(folder?: { id?: string; folderId?: string } | null) {
  return folder?.id ?? folder?.folderId ?? null;
}

async function getUploadFolderId(input: {
  accessToken: string;
  parentFolderId: string;
  capturedDate: string | null;
  outsideJourney: boolean;
}) {
  if (input.outsideJourney || !input.capturedDate) return input.parentFolderId;
  const folder = await ensureGoogleDriveFolder({
    accessToken: input.accessToken,
    name: input.capturedDate,
    parentFolderId: input.parentFolderId,
  });
  return folder.id;
}

function isOutsideJourneyDates(
  capturedDate: string | null,
  trip: { start_date: string | null; end_date: string | null },
) {
  if (!capturedDate || !trip.start_date || !trip.end_date) return false;
  return capturedDate < trip.start_date || capturedDate > trip.end_date;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const tripId = String(form.get("tripId") ?? "");
    const memoryEntryId = String(form.get("memoryEntryId") ?? "");
    const mediaAssetId = String(form.get("mediaAssetId") ?? "");
    const capturedDate = String(form.get("capturedDate") ?? "") || null;
    const file = form.get("file");

    if (!tripId || !memoryEntryId || !mediaAssetId || !(file instanceof File)) {
      return jsonError("Missing original photo upload fields.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data: memory, error: memoryError } = await supabase
      .from("memory_entries")
      .select("id, trip_id, user_id")
      .eq("id", memoryEntryId)
      .eq("trip_id", tripId)
      .single();

    if (memoryError || !memory) {
      return jsonError("Photo memory was not found.", 404);
    }

    if (memory.user_id !== userData.user.id) {
      return jsonError("Only the uploader can attach this original photo.", 403);
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("start_date, end_date")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return jsonError("Journey was not found.", 404);
    }

    const { data: connection, error: connectionError } = await supabase
      .from("journey_storage_connections")
      .select("token_reference, journey_folder_id, metadata")
      .eq("trip_id", tripId)
      .eq("provider", "google_drive")
      .eq("status", "connected")
      .maybeSingle();

    if (connectionError) {
      throw connectionError;
    }

    if (!connection?.token_reference) {
      return jsonError("Google Drive is not connected for original uploads.", 409);
    }

    const connectionRow = connection as StorageConnectionRow;
    const refreshToken = decryptGoogleToken(connection.token_reference);
    let accessToken: string;
    try {
      accessToken = await refreshGoogleDriveAccessToken(refreshToken);
    } catch (refreshError) {
      await markGoogleDriveConnectionError({
        supabase,
        tripId,
        metadata: connectionRow.metadata ?? null,
        reason:
          refreshError instanceof Error ? refreshError.message : "Could not refresh token.",
      });
      if (isGoogleDriveTokenExpiredError(refreshError)) {
        return jsonError(GOOGLE_DRIVE_RECONNECT_REQUIRED_MESSAGE, 409);
      }
      throw refreshError;
    }
    const mediaFolders = await ensureMediaFolders({
      accessToken,
      supabase,
      tripId,
      connection: connectionRow,
    });
    const outsideJourney = isOutsideJourneyDates(capturedDate, trip);
    const originalParentFolderId = outsideJourney
      ? folderId(mediaFolders.outsideJourneyDates)
      : folderId(mediaFolders.originals);

    if (!originalParentFolderId) {
      throw new Error("Google Drive media folders were not found.");
    }
    const originalFolderId = await getUploadFolderId({
      accessToken,
      parentFolderId: originalParentFolderId,
      capturedDate,
      outsideJourney,
    });

    const originalBuffer = Buffer.from(await file.arrayBuffer());
    const image = sharp(originalBuffer, { failOn: "none" }).rotate();
    const metadata = await image.metadata();
    const safeName = safeOriginalFileName(file.name);

    const uploadedOriginal = await uploadBufferToGoogleDrive({
      accessToken,
      folderId: originalFolderId,
      buffer: originalBuffer,
      mimeType:
        file.type || (metadata.format ? `image/${metadata.format}` : "application/octet-stream"),
      filename: `${Date.now()}-${safeOriginalFileName(file.name)}`,
    });
    const variants = await generateHetznerMediaVariants({
      journeyId: tripId,
      assetId: mediaAssetId,
      filename: safeName,
      mimeType:
        file.type || (metadata.format ? `image/${metadata.format}` : "application/octet-stream"),
      originalBuffer,
    });

    const { error: updateError } = await supabase
      .from("media_assets")
      .update({
        storage_provider: "google_drive",
        storage_bucket: "google-drive",
        provider_file_id: uploadedOriginal.id,
        provider_web_url: uploadedOriginal.webViewLink ?? null,
        provider_thumbnail_url: variants.thumbnail.url,
        provider_original_reference: uploadedOriginal.webContentLink ?? null,
        original_drive_file_id: uploadedOriginal.id,
        original_drive_web_url: uploadedOriginal.webViewLink ?? null,
        thumbnail_drive_file_id: null,
        thumbnail_drive_web_url: null,
        original_file_size: file.size,
        thumbnail_url: variants.thumbnail.url,
        preview_url: variants.preview.url,
        thumbnail_size: variants.thumbnail.file_size,
        original_file_path: uploadedOriginal.name,
        compressed_file_path: null,
        thumbnail_file_path: null,
        compressed_file_size: null,
        mime_type: file.type || uploadedOriginal.mimeType || null,
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        thumbnail_width: variants.thumbnail.width ?? null,
        thumbnail_height: variants.thumbnail.height ?? null,
        thumbnail_generated_at: new Date().toISOString(),
        preview_generated_at: new Date().toISOString(),
        is_original_preserved: true,
        ai_status: "pending",
        processing_status: "ready",
      })
      .eq("id", mediaAssetId)
      .eq("memory_entry_id", memoryEntryId)
      .eq("trip_id", tripId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      originalDriveFileId: uploadedOriginal.id,
      originalDriveWebUrl: uploadedOriginal.webViewLink ?? null,
      thumbnailDriveFileId: null,
      thumbnailDriveWebUrl: variants.thumbnail.url,
      thumbnailUrl: variants.thumbnail.url,
      previewUrl: variants.preview.url,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      thumbnailSize: variants.thumbnail.file_size,
      previewSize: variants.preview.file_size,
    });
  } catch (error) {
    if (isGoogleDriveTokenExpiredError(error)) {
      return jsonError(GOOGLE_DRIVE_RECONNECT_REQUIRED_MESSAGE, 409);
    }

    const message =
      error instanceof Error ? error.message : "Could not upload original photo.";
    return jsonError(message, 500);
  }
}
