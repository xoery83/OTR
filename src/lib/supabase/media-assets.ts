import type { MediaAsset } from "@/types";
import { supabase } from "./client";

export type CreateMediaAssetInput = {
  id: string;
  tripId: string;
  userId: string;
  memoryEntryId: string;
  compressedFilePath: string;
  compressedFileSize: number;
  width: number;
  height: number;
};

type MediaAssetRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  memory_entry_id: string | null;
  asset_type: MediaAsset["assetType"];
  storage_bucket: string;
  original_file_path: string | null;
  compressed_file_path: string | null;
  thumbnail_file_path: string | null;
  original_file_size: number | null;
  compressed_file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  storage_tier: MediaAsset["storageTier"];
  is_original_preserved: boolean;
  retention_until: string | null;
  created_at: string;
};

function mapMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id ?? "",
    memoryEntryId: row.memory_entry_id ?? "",
    assetType: row.asset_type,
    storageBucket: row.storage_bucket,
    originalFilePath: row.original_file_path,
    compressedFilePath: row.compressed_file_path,
    thumbnailFilePath: row.thumbnail_file_path,
    originalFileSize: row.original_file_size,
    compressedFileSize: row.compressed_file_size,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    storageTier: row.storage_tier,
    isOriginalPreserved: row.is_original_preserved,
    retentionUntil: row.retention_until,
    createdAt: row.created_at,
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
      memory_entry_id: input.memoryEntryId,
      asset_type: "image",
      storage_bucket: "trip-media",
      original_file_path: null,
      compressed_file_path: input.compressedFilePath,
      compressed_file_size: input.compressedFileSize,
      mime_type: "image/jpeg",
      width: input.width,
      height: input.height,
      storage_tier: "standard",
      is_original_preserved: false,
    });

  if (error) {
    throw error;
  }

  return mapMediaAsset({
    id: input.id,
    trip_id: input.tripId,
    user_id: input.userId,
    memory_entry_id: input.memoryEntryId,
    asset_type: "image",
    storage_bucket: "trip-media",
    original_file_path: null,
    compressed_file_path: input.compressedFilePath,
    thumbnail_file_path: null,
    original_file_size: null,
    compressed_file_size: input.compressedFileSize,
    mime_type: "image/jpeg",
    width: input.width,
    height: input.height,
    storage_tier: "standard",
    is_original_preserved: false,
    retention_until: null,
    created_at: createdAt,
  });
}
