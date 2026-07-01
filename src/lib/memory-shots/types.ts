import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoryShotVisibility =
  | "private"
  | "journey_members"
  | "public_unlisted"
  | "public_discover";

export type MemoryShotStatus =
  | "draft"
  | "generating"
  | "ready"
  | "failed"
  | "archived";

export type MemoryShotRenderStatus =
  | "not_started"
  | "rendering"
  | "ready"
  | "failed";

export type MemoryShotRenderStorageProvider =
  | "google_drive"
  | "media_server"
  | "supabase_fallback";

export type MemoryShotAssetType =
  | "photo"
  | "message"
  | "expense"
  | "location"
  | "route"
  | "person"
  | "planner_item"
  | "memory";

export type MemoryShotTemplate = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  worker: string;
  task: string;
  status: "draft" | "active" | "archived";
  defaultVisibility: MemoryShotVisibility;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MemoryShot = {
  id: string;
  journeyId: string;
  templateId: string | null;
  authorUserId: string | null;
  title: string | null;
  subtitle: string | null;
  language: string;
  status: MemoryShotStatus;
  visibility: MemoryShotVisibility;
  coverUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  driveFileId: string | null;
  originalDriveFileId: string | null;
  originalDriveUrl: string | null;
  errorMessage: string | null;
  renderStatus: MemoryShotRenderStatus;
  renderError: string | null;
  renderWarning: string | null;
  renderedAt: string | null;
  originalStorageProvider: MemoryShotRenderStorageProvider | null;
  originalStoragePath: string | null;
  previewStorageProvider: MemoryShotRenderStorageProvider | null;
  previewStoragePath: string | null;
  thumbnailStorageProvider: MemoryShotRenderStorageProvider | null;
  thumbnailStoragePath: string | null;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryShotAsset = {
  id: string;
  memoryShotId: string;
  journeyId: string;
  assetType: MemoryShotAssetType;
  sourceId: string;
  role: string | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type MemoryShotSnapshot = {
  id: string;
  memoryShotId: string;
  journeyId: string;
  snapshot: Record<string, unknown>;
  sourceSummary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type MemoryShotRecommendationStatus =
  | "active"
  | "dismissed"
  | "accepted"
  | "expired";

export type MemoryShotRecommendation = {
  id: string;
  journeyId: string;
  userId: string | null;
  templateId: string | null;
  recommendationKey: string;
  title: string;
  reason: string | null;
  score: number;
  status: MemoryShotRecommendationStatus;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreateMemoryShotInput = {
  journeyId: string;
  templateId?: string | null;
  templateKey?: string | null;
  title?: string | null;
  subtitle?: string | null;
  language?: string;
  status?: MemoryShotStatus;
  visibility?: MemoryShotVisibility;
  coverUrl?: string | null;
  previewUrl?: string | null;
  driveFileId?: string | null;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type AddMemoryShotAssetInput = {
  assetType: MemoryShotAssetType;
  sourceId: string;
  role?: string | null;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
};

export type SaveMemoryShotSnapshotInput = {
  snapshot: Record<string, unknown>;
  sourceSummary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type MarkMemoryShotReadyInput = {
  title?: string | null;
  subtitle?: string | null;
  coverUrl?: string | null;
  previewUrl?: string | null;
  driveFileId?: string | null;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ListMemoryShotsOptions = {
  status?: MemoryShotStatus;
  visibility?: MemoryShotVisibility;
  limit?: number;
};

export type ListRecommendationsOptions = {
  status?: MemoryShotRecommendationStatus;
  limit?: number;
};

export type MemoryShotsSupabase = SupabaseClient;

export type MemoryShotsOptions = {
  supabase?: MemoryShotsSupabase;
  userId?: string | null;
};
