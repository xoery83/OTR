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
    chatVoiceFolder?: { folderId: string; name: string };
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

function safeAudioFileName(fileName: string) {
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${baseName || "voice"}${extension || ".webm"}`;
}

async function getOrCreateChatVoiceFolder(input: {
  accessToken: string;
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  connection: StorageConnectionRow;
}) {
  const existing = input.connection.metadata?.chatVoiceFolder;

  if (existing?.folderId) {
    return existing.folderId;
  }

  if (!input.connection.journey_folder_id) {
    throw new Error("Google Drive journey folder was not found.");
  }

  const folder = await createGoogleDriveFolder({
    accessToken: input.accessToken,
    name: "Chat Voice",
    parentFolderId: input.connection.journey_folder_id,
  });
  const metadata = {
    ...(input.connection.metadata ?? {}),
    chatVoiceFolder: {
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

  if (error) throw error;
  return folder.id;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const tripId = String(form.get("tripId") ?? "");
    const mediaAssetId = String(form.get("mediaAssetId") ?? "");
    const file = form.get("file");

    if (!tripId || !mediaAssetId || !(file instanceof File)) {
      return jsonError("Missing voice upload fields.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data: media, error: mediaError } = await supabase
      .from("media_assets")
      .select("id, trip_id, user_id, asset_type")
      .eq("id", mediaAssetId)
      .eq("trip_id", tripId)
      .single();

    if (mediaError || !media) {
      return jsonError("Voice media asset was not found.", 404);
    }

    if (media.user_id !== userData.user.id || media.asset_type !== "audio") {
      return jsonError("Only the uploader can attach this voice file.", 403);
    }

    const { data: connection, error: connectionError } = await supabase
      .from("journey_storage_connections")
      .select("token_reference, journey_folder_id, metadata")
      .eq("trip_id", tripId)
      .eq("provider", "google_drive")
      .eq("status", "connected")
      .maybeSingle();

    if (connectionError) throw connectionError;

    if (!connection?.token_reference) {
      return jsonError("Google Drive is not connected for voice uploads.", 409);
    }

    const refreshToken = decryptGoogleToken(connection.token_reference);
    const accessToken = await refreshGoogleDriveAccessToken(refreshToken);
    const folderId = await getOrCreateChatVoiceFolder({
      accessToken,
      supabase,
      tripId,
      connection: connection as StorageConnectionRow,
    });

    const uploaded = await uploadOriginalPhotoToGoogleDrive({
      accessToken,
      folderId,
      file,
      filename: `${Date.now()}-${safeAudioFileName(file.name)}`,
    });

    const { error: updateError } = await supabase
      .from("media_assets")
      .update({
        storage_provider: "google_drive",
        provider_file_id: uploaded.id,
        provider_web_url: uploaded.webViewLink ?? null,
        provider_original_reference: uploaded.webContentLink ?? null,
        original_file_size: file.size,
        original_file_path: uploaded.name,
        mime_type: file.type || uploaded.mimeType || null,
        is_original_preserved: true,
      })
      .eq("id", mediaAssetId)
      .eq("trip_id", tripId);

    if (updateError) throw updateError;

    return NextResponse.json({
      fileId: uploaded.id,
      webViewLink: uploaded.webViewLink ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not upload voice to Google Drive.";
    return jsonError(message, 500);
  }
}
