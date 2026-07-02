import type {
  MemoryEntry,
  MediaAsset,
  PhotoAssetWithMemory,
  PhotoFace,
} from "@/types";
import type { Locale } from "@/lib/i18n/dictionaries";
import { supabase } from "./client";

export type CreateMediaAssetInput = {
  id: string;
  tripId: string;
  userId: string;
  memoryEntryId?: string | null;
  storageProvider?: MediaAsset["storageProvider"];
  storageBucket?: string;
  compressedFilePath?: string | null;
  compressedFileSize?: number | null;
  thumbnailFilePath?: string | null;
  originalDriveFileId?: string | null;
  originalDriveWebUrl?: string | null;
  thumbnailDriveFileId?: string | null;
  thumbnailDriveWebUrl?: string | null;
  thumbnailSize?: number | null;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
  processingStatus?: MediaAsset["processingStatus"];
  width: number;
  height: number;
  originalFileSize?: number | null;
  mimeType?: string | null;
  takenAt?: string | null;
  exifJson?: Record<string, unknown>;
  aiMetadata?: Record<string, unknown>;
};

type MediaAssetRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  memory_entry_id: string | null;
  asset_type: MediaAsset["assetType"];
  storage_provider?: MediaAsset["storageProvider"];
  storage_bucket: string;
  original_file_path: string | null;
  compressed_file_path: string | null;
  thumbnail_file_path: string | null;
  provider_file_id?: string | null;
  provider_drive_id?: string | null;
  provider_web_url?: string | null;
  provider_thumbnail_url?: string | null;
  provider_original_reference?: string | null;
  original_drive_file_id?: string | null;
  original_drive_web_url?: string | null;
  thumbnail_drive_file_id?: string | null;
  thumbnail_drive_web_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  original_file_size: number | null;
  compressed_file_size: number | null;
  thumbnail_size?: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  thumbnail_width?: number | null;
  thumbnail_height?: number | null;
  storage_tier: MediaAsset["storageTier"];
  is_original_preserved: boolean;
  retention_until: string | null;
  processing_status?: MediaAsset["processingStatus"];
  legacy_supabase_path?: string | null;
  legacy_thumbnail_path?: string | null;
  taken_at?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  camera_model?: string | null;
  orientation?: string | null;
  exif_json?: Record<string, unknown>;
  ai_status?: MediaAsset["aiStatus"];
  ai_metadata?: Record<string, unknown>;
  ocr_text?: string | null;
  duplicate_score?: number | null;
  blur_score?: number | null;
  scene_tags?: string[];
  indexed_at?: string | null;
  created_at: string;
};

const MEDIA_ASSET_SELECT =
  "id, trip_id, user_id, memory_entry_id, asset_type, storage_provider, storage_bucket, original_file_path, compressed_file_path, thumbnail_file_path, provider_file_id, provider_drive_id, provider_web_url, provider_thumbnail_url, provider_original_reference, original_drive_file_id, original_drive_web_url, thumbnail_drive_file_id, thumbnail_drive_web_url, thumbnail_url, preview_url, original_file_size, compressed_file_size, thumbnail_size, mime_type, width, height, thumbnail_width, thumbnail_height, storage_tier, is_original_preserved, retention_until, processing_status, legacy_supabase_path, legacy_thumbnail_path, taken_at, gps_latitude, gps_longitude, camera_model, orientation, exif_json, ai_status, ai_metadata, ocr_text, duplicate_score, blur_score, scene_tags, indexed_at, created_at";

type MemoryRow = {
  id: string;
  trip_id: string;
  trip_day_id: string | null;
  itinerary_event_id: string | null;
  itinerary_reservation_id: string | null;
  user_id: string | null;
  type: MemoryEntry["type"];
  content: string | null;
  media_url: string | null;
  location_name: string | null;
  captured_at: string;
  created_at: string;
};

type PhotoFaceRow = {
  id: string;
  media_asset_id: string;
  trip_id: string;
  journey_member_id: string | null;
  bounding_box: Record<string, unknown>;
  embedding: number[] | null;
  confidence: number | null;
  quality_score: number | null;
  recognition_status: PhotoFace["recognitionStatus"];
  recognized_name: string | null;
  model_name?: string | null;
  embedding_version?: string | null;
  created_at: string;
  updated_at: string;
};

const MEMORY_SELECT =
  "id, trip_id, trip_day_id, itinerary_event_id, itinerary_reservation_id, user_id, type, content, media_url, location_name, captured_at, created_at";

const PHOTO_FACE_SELECT =
  "id, media_asset_id, trip_id, journey_member_id, bounding_box, embedding, confidence, quality_score, recognition_status, recognized_name, model_name, embedding_version, created_at, updated_at";

function mapPhotoFace(row: PhotoFaceRow): PhotoFace {
  return {
    id: row.id,
    mediaAssetId: row.media_asset_id,
    tripId: row.trip_id,
    journeyMemberId: row.journey_member_id,
    boundingBox: row.bounding_box,
    embedding: row.embedding,
    confidence: row.confidence,
    qualityScore: row.quality_score,
    recognitionStatus: row.recognition_status,
    recognizedName: row.recognized_name,
    modelName: row.model_name ?? null,
    embeddingVersion: row.embedding_version ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    tripId: row.trip_id,
    tripDayId: row.trip_day_id,
    itineraryEventId: row.itinerary_event_id,
    itineraryReservationId: row.itinerary_reservation_id,
    userId: row.user_id ?? "",
    type: row.type,
    content: row.content ?? "",
    mediaUrl: row.media_url,
    locationName: row.location_name,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

function mapMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id ?? "",
    memoryEntryId: row.memory_entry_id ?? "",
    assetType: row.asset_type,
    storageProvider: row.storage_provider ?? "supabase_legacy",
    storageBucket: row.storage_bucket,
    originalFilePath: row.original_file_path,
    compressedFilePath: row.compressed_file_path,
    thumbnailFilePath: row.thumbnail_file_path,
    providerFileId: row.provider_file_id ?? null,
    providerDriveId: row.provider_drive_id ?? null,
    providerWebUrl: row.provider_web_url ?? null,
    providerThumbnailUrl: row.provider_thumbnail_url ?? null,
    providerOriginalReference: row.provider_original_reference ?? null,
    originalDriveFileId: row.original_drive_file_id ?? null,
    originalDriveWebUrl: row.original_drive_web_url ?? null,
    thumbnailDriveFileId: row.thumbnail_drive_file_id ?? null,
    thumbnailDriveWebUrl: row.thumbnail_drive_web_url ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    previewUrl: row.preview_url ?? null,
    originalFileSize: row.original_file_size,
    compressedFileSize: row.compressed_file_size,
    thumbnailSize: row.thumbnail_size ?? null,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    thumbnailWidth: row.thumbnail_width ?? null,
    thumbnailHeight: row.thumbnail_height ?? null,
    storageTier: row.storage_tier,
    isOriginalPreserved: row.is_original_preserved,
    retentionUntil: row.retention_until,
    processingStatus: row.processing_status ?? "pending",
    legacySupabasePath: row.legacy_supabase_path ?? null,
    legacyThumbnailPath: row.legacy_thumbnail_path ?? null,
    takenAt: row.taken_at ?? null,
    gpsLatitude: row.gps_latitude ?? null,
    gpsLongitude: row.gps_longitude ?? null,
    cameraModel: row.camera_model ?? null,
    orientation: row.orientation ?? null,
    exifJson: row.exif_json ?? {},
    aiStatus: row.ai_status ?? "pending",
    aiMetadata: row.ai_metadata ?? {},
    ocrText: row.ocr_text ?? null,
    duplicateScore: row.duplicate_score ?? null,
    blurScore: row.blur_score ?? null,
    sceneTags: row.scene_tags ?? [],
    indexedAt: row.indexed_at ?? null,
    createdAt: row.created_at,
  };
}

export async function repairCurrentUserOrphanPhotoMemories(tripId: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return 0;

  const { data: assetRows, error: assetError } = await supabase
    .from("media_assets")
    .select(MEDIA_ASSET_SELECT)
    .eq("trip_id", tripId)
    .eq("user_id", user.id)
    .eq("asset_type", "image")
    .is("memory_entry_id", null)
    .not("compressed_file_path", "is", null)
    .limit(50);

  if (assetError) return 0;

  let repaired = 0;
  for (const row of (assetRows ?? []) as MediaAssetRow[]) {
    if (!row.compressed_file_path) continue;

    const memoryId = crypto.randomUUID();
    const capturedAt = row.taken_at ?? row.created_at ?? new Date().toISOString();
    const metadata =
      row.ai_metadata && typeof row.ai_metadata === "object" ? row.ai_metadata : {};
    const dayId =
      typeof metadata.dayId === "string" ? metadata.dayId : null;

    const { error: memoryError } = await supabase.from("memory_entries").insert({
      id: memoryId,
      trip_id: tripId,
      user_id: user.id,
      trip_day_id: dayId,
      type: "photo",
      content: null,
      media_url: row.compressed_file_path,
      location_name: null,
      location_text: null,
      location_status: "none",
      captured_at: capturedAt,
    });

    if (memoryError) continue;

    const { error: updateError } = await supabase
      .from("media_assets")
      .update({
        memory_entry_id: memoryId,
        ai_metadata: {
          ...metadata,
          memoryEntryId: memoryId,
          repairedMemoryEntry: true,
        },
      })
      .eq("id", row.id)
      .is("memory_entry_id", null);

    if (!updateError) repaired += 1;
  }

  return repaired;
}

type MediaAssetDisplayFields = Pick<
  MediaAsset,
  | "id"
  | "assetType"
  | "compressedFilePath"
  | "thumbnailFilePath"
  | "legacySupabasePath"
  | "legacyThumbnailPath"
  | "thumbnailUrl"
  | "previewUrl"
  | "providerThumbnailUrl"
  | "thumbnailDriveWebUrl"
>;

type MediaAssetDriveLinkFields = Pick<
  MediaAsset,
  "providerWebUrl" | "originalDriveWebUrl" | "providerOriginalReference"
>;

export function getMediaAssetDriveUrl(asset: MediaAssetDriveLinkFields) {
  return (
    asset.providerWebUrl ??
    asset.originalDriveWebUrl ??
    asset.providerOriginalReference ??
    null
  );
}

export function getMediaAssetDisplayUrl(asset: MediaAssetDisplayFields) {
  if (asset.assetType === "video") {
    return (
      asset.thumbnailUrl ??
      asset.providerThumbnailUrl ??
      asset.thumbnailDriveWebUrl ??
      `/api/media/assets/${asset.id}/thumbnail`
    );
  }

  return (
    asset.thumbnailUrl ??
    asset.previewUrl ??
    asset.providerThumbnailUrl ??
    asset.thumbnailDriveWebUrl ??
    `/api/media/assets/${asset.id}/thumbnail`
  );
}

export function getMediaAssetPreviewUrl(asset: MediaAssetDisplayFields) {
  if (asset.assetType === "video") {
    return asset.previewUrl ?? asset.thumbnailUrl ?? `/api/media/assets/${asset.id}/thumbnail`;
  }

  return asset.previewUrl ?? `/api/media/assets/${asset.id}/preview`;
}

export function getMediaAssetLegacyDisplayPath(asset: MediaAssetDisplayFields) {
  return (
    asset.thumbnailFilePath ??
    asset.legacyThumbnailPath ??
    asset.compressedFilePath ??
    asset.legacySupabasePath ??
    null
  );
}

export async function getMediaAssetLegacySignedUrlById(
  assets: MediaAssetDisplayFields[],
) {
  const pathByAssetId = new Map<string, string>();
  const paths = [
    ...new Set(
      assets
        .map((asset) => {
          const path = getMediaAssetLegacyDisplayPath(asset);
          if (path) pathByAssetId.set(asset.id, path);
          return path;
        })
        .filter((path): path is string => Boolean(path)),
    ),
  ];

  if (paths.length === 0) return {};

  const { data, error } = await supabase.storage
    .from("trip-media")
    .createSignedUrls(paths, 60 * 60);

  if (error) {
    throw error;
  }

  const signedByPath = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) {
      signedByPath.set(item.path, item.signedUrl);
    }
  }

  return assets.reduce<Record<string, string>>((urls, asset) => {
    const path = pathByAssetId.get(asset.id);
    const signedUrl = path ? signedByPath.get(path) : undefined;
    if (signedUrl) urls[asset.id] = signedUrl;
    return urls;
  }, {});
}

export async function getTripPhotoAssets(
  tripId: string,
): Promise<PhotoAssetWithMemory[]> {
  const { data: assetRows, error: assetError } = await supabase
    .from("media_assets")
    .select(MEDIA_ASSET_SELECT)
    .eq("trip_id", tripId)
    .eq("asset_type", "image")
    .order("created_at", { ascending: false });

  if (assetError) {
    throw assetError;
  }

  const assets = ((assetRows ?? []) as MediaAssetRow[]).map(mapMediaAsset);
  const memoryIds = [
    ...new Set(assets.map((asset) => asset.memoryEntryId).filter(Boolean)),
  ];

  const memoriesById = new Map<string, MemoryEntry>();
  if (memoryIds.length > 0) {
    const { data: memoryRows, error: memoryError } = await supabase
      .from("memory_entries")
      .select(MEMORY_SELECT)
      .in("id", memoryIds);

    if (memoryError) {
      throw memoryError;
    }

    for (const memory of ((memoryRows ?? []) as MemoryRow[]).map(mapMemory)) {
      memoriesById.set(memory.id, memory);
    }
  }

  const legacyUrlsByAssetId = await getMediaAssetLegacySignedUrlById(assets);

  return assets.map((asset) => {
    return {
      ...asset,
      memory: memoriesById.get(asset.memoryEntryId) ?? null,
      displayUrl: getMediaAssetDisplayUrl(asset),
      displayPreviewUrl: getMediaAssetPreviewUrl(asset),
      displayFallbackUrl: legacyUrlsByAssetId[asset.id],
    };
  });
}

export async function getTripVideoAssets(
  tripId: string,
  options?: { limit?: number },
): Promise<PhotoAssetWithMemory[]> {
  const { data: assetRows, error: assetError } = await supabase
    .from("media_assets")
    .select(MEDIA_ASSET_SELECT)
    .eq("trip_id", tripId)
    .eq("asset_type", "video")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 120);

  if (assetError) {
    throw assetError;
  }

  const assets = ((assetRows ?? []) as MediaAssetRow[]).map(mapMediaAsset);

  return assets.map((asset) => ({
    ...asset,
    memory: null,
    displayUrl: getMediaAssetDisplayUrl(asset),
    displayPreviewUrl: getMediaAssetPreviewUrl(asset),
    displayFallbackUrl: undefined,
  }));
}

export async function deleteMediaAsset(assetId: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;

  if (userError || !user) {
    throw new Error("You must be logged in to delete media.");
  }

  await supabase.from("photo_faces").delete().eq("media_asset_id", assetId);

  const { data, error } = await supabase
    .from("media_assets")
    .delete()
    .eq("id", assetId)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error("Could not delete this media. It may belong to another user.");
  }
}

export async function getMediaAssetsByMemoryIds(memoryIds: string[]) {
  const uniqueIds = [...new Set(memoryIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const { data, error } = await supabase
    .from("media_assets")
    .select(MEDIA_ASSET_SELECT)
    .in("memory_entry_id", uniqueIds);

  if (error) {
    throw error;
  }

  return ((data ?? []) as MediaAssetRow[]).map(mapMediaAsset);
}

export async function getPhotoFacesForAssets(assetIds: string[]) {
  if (assetIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("photo_faces")
    .select(PHOTO_FACE_SELECT)
    .in("media_asset_id", assetIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as PhotoFaceRow[]).reduce<Record<string, PhotoFace[]>>(
    (groups, row) => {
      groups[row.media_asset_id] = [
        ...(groups[row.media_asset_id] ?? []),
        mapPhotoFace(row),
      ];
      return groups;
    },
    {},
  );
}

export async function getTripImageUploadCountsByUser(tripId: string) {
  const { data, error } = await supabase
    .from("media_assets")
    .select("user_id")
    .eq("trip_id", tripId)
    .eq("asset_type", "image");

  if (error) {
    throw error;
  }

  return ((data ?? []) as { user_id: string | null }[]).reduce<Record<string, number>>(
    (counts, row) => {
      if (row.user_id) {
        counts[row.user_id] = (counts[row.user_id] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
}

export async function getTripFaceTagCountsByMember(tripId: string) {
  const { data, error } = await supabase
    .from("photo_faces")
    .select("journey_member_id")
    .eq("trip_id", tripId)
    .in("recognition_status", ["recognized", "confirmed"]);

  if (error) {
    throw error;
  }

  return ((data ?? []) as { journey_member_id: string | null }[]).reduce<
    Record<string, number>
  >(
    (counts, row) => {
      if (row.journey_member_id) {
        counts[row.journey_member_id] = (counts[row.journey_member_id] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
}

export async function requestFaceDetection(assetId: string, tripId: string) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("You must be logged in to detect faces.");
  }

  const response = await fetch("/api/ai/detect-faces", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ assetId, tripId }),
  });
  const payload = (await response.json()) as {
    faces?: PhotoFace[];
    error?: string;
  };

  if (!response.ok || !payload.faces) {
    throw new Error(payload.error || "Could not detect faces.");
  }

  return payload.faces;
}

export async function requestFaceConfirmation(input: {
  faceId: string;
  tripId: string;
  journeyMemberId?: string;
  recognizedName?: string;
}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("You must be logged in to confirm a face.");
  }

  const response = await fetch("/api/ai/confirm-face", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    face?: PhotoFace;
    error?: string;
  };

  if (!response.ok || !payload.face) {
    throw new Error(payload.error || "Could not confirm this face.");
  }

  return payload.face;
}

export async function requestPhotoIndexing(
  assetId: string,
  tripId: string,
  locale?: Locale,
) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("You must be logged in to index a photo.");
  }

  const response = await fetch("/api/ai/index-photo", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assetId,
      tripId,
      locale:
        locale ??
        (typeof document !== "undefined" && document.documentElement.lang === "zh-CN"
          ? "zh-CN"
          : "en"),
    }),
  });
  const payload = (await response.json()) as {
    asset?: MediaAsset;
    error?: string;
  };

  if (!response.ok || !payload.asset) {
    throw new Error(payload.error || "Could not index this photo.");
  }

  return payload.asset;
}

export async function requestThumbnailBackfillForAssets(
  assetIds: string[],
  tripId?: string,
) {
  const uniqueIds = [...new Set(assetIds.filter(Boolean))].slice(0, 10);
  if (uniqueIds.length === 0) return null;

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    return null;
  }

  const response = await fetch("/api/media/migrate-drive-thumbnails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tripId,
      assetIds: uniqueIds,
      limit: uniqueIds.length,
      dryRun: false,
    }),
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<{
    processed: number;
    failed: number;
    skipped: number;
    results: {
      assetId: string;
      status: "processed" | "skipped" | "failed" | "dry_run";
      thumbnailPath: string | null;
    }[];
  }>;
}

export async function requestDriveThumbnailRepairForAssets(
  assetIds: string[],
  tripId: string,
) {
  const uniqueIds = [...new Set(assetIds.filter(Boolean))].slice(0, 25);
  if (!tripId || uniqueIds.length === 0) return null;

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    return null;
  }

  const response = await fetch("/api/media/repair-drive-thumbnails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tripId,
      assetIds: uniqueIds,
    }),
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<{
    repaired: { assetId: string; status: string; error?: string }[];
    count: number;
  }>;
}

export async function requestVoiceTranscription(input: {
  tripId: string;
  audio: File;
  metadata?: Record<string, unknown>;
}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("You must be logged in to transcribe voice.");
  }

  const formData = new FormData();
  formData.append("tripId", input.tripId);
  formData.append("audio", input.audio);
  formData.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
  formData.append("capturedAt", new Date().toISOString());
  if (input.metadata) {
    formData.append("metadata", JSON.stringify(input.metadata));
  }

  const response = await fetch("/api/capture/transcribe", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });
  const payload = (await response.json()) as {
    captureEventId?: string;
    transcript?: string;
    provider?: string;
    model?: string;
    error?: string;
  };

  if (!response.ok || !payload.transcript) {
    throw new Error(payload.error || "Could not transcribe voice.");
  }

  return {
    captureEventId: payload.captureEventId ?? null,
    transcript: payload.transcript,
    provider: payload.provider ?? null,
    model: payload.model ?? null,
  };
}

export async function createImageMediaAsset(input: CreateMediaAssetInput) {
  const createdAt = new Date().toISOString();
  const storageProvider = input.storageProvider ?? "supabase_legacy";
  const storageBucket =
    input.storageBucket ?? (storageProvider === "google_drive" ? "google-drive" : "trip-media");

  const { error } = await supabase
    .from("media_assets")
    .insert({
      id: input.id,
      trip_id: input.tripId,
      user_id: input.userId,
      memory_entry_id: input.memoryEntryId ?? null,
      asset_type: "image",
      storage_provider: storageProvider,
      storage_bucket: storageBucket,
      original_file_path: null,
      compressed_file_path: input.compressedFilePath ?? null,
      thumbnail_file_path: input.thumbnailFilePath ?? null,
      original_drive_file_id: input.originalDriveFileId ?? null,
      original_drive_web_url: input.originalDriveWebUrl ?? null,
      thumbnail_drive_file_id: input.thumbnailDriveFileId ?? null,
      thumbnail_drive_web_url: input.thumbnailDriveWebUrl ?? null,
      original_file_size: input.originalFileSize ?? null,
      compressed_file_size: input.compressedFileSize ?? null,
      thumbnail_size: input.thumbnailSize ?? null,
      mime_type: input.mimeType || "image/jpeg",
      width: input.width,
      height: input.height,
      thumbnail_width: input.thumbnailWidth ?? null,
      thumbnail_height: input.thumbnailHeight ?? null,
      storage_tier: "standard",
      is_original_preserved: storageProvider === "google_drive",
      processing_status: input.processingStatus ?? "pending",
      taken_at: input.takenAt ?? null,
      exif_json: input.exifJson ?? {},
      ai_status: "pending",
      ai_metadata: input.aiMetadata ?? {},
    });

  if (error) {
    throw error;
  }

  return mapMediaAsset({
    id: input.id,
    trip_id: input.tripId,
    user_id: input.userId,
    memory_entry_id: input.memoryEntryId ?? null,
    asset_type: "image",
    storage_bucket: storageBucket,
    original_file_path: null,
    compressed_file_path: input.compressedFilePath ?? null,
    thumbnail_file_path: input.thumbnailFilePath ?? null,
    original_drive_file_id: input.originalDriveFileId ?? null,
    original_drive_web_url: input.originalDriveWebUrl ?? null,
    thumbnail_drive_file_id: input.thumbnailDriveFileId ?? null,
    thumbnail_drive_web_url: input.thumbnailDriveWebUrl ?? null,
    thumbnail_url: null,
    preview_url: null,
    original_file_size: input.originalFileSize ?? null,
    compressed_file_size: input.compressedFileSize ?? null,
    thumbnail_size: input.thumbnailSize ?? null,
    mime_type: input.mimeType || "image/jpeg",
    width: input.width,
    height: input.height,
    thumbnail_width: input.thumbnailWidth ?? null,
    thumbnail_height: input.thumbnailHeight ?? null,
    storage_tier: "standard",
    is_original_preserved: storageProvider === "google_drive",
    retention_until: null,
    storage_provider: storageProvider,
    provider_file_id: null,
    provider_drive_id: null,
    provider_web_url: null,
    provider_thumbnail_url: null,
    provider_original_reference: null,
    processing_status: input.processingStatus ?? "pending",
    legacy_supabase_path: null,
    legacy_thumbnail_path: null,
    taken_at: input.takenAt ?? null,
    gps_latitude: null,
    gps_longitude: null,
    camera_model: null,
    orientation: null,
    exif_json: input.exifJson ?? {},
    ai_status: "pending",
    ai_metadata: input.aiMetadata ?? {},
    ocr_text: null,
    duplicate_score: null,
    blur_score: null,
    scene_tags: [],
    indexed_at: null,
    created_at: createdAt,
  });
}
