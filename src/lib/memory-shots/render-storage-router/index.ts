import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decryptGoogleToken } from "@/lib/server/google-token";
import {
  ensureGoogleDriveMediaFolders,
  refreshGoogleDriveAccessToken,
  uploadBufferToGoogleDrive,
} from "@/lib/storage/google-drive";
import type { MemoryShotRenderStorageProvider } from "../types";

const fallbackBucket = "memory-shot-renders";
const signedUrlTtlSeconds = 60 * 60 * 24 * 7;

type RenderKind = "original" | "preview" | "thumbnail";

type UploadRenderInput = {
  supabase: SupabaseClient;
  journeyId: string;
  memoryShotId: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
  width?: number;
  height?: number;
};

type RenderUploadResult = {
  provider: MemoryShotRenderStorageProvider;
  path: string;
  url: string | null;
  driveFileId?: string | null;
  driveUrl?: string | null;
  warning?: string | null;
  metadata?: Record<string, unknown>;
};

type StorageConnectionRow = {
  token_reference: string | null;
  journey_folder_id: string | null;
  metadata: {
    mediaFolders?: {
      originals?: { id?: string; folderId?: string; name?: string };
      thumbnails?: { id?: string; folderId?: string; name?: string };
      ai?: { id?: string; folderId?: string; name?: string };
    };
  } | null;
};

function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function folderId(folder?: { id?: string; folderId?: string } | null) {
  return folder?.id ?? folder?.folderId ?? null;
}

function renderPath(input: UploadRenderInput, kind: RenderKind) {
  return `${input.journeyId}/${input.memoryShotId}/${kind}/${input.filename}`;
}

function warningMessage(provider: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `${provider} unavailable, used Supabase fallback. ${message}`;
}

function mediaWorkerUrls() {
  const primaryUrl = process.env.MEDIA_WORKER_URL?.replace(/\/$/, "");
  if (!primaryUrl) return [];

  const urls = [
    primaryUrl,
    process.env.MEDIA_WORKER_FALLBACK_URL?.replace(/\/$/, ""),
    process.env.AI_SERVER_URL
      ? `${process.env.AI_SERVER_URL.replace(/\/$/, "")}/media`
      : null,
  ].filter((url): url is string => Boolean(url));

  return [...new Set(urls)];
}

async function uploadToSupabaseFallback(
  input: UploadRenderInput,
  kind: RenderKind,
): Promise<RenderUploadResult> {
  const path = renderPath(input, kind);
  const { error: uploadError } = await input.supabase.storage
    .from(fallbackBucket)
    .upload(path, input.buffer, {
      contentType: input.contentType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data, error: signedUrlError } = await input.supabase.storage
    .from(fallbackBucket)
    .createSignedUrl(path, signedUrlTtlSeconds);

  if (signedUrlError || !data?.signedUrl) {
    throw signedUrlError || new Error("Could not create render signed URL.");
  }

  return {
    provider: "supabase_fallback",
    path,
    url: data.signedUrl,
    metadata: {
      bucket: fallbackBucket,
      width: input.width ?? null,
      height: input.height ?? null,
    },
  };
}

async function loadGoogleDriveConnection(journeyId: string) {
  const serviceSupabase = getServiceSupabase();
  if (!serviceSupabase) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const { data, error } = await serviceSupabase
    .from("journey_storage_connections")
    .select("token_reference, journey_folder_id, metadata")
    .eq("trip_id", journeyId)
    .eq("provider", "google_drive")
    .eq("status", "connected")
    .maybeSingle();

  if (error) throw error;
  if (!data?.token_reference) {
    throw new Error("Google Drive is not connected for this Journey.");
  }

  return {
    serviceSupabase,
    connection: data as StorageConnectionRow,
  };
}

async function ensureRenderDriveFolder(input: {
  supabase: SupabaseClient;
  journeyId: string;
  connection: StorageConnectionRow;
  accessToken: string;
}) {
  const existingAiFolder = folderId(input.connection.metadata?.mediaFolders?.ai);
  if (existingAiFolder) return existingAiFolder;
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
    .eq("trip_id", input.journeyId)
    .eq("provider", "google_drive")
    .eq("status", "connected");

  if (error) throw error;
  return folders.ai.id;
}

async function uploadOriginalToGoogleDrive(
  input: UploadRenderInput,
): Promise<RenderUploadResult> {
  const { serviceSupabase, connection } = await loadGoogleDriveConnection(
    input.journeyId,
  );
  const accessToken = await refreshGoogleDriveAccessToken(
    decryptGoogleToken(connection.token_reference as string),
  );
  const folderIdValue = await ensureRenderDriveFolder({
    supabase: serviceSupabase,
    journeyId: input.journeyId,
    connection,
    accessToken,
  });
  const uploaded = await uploadBufferToGoogleDrive({
    accessToken,
    folderId: folderIdValue,
    buffer: input.buffer,
    filename: input.filename,
    mimeType: input.contentType,
  });

  return {
    provider: "google_drive",
    path: uploaded.name,
    url: null,
    driveFileId: uploaded.id,
    driveUrl: uploaded.webViewLink ?? null,
    metadata: {
      fileId: uploaded.id,
      webViewLink: uploaded.webViewLink ?? null,
      webContentLink: uploaded.webContentLink ?? null,
      folderId: folderIdValue,
      width: input.width ?? null,
      height: input.height ?? null,
    },
  };
}

async function uploadToMediaServer(
  input: UploadRenderInput,
  kind: Extract<RenderKind, "preview" | "thumbnail">,
): Promise<RenderUploadResult> {
  const workerSecret = process.env.MEDIA_WORKER_SECRET;
  const workerUrls = mediaWorkerUrls();
  if (workerUrls.length === 0 || !workerSecret) {
    throw new Error("MEDIA_WORKER_URL and MEDIA_WORKER_SECRET are required.");
  }

  const path = renderPath(input, kind);
  const form = new FormData();
  form.append("path", path);
  form.append("kind", kind);
  form.append("journeyId", input.journeyId);
  form.append("memoryShotId", input.memoryShotId);
  form.append(
    "file",
    new Blob([new Uint8Array(input.buffer)], { type: input.contentType }),
    input.filename,
  );

  let lastError: unknown = null;
  for (const workerUrl of workerUrls) {
    try {
      const response = await fetch(`${workerUrl}/memory-shots/renders`, {
        method: "POST",
        headers: {
          "x-media-worker-secret": workerSecret,
        },
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        path?: string;
        error?: string;
        detail?: string;
      };

      if (!response.ok || !payload.url) {
        throw new Error(
          payload.error || payload.detail || "Media worker render upload failed.",
        );
      }

      return {
        provider: "media_server",
        path: payload.path ?? path,
        url: payload.url,
        metadata: {
          width: input.width ?? null,
          height: input.height ?? null,
          workerUrl,
        },
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "Could not upload Memory Shot render to media worker.",
  );
}

export async function uploadOriginalRender(
  input: UploadRenderInput,
): Promise<RenderUploadResult> {
  try {
    return await uploadOriginalToGoogleDrive(input);
  } catch (error) {
    const fallback = await uploadToSupabaseFallback(input, "original");
    return {
      ...fallback,
      warning: warningMessage("google_drive", error),
    };
  }
}

export async function uploadPreviewRender(
  input: UploadRenderInput,
): Promise<RenderUploadResult> {
  try {
    return await uploadToMediaServer(input, "preview");
  } catch (error) {
    const fallback = await uploadToSupabaseFallback(input, "preview");
    return {
      ...fallback,
      warning: warningMessage("media_server", error),
    };
  }
}

export async function uploadThumbnailRender(
  input: UploadRenderInput,
): Promise<RenderUploadResult> {
  try {
    return await uploadToMediaServer(input, "thumbnail");
  } catch (error) {
    const fallback = await uploadToSupabaseFallback(input, "thumbnail");
    return {
      ...fallback,
      warning: warningMessage("media_server", error),
    };
  }
}

export type { RenderUploadResult, UploadRenderInput };
