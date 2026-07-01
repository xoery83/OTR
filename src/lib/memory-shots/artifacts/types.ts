import type {
  MemoryShotAssetType,
  MemoryShotsOptions,
  MemoryShotsSupabase,
} from "../types";

export type MemoryShotArtifactType = "poster" | "motion_story";

export type MemoryShotArtifactVariant =
  | "single_poster"
  | "long_poster"
  | "grid_9"
  | "scroll_story";

export type MemoryShotArtifactStatus =
  | "pending"
  | "rendering"
  | "ready"
  | "failed"
  | "archived";

export type MemoryShotArtifact = {
  id: string;
  memoryShotId: string;
  artifactType: MemoryShotArtifactType;
  variant: MemoryShotArtifactVariant;
  status: MemoryShotArtifactStatus;
  title: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  publicUrl: string | null;
  storage: Record<string, unknown>;
  manifest: Record<string, unknown>;
  metadata: Record<string, unknown>;
  renderError: string | null;
  renderWarning: string | null;
  renderedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryShotArtifactAsset = {
  id: string;
  artifactId: string;
  assetType: MemoryShotAssetType;
  assetId: string;
  role: string | null;
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateMemoryShotArtifactInput = {
  memoryShotId: string;
  artifactType: MemoryShotArtifactType;
  variant: MemoryShotArtifactVariant;
  status?: MemoryShotArtifactStatus;
  title?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  publicUrl?: string | null;
  storage?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type UpdateMemoryShotArtifactStatusInput = {
  status: MemoryShotArtifactStatus;
  renderError?: string | null;
  renderWarning?: string | null;
  metadata?: Record<string, unknown>;
  renderedAt?: string | null;
};

export type MarkMemoryShotArtifactReadyInput = {
  title?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  publicUrl?: string | null;
  storage?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  renderWarning?: string | null;
  renderedAt?: string | null;
};

export type MarkMemoryShotArtifactFailedInput = {
  renderError: string;
  renderWarning?: string | null;
  metadata?: Record<string, unknown>;
};

export type ListMemoryShotArtifactsOptions = MemoryShotsOptions & {
  artifactType?: MemoryShotArtifactType;
  variant?: MemoryShotArtifactVariant;
  status?: MemoryShotArtifactStatus;
  limit?: number;
};

export type AddMemoryShotArtifactAssetInput = {
  assetType: MemoryShotAssetType;
  assetId: string;
  role?: string | null;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
};

export type MemoryShotArtifactsOptions = MemoryShotsOptions;
export type MemoryShotArtifactsSupabase = MemoryShotsSupabase;
