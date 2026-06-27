import type {
  MemoryEntry,
  MediaAsset,
  PhotoAssetWithMemory,
  PhotoFace,
} from "@/types";
import { supabase } from "./client";

export type CreateMediaAssetInput = {
  id: string;
  tripId: string;
  userId: string;
  memoryEntryId?: string | null;
  compressedFilePath: string;
  compressedFileSize: number;
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
  original_file_size: number | null;
  compressed_file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  storage_tier: MediaAsset["storageTier"];
  is_original_preserved: boolean;
  retention_until: string | null;
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
    originalFileSize: row.original_file_size,
    compressedFileSize: row.compressed_file_size,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    storageTier: row.storage_tier,
    isOriginalPreserved: row.is_original_preserved,
    retentionUntil: row.retention_until,
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

export async function getTripPhotoAssets(
  tripId: string,
): Promise<PhotoAssetWithMemory[]> {
  const { data: assetRows, error: assetError } = await supabase
    .from("media_assets")
    .select("*")
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
      .select("*")
      .in("id", memoryIds);

    if (memoryError) {
      throw memoryError;
    }

    for (const memory of ((memoryRows ?? []) as MemoryRow[]).map(mapMemory)) {
      memoriesById.set(memory.id, memory);
    }
  }

  const compressedPaths = [
    ...new Set(
      assets
        .map((asset) => asset.compressedFilePath)
        .filter((path): path is string => Boolean(path)),
    ),
  ];
  const signedUrls = new Map<string, string>();

  if (compressedPaths.length > 0) {
    const { data: signedData, error: signedError } = await supabase.storage
      .from("trip-media")
      .createSignedUrls(compressedPaths, 60 * 60);

    if (signedError) {
      throw signedError;
    }

    for (const item of signedData ?? []) {
      if (item.path && item.signedUrl) {
        signedUrls.set(item.path, item.signedUrl);
      }
    }
  }

  return assets.map((asset) => ({
    ...asset,
    memory: memoriesById.get(asset.memoryEntryId) ?? null,
    displayUrl: asset.compressedFilePath
      ? signedUrls.get(asset.compressedFilePath)
      : undefined,
  }));
}

export async function getPhotoFacesForAssets(assetIds: string[]) {
  if (assetIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("photo_faces")
    .select("*")
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
  journeyMemberId: string;
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

export async function requestPhotoIndexing(assetId: string, tripId: string) {
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
    body: JSON.stringify({ assetId, tripId }),
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

export async function requestVoiceTranscription(input: {
  tripId: string;
  audio: File;
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

  const { error } = await supabase
    .from("media_assets")
    .insert({
      id: input.id,
      trip_id: input.tripId,
      user_id: input.userId,
      memory_entry_id: input.memoryEntryId ?? null,
      asset_type: "image",
      storage_provider: "supabase_legacy",
      storage_bucket: "trip-media",
      original_file_path: null,
      compressed_file_path: input.compressedFilePath,
      original_file_size: input.originalFileSize ?? null,
      compressed_file_size: input.compressedFileSize,
      mime_type: input.mimeType || "image/jpeg",
      width: input.width,
      height: input.height,
      storage_tier: "standard",
      is_original_preserved: false,
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
    storage_bucket: "trip-media",
    original_file_path: null,
    compressed_file_path: input.compressedFilePath,
    thumbnail_file_path: null,
    original_file_size: input.originalFileSize ?? null,
    compressed_file_size: input.compressedFileSize,
    mime_type: input.mimeType || "image/jpeg",
    width: input.width,
    height: input.height,
    storage_tier: "standard",
    is_original_preserved: false,
    retention_until: null,
    storage_provider: "supabase_legacy",
    provider_file_id: null,
    provider_drive_id: null,
    provider_web_url: null,
    provider_thumbnail_url: null,
    provider_original_reference: null,
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
