import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  generateHetznerMediaVariants,
  processHetznerVideo,
  type MediaWorkerVideoProcessResponse,
} from "@/lib/server/media-worker";
import { decryptGoogleToken } from "@/lib/server/google-token";
import {
  ensureGoogleDriveFolder,
  ensureGoogleDriveMediaFolders,
  refreshGoogleDriveAccessToken,
  uploadBufferToGoogleDrive,
} from "@/lib/storage/google-drive";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_VIDEO_FILES = 5;
const RECOMMENDED_VIDEO_BYTES = 100 * 1024 * 1024;
const HARD_VIDEO_BYTES = 300 * 1024 * 1024;
const RECOMMENDED_VIDEO_SECONDS = 30;
const HARD_VIDEO_SECONDS = 120;
const GOOGLE_DRIVE_RECONNECT_REQUIRED_MESSAGE =
  "Google Drive 连接已失效，请到行程设置重新连接云盘后再上传。";

const RESERVED_VIDEO_JOB_TYPES = [
  "video_thumbnail",
  "video_preview_transcode",
  "video_clip_extract",
  "video_metadata_extract",
] as const;

type StorageConnectionRow = {
  token_reference: string | null;
  journey_folder_id: string | null;
  metadata: {
    mediaFolders?: {
      originals?: { id?: string; folderId?: string; name?: string };
      thumbnails?: { id?: string; folderId?: string; name?: string };
      ai?: { id?: string; folderId?: string; name?: string };
      outsideJourneyDates?: { id?: string; folderId?: string; name?: string };
    };
  } | null;
};

type ClientFileMetadata = {
  name?: string;
  size?: number;
  type?: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  lastModified?: number | null;
};

type UploadResult = {
  id: string;
  assetType: "image" | "video";
  fileName: string;
  mimeType: string | null;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  driveFileId: string;
  driveUrl: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  warnings: string[];
};

function videoAiMetadata(input: {
  processing?: MediaWorkerVideoProcessResponse | null;
  durationSeconds: number | null;
  fileName: string;
  fileSize: number;
  lastModified: number | null;
  warnings: string[];
  processingError: string | null;
}) {
  return {
    video: input.processing
      ? {
          metadata: input.processing.metadata,
          thumbnail: input.processing.thumbnail,
          thumbnails: input.processing.thumbnails,
          preview: input.processing.preview,
        }
      : null,
    capture2: {
      version: "preview",
      entryPoint: "upload_media",
      originalStorage: "google_drive",
      durationSeconds:
        input.processing?.metadata.duration_seconds ?? input.durationSeconds,
      fileName: input.fileName,
      fileSizeBytes: input.fileSize,
      lastModified: input.lastModified,
      warnings: input.warnings,
      processingError: input.processingError,
      reservedJobTypes: RESERVED_VIDEO_JOB_TYPES,
    },
  };
}

async function enqueueVideoFaceJobs(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  userId: string;
  assetId: string;
  tripId: string;
  locale?: string | null;
}) {
  const payload = {
    tripId: input.tripId,
    mediaAssetId: input.assetId,
    locale: input.locale === "zh-CN" ? "zh-CN" : "en",
  };
  const jobs = [
    {
      journey_id: input.tripId,
      user_id: input.userId,
      job_type: "face_detection",
      title: "Face detection",
      current_step: "Queued",
      payload,
    },
    {
      journey_id: input.tripId,
      user_id: input.userId,
      job_type: "face_recognition",
      title: "Face recognition",
      current_step: "Queued",
      payload,
    },
  ];

  const { data: existingJobs, error: existingError } = await input.supabase
    .from("background_jobs")
    .select("job_type")
    .eq("journey_id", input.tripId)
    .in("job_type", ["face_detection", "face_recognition"])
    .contains("payload", { mediaAssetId: input.assetId });
  if (existingError) throw existingError;

  const existingTypes = new Set(
    (existingJobs ?? []).map((job) => (job as { job_type?: string }).job_type),
  );
  const missingJobs = jobs.filter((job) => !existingTypes.has(job.job_type));
  if (missingJobs.length === 0) return;

  const { error } = await input.supabase.from("background_jobs").insert(missingJobs);
  if (error && error.code !== "23505") throw error;
}

async function getCurrentJourneyMemberId(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  userId: string;
}) {
  const { data } = await input.supabase
    .from("journey_members")
    .select("id")
    .eq("trip_id", input.tripId)
    .eq("user_id", input.userId)
    .maybeSingle();

  return (data as { id?: string } | null)?.id ?? null;
}

async function upsertMediaChatMessage(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  userId: string;
  journeyMemberId: string | null;
  assetId: string;
  memoryId: string;
  mediaUrl: string;
  capturedAt: string;
  createdAt: string;
  originalFileName: string;
}) {
  const { error } = await input.supabase.from("journey_chat_messages").upsert(
    {
      trip_id: input.tripId,
      user_id: input.userId,
      journey_member_id: input.journeyMemberId,
      message_type: "image",
      text_content: null,
      media_asset_id: input.assetId,
      memory_entry_id: input.memoryId,
      media_url: input.mediaUrl,
      source_type: "timeline_memory",
      source_id: input.memoryId,
      created_at: input.createdAt,
      metadata: {
        capturedAt: input.capturedAt,
        originalFileName: input.originalFileName,
        syncedFrom: "capture2_media_upload",
      },
    },
    { onConflict: "trip_id,source_type,source_id", ignoreDuplicates: true },
  );

  if (error && error.code !== "23505") throw error;
}

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

function parseClientMetadata(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ClientFileMetadata[]) : [];
  } catch {
    return [];
  }
}

function safeMediaFileName(fileName: string, fallback: "photo" | "video") {
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${baseName || fallback}${extension}`;
}

function folderId(folder?: { id?: string; folderId?: string } | null) {
  return folder?.id ?? folder?.folderId ?? null;
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

  if (hasAllFolders) return existing;

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

  if (error) throw error;
  return metadata.mediaFolders;
}

async function getUploadFolderId(input: {
  accessToken: string;
  parentFolderId: string;
  capturedDate: string | null;
}) {
  if (!input.capturedDate) return input.parentFolderId;
  const folder = await ensureGoogleDriveFolder({
    accessToken: input.accessToken,
    name: input.capturedDate,
    parentFolderId: input.parentFolderId,
  });
  return folder.id;
}

function mediaKind(file: File) {
  if (file.type.startsWith("image/")) return "image" as const;
  if (file.type.startsWith("video/")) return "video" as const;
  return null;
}

function videoWarnings(file: File, metadata: ClientFileMetadata) {
  const warnings: string[] = [];
  const durationSeconds =
    typeof metadata.durationSeconds === "number" && Number.isFinite(metadata.durationSeconds)
      ? metadata.durationSeconds
      : null;

  if (file.size > RECOMMENDED_VIDEO_BYTES) {
    warnings.push("建议上传 100MB 以内短视频，方便后续整理。");
  }
  if (durationSeconds !== null && durationSeconds > RECOMMENDED_VIDEO_SECONDS) {
    warnings.push("建议上传 30 秒以内短视频，方便后续整理。");
  }
  return warnings;
}

function videoHardLimitMessage(file: File, metadata: ClientFileMetadata) {
  if (file.size > HARD_VIDEO_BYTES) {
    return "视频超过 300MB 硬限制，请选择更短的视频。";
  }
  const durationSeconds =
    typeof metadata.durationSeconds === "number" && Number.isFinite(metadata.durationSeconds)
      ? metadata.durationSeconds
      : null;
  if (durationSeconds !== null && durationSeconds > HARD_VIDEO_SECONDS) {
    return "视频超过 2 分钟硬限制，请选择更短的视频。";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const tripId = String(form.get("tripId") ?? "");
    const capturedAt = String(form.get("capturedAt") || new Date().toISOString());
    const timezone = String(form.get("timezone") || "");
    const clientMetadata = parseClientMetadata(form.get("fileMetadata"));
    const files = form.getAll("files").filter((file): file is File => file instanceof File);

    if (!tripId) return jsonError("tripId is required.", 400);
    if (files.length === 0) return jsonError("At least one file is required.", 400);

    const videoCount = files.filter((file) => mediaKind(file) === "video").length;
    if (videoCount > MAX_VIDEO_FILES) {
      return jsonError("一次最多上传 5 个视频。", 413);
    }

    for (const [index, file] of files.entries()) {
      const kind = mediaKind(file);
      if (!kind) {
        return jsonError(`不支持的文件类型：${file.name || `file-${index + 1}`}`, 400);
      }
      if (kind === "video") {
        const hardLimit = videoHardLimitMessage(file, clientMetadata[index] ?? {});
        if (hardLimit) return jsonError(hardLimit, 413);
      }
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return jsonError("Journey not found.", 404);
    }
    const journeyMemberId = await getCurrentJourneyMemberId({
      supabase,
      tripId,
      userId: userData.user.id,
    });

    const { data: connection, error: connectionError } = await supabase
      .from("journey_storage_connections")
      .select("token_reference, journey_folder_id, metadata")
      .eq("trip_id", tripId)
      .eq("provider", "google_drive")
      .eq("status", "connected")
      .maybeSingle();

    if (connectionError) throw connectionError;
    if (!connection?.token_reference) {
      return jsonError("Google Drive is not connected for Capture2 media uploads.", 409);
    }

    const refreshToken = decryptGoogleToken(connection.token_reference);
    let accessToken: string;
    try {
      accessToken = await refreshGoogleDriveAccessToken(refreshToken);
    } catch (refreshError) {
      await markGoogleDriveConnectionError({
        supabase,
        tripId,
        metadata: (connection as StorageConnectionRow).metadata ?? null,
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
      connection: connection as StorageConnectionRow,
    });
    const originalParentFolderId = folderId(mediaFolders.originals);
    if (!originalParentFolderId) {
      throw new Error("Google Drive Originals folder was not found.");
    }
    const originalFolderId = await getUploadFolderId({
      accessToken,
      parentFolderId: originalParentFolderId,
      capturedDate: capturedAt.slice(0, 10),
    });

    const results: UploadResult[] = [];

    for (const [index, file] of files.entries()) {
      const kind = mediaKind(file);
      if (!kind) continue;

      const assetId = randomUUID();
      const clientFile = clientMetadata[index] ?? {};
      const originalBuffer = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || clientFile.type || "application/octet-stream";
      const safeName = safeMediaFileName(file.name, kind === "image" ? "photo" : "video");
      const uploadedOriginal = await uploadBufferToGoogleDrive({
        accessToken,
        folderId: originalFolderId,
        buffer: originalBuffer,
        mimeType,
        filename: `${Date.now()}-${index + 1}-${safeName}`,
      });

      let width: number | null =
        typeof clientFile.width === "number" && Number.isFinite(clientFile.width)
          ? clientFile.width
          : null;
      let height: number | null =
        typeof clientFile.height === "number" && Number.isFinite(clientFile.height)
          ? clientFile.height
          : null;
      let thumbnailUrl: string | null = null;
      let previewUrl: string | null = null;
      let thumbnailSize: number | null = null;
      let previewSize: number | null = null;
      let thumbnailWidth: number | null = null;
      let thumbnailHeight: number | null = null;
      let processingStatus: "pending" | "ready" = kind === "image" ? "ready" : "pending";
      let processingError: string | null = null;
      let videoProcessing: MediaWorkerVideoProcessResponse | null = null;

      if (kind === "image") {
        const image = sharp(originalBuffer, { failOn: "none" }).rotate();
        const metadata = await image.metadata();
        width = metadata.width ?? width;
        height = metadata.height ?? height;

        try {
          const variants = await generateHetznerMediaVariants({
            journeyId: tripId,
            assetId,
            filename: safeName,
            mimeType,
            originalBuffer,
          });
          thumbnailUrl = variants.thumbnail.url;
          previewUrl = variants.preview.url;
          thumbnailSize = variants.thumbnail.file_size;
          previewSize = variants.preview.file_size;
          thumbnailWidth = variants.thumbnail.width;
          thumbnailHeight = variants.thumbnail.height;
        } catch (error) {
          processingStatus = "pending";
          processingError =
            error instanceof Error ? error.message : "Image variants were not generated.";
        }
      }

      const durationSeconds =
        kind === "video" &&
        typeof clientFile.durationSeconds === "number" &&
        Number.isFinite(clientFile.durationSeconds)
          ? clientFile.durationSeconds
          : null;
      const warnings = kind === "video" ? videoWarnings(file, clientFile) : [];

      if (kind === "video") {
        try {
          videoProcessing = await processHetznerVideo({
            journeyId: tripId,
            assetId,
            filename: safeName,
            mimeType,
            originalBuffer,
          });
          thumbnailUrl = videoProcessing.thumbnail.url;
          previewUrl = videoProcessing.preview.url;
          thumbnailSize = videoProcessing.thumbnail.file_size;
          previewSize = videoProcessing.preview.file_size;
          thumbnailWidth = videoProcessing.thumbnail.width;
          thumbnailHeight = videoProcessing.thumbnail.height;
          width = videoProcessing.metadata.width ?? width;
          height = videoProcessing.metadata.height ?? height;
          processingStatus = "ready";
        } catch (error) {
          processingStatus = "pending";
          processingError =
            error instanceof Error ? error.message : "Video preview was not generated.";
        }
      }

      const memoryId = kind === "video" ? randomUUID() : null;
      if (memoryId) {
        const { error: memoryError } = await supabase.from("memory_entries").insert({
          id: memoryId,
          trip_id: tripId,
          user_id: userData.user.id,
          type: "photo",
          content: null,
          media_url: `drive:${assetId}`,
          location_name: null,
          location_text: null,
          location_status: "none",
          captured_at: capturedAt,
        });

        if (memoryError) throw memoryError;
      }

      const { error: insertError } = await supabase.from("media_assets").insert({
        id: assetId,
        trip_id: tripId,
        user_id: userData.user.id,
        memory_entry_id: memoryId,
        asset_type: kind,
        storage_provider: "google_drive",
        storage_bucket: "google-drive",
        provider_file_id: uploadedOriginal.id,
        provider_web_url: uploadedOriginal.webViewLink ?? null,
        provider_thumbnail_url: thumbnailUrl,
        provider_original_reference: uploadedOriginal.webContentLink ?? null,
        original_drive_file_id: uploadedOriginal.id,
        original_drive_web_url: uploadedOriginal.webViewLink ?? null,
        original_file_size: file.size,
        original_file_path: uploadedOriginal.name,
        compressed_file_path: null,
        compressed_file_size: previewSize,
        thumbnail_file_path: null,
        thumbnail_url: thumbnailUrl,
        preview_url: previewUrl,
        thumbnail_size: thumbnailSize,
        mime_type: mimeType,
        width,
        height,
        thumbnail_width: thumbnailWidth,
        thumbnail_height: thumbnailHeight,
        storage_tier: "standard",
        is_original_preserved: true,
        processing_status: processingStatus,
        ai_status: "pending",
        ai_metadata:
          kind === "video"
            ? {
                source: "capture2_preview",
                memoryEntryId: memoryId,
                ...videoAiMetadata({
                  processing: videoProcessing,
                  durationSeconds,
                  fileName: file.name,
                  fileSize: file.size,
                  lastModified: clientFile.lastModified ?? file.lastModified ?? null,
                  warnings,
                  processingError,
                }),
              }
            : {
                source: "capture2_preview",
                capture2: {
                  version: "preview",
                  entryPoint: "upload_media",
                  originalStorage: "google_drive",
                  durationSeconds,
                  fileName: file.name,
                  fileSizeBytes: file.size,
                  lastModified: clientFile.lastModified ?? file.lastModified ?? null,
                  warnings,
                  processingError,
                  reservedJobTypes: [],
                },
              },
      });

      if (insertError) throw insertError;

      if (memoryId) {
        await upsertMediaChatMessage({
          supabase,
          tripId,
          userId: userData.user.id,
          journeyMemberId,
          assetId,
          memoryId,
          mediaUrl: `drive:${assetId}`,
          capturedAt,
          createdAt: capturedAt,
          originalFileName: file.name,
        }).catch((error) => {
          warnings.push(
            error instanceof Error ? error.message : "Video chat message was not created.",
          );
          return null;
        });
      }

      if (kind === "video" && thumbnailUrl) {
        await enqueueVideoFaceJobs({
          supabase,
          userId: userData.user.id,
          assetId,
          tripId,
          locale: request.headers.get("accept-language")?.startsWith("zh") ? "zh-CN" : "en",
        }).catch((error) => {
          warnings.push(
            error instanceof Error ? error.message : "Video face jobs were not queued.",
          );
          return null;
        });
      }

      results.push({
        id: assetId,
        assetType: kind,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
        width,
        height,
        durationSeconds,
        driveFileId: uploadedOriginal.id,
        driveUrl: uploadedOriginal.webViewLink ?? null,
        thumbnailUrl,
        previewUrl,
        warnings,
      });
    }

    const warnings = [...new Set(results.flatMap((asset) => asset.warnings))];

    return NextResponse.json({
      mediaAssetIds: results.map((asset) => asset.id),
      assets: results,
      warnings,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not upload Capture2 media.";
    return jsonError(message, 500);
  }
}
