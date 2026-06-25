import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { decryptGoogleToken } from "@/lib/server/google-token";
import {
  createGoogleDriveFolder,
  refreshGoogleDriveAccessToken,
  uploadOriginalPhotoToGoogleDrive,
} from "@/lib/storage/google-drive";

type StorageConnectionRow = {
  token_reference: string | null;
  journey_folder_id: string | null;
  metadata: {
    dayFolders?: { date: string; folderId: string; name: string }[];
    outsideJourneyFolder?: { folderId: string; name: string };
  } | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

function getDayFolderId(
  connection: StorageConnectionRow,
  capturedDate: string | null,
) {
  const dayFolder = capturedDate
    ? connection.metadata?.dayFolders?.find((folder) => folder.date === capturedDate)
    : null;

  return dayFolder?.folderId ?? null;
}

async function getOrCreateOutsideJourneyFolder(input: {
  accessToken: string;
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  connection: StorageConnectionRow;
}) {
  const existing = input.connection.metadata?.outsideJourneyFolder;

  if (existing?.folderId) {
    return existing.folderId;
  }

  if (!input.connection.journey_folder_id) {
    throw new Error("Google Drive journey folder was not found.");
  }

  const folder = await createGoogleDriveFolder({
    accessToken: input.accessToken,
    name: "Outside Journey Dates",
    parentFolderId: input.connection.journey_folder_id,
  });
  const metadata = {
    ...(input.connection.metadata ?? {}),
    outsideJourneyFolder: {
      folderId: folder.id,
      name: folder.name,
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

  return folder.id;
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

    const refreshToken = decryptGoogleToken(connection.token_reference);
    const accessToken = await refreshGoogleDriveAccessToken(refreshToken);
    const connectionRow = connection as StorageConnectionRow;
    const folderId =
      getDayFolderId(connectionRow, capturedDate) ??
      (await getOrCreateOutsideJourneyFolder({
        accessToken,
        supabase,
        tripId,
        connection: connectionRow,
      }));

    const uploaded = await uploadOriginalPhotoToGoogleDrive({
      accessToken,
      folderId,
      file,
      filename: `${Date.now()}-${safeOriginalFileName(file.name)}`,
    });

    const { error: updateError } = await supabase
      .from("media_assets")
      .update({
        storage_provider: "google_drive",
        provider_file_id: uploaded.id,
        provider_web_url: uploaded.webViewLink ?? null,
        provider_thumbnail_url: uploaded.thumbnailLink ?? null,
        provider_original_reference: uploaded.webContentLink ?? null,
        original_file_size: file.size,
        original_file_path: uploaded.name,
        mime_type: file.type || uploaded.mimeType || null,
        is_original_preserved: true,
        ai_status: "pending",
      })
      .eq("id", mediaAssetId)
      .eq("memory_entry_id", memoryEntryId)
      .eq("trip_id", tripId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      fileId: uploaded.id,
      webViewLink: uploaded.webViewLink ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not upload original photo.";
    return jsonError(message, 500);
  }
}
