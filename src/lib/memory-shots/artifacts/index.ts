import { supabase as defaultSupabase } from "@/lib/supabase/client";
import type {
  AddMemoryShotArtifactAssetInput,
  CreateMemoryShotArtifactInput,
  ListMemoryShotArtifactsOptions,
  MarkMemoryShotArtifactFailedInput,
  MarkMemoryShotArtifactReadyInput,
  MemoryShotArtifact,
  MemoryShotArtifactAsset,
  MemoryShotArtifactsOptions,
  MemoryShotArtifactsSupabase,
  UpdateMemoryShotArtifactStatusInput,
} from "./types";

type MemoryShotArtifactRow = {
  id: string;
  memory_shot_id: string;
  artifact_type: MemoryShotArtifact["artifactType"];
  variant: MemoryShotArtifact["variant"];
  status: MemoryShotArtifact["status"];
  title: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  public_url: string | null;
  storage: Record<string, unknown>;
  manifest: Record<string, unknown>;
  metadata: Record<string, unknown>;
  render_error: string | null;
  render_warning: string | null;
  rendered_at: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryShotArtifactAssetRow = {
  id: string;
  artifact_id: string;
  asset_type: MemoryShotArtifactAsset["assetType"];
  asset_id: string;
  role: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

function client(options?: MemoryShotArtifactsOptions): MemoryShotArtifactsSupabase {
  return options?.supabase ?? defaultSupabase;
}

function mapArtifact(row: MemoryShotArtifactRow): MemoryShotArtifact {
  return {
    id: row.id,
    memoryShotId: row.memory_shot_id,
    artifactType: row.artifact_type,
    variant: row.variant,
    status: row.status,
    title: row.title,
    previewUrl: row.preview_url,
    thumbnailUrl: row.thumbnail_url,
    publicUrl: row.public_url,
    storage: row.storage ?? {},
    manifest: row.manifest ?? {},
    metadata: row.metadata ?? {},
    renderError: row.render_error,
    renderWarning: row.render_warning,
    renderedAt: row.rendered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtifactAsset(
  row: MemoryShotArtifactAssetRow,
): MemoryShotArtifactAsset {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    assetType: row.asset_type,
    assetId: row.asset_id,
    role: row.role,
    sortOrder: row.sort_order,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export async function createMemoryShotArtifact(
  input: CreateMemoryShotArtifactInput,
  options?: MemoryShotArtifactsOptions,
): Promise<MemoryShotArtifact> {
  const { data, error } = await client(options)
    .from("memory_shot_artifacts")
    .insert({
      memory_shot_id: input.memoryShotId,
      artifact_type: input.artifactType,
      variant: input.variant,
      status: input.status ?? "pending",
      title: input.title ?? null,
      preview_url: input.previewUrl ?? null,
      thumbnail_url: input.thumbnailUrl ?? null,
      public_url: input.publicUrl ?? null,
      storage: input.storage ?? {},
      manifest: input.manifest ?? {},
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw error || new Error("Could not create Memory Shot artifact.");
  }
  return mapArtifact(data as MemoryShotArtifactRow);
}

export async function updateMemoryShotArtifactStatus(
  artifactId: string,
  input: UpdateMemoryShotArtifactStatusInput,
  options?: MemoryShotArtifactsOptions,
): Promise<MemoryShotArtifact> {
  const patch: Record<string, unknown> = {
    status: input.status,
  };
  if ("renderError" in input) patch.render_error = input.renderError;
  if ("renderWarning" in input) patch.render_warning = input.renderWarning;
  if ("metadata" in input) patch.metadata = input.metadata;
  if ("renderedAt" in input) patch.rendered_at = input.renderedAt;

  const { data, error } = await client(options)
    .from("memory_shot_artifacts")
    .update(patch)
    .eq("id", artifactId)
    .select("*")
    .single();

  if (error || !data) {
    throw error || new Error("Could not update Memory Shot artifact status.");
  }
  return mapArtifact(data as MemoryShotArtifactRow);
}

export async function markMemoryShotArtifactReady(
  artifactId: string,
  input: MarkMemoryShotArtifactReadyInput = {},
  options?: MemoryShotArtifactsOptions,
): Promise<MemoryShotArtifact> {
  const patch: Record<string, unknown> = {
    status: "ready",
    render_error: null,
    rendered_at: input.renderedAt ?? new Date().toISOString(),
  };
  if ("title" in input) patch.title = input.title;
  if ("previewUrl" in input) patch.preview_url = input.previewUrl;
  if ("thumbnailUrl" in input) patch.thumbnail_url = input.thumbnailUrl;
  if ("publicUrl" in input) patch.public_url = input.publicUrl;
  if ("storage" in input) patch.storage = input.storage;
  if ("manifest" in input) patch.manifest = input.manifest;
  if ("metadata" in input) patch.metadata = input.metadata;
  if ("renderWarning" in input) patch.render_warning = input.renderWarning;

  const { data, error } = await client(options)
    .from("memory_shot_artifacts")
    .update(patch)
    .eq("id", artifactId)
    .select("*")
    .single();

  if (error || !data) {
    throw error || new Error("Could not mark Memory Shot artifact ready.");
  }
  return mapArtifact(data as MemoryShotArtifactRow);
}

export async function markMemoryShotArtifactFailed(
  artifactId: string,
  input: MarkMemoryShotArtifactFailedInput,
  options?: MemoryShotArtifactsOptions,
): Promise<MemoryShotArtifact> {
  const patch: Record<string, unknown> = {
    status: "failed",
    render_error: input.renderError,
    render_warning: input.renderWarning ?? null,
  };
  if ("metadata" in input) patch.metadata = input.metadata;

  const { data, error } = await client(options)
    .from("memory_shot_artifacts")
    .update(patch)
    .eq("id", artifactId)
    .select("*")
    .single();

  if (error || !data) {
    throw error || new Error("Could not mark Memory Shot artifact failed.");
  }
  return mapArtifact(data as MemoryShotArtifactRow);
}

export async function listMemoryShotArtifacts(
  memoryShotId: string,
  options?: ListMemoryShotArtifactsOptions,
): Promise<MemoryShotArtifact[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
  let query = client(options)
    .from("memory_shot_artifacts")
    .select("*")
    .eq("memory_shot_id", memoryShotId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.artifactType) {
    query = query.eq("artifact_type", options.artifactType);
  }
  if (options?.variant) query = query.eq("variant", options.variant);
  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as MemoryShotArtifactRow[]).map(mapArtifact);
}

export async function addMemoryShotArtifactAssets(
  artifactId: string,
  assets: AddMemoryShotArtifactAssetInput[],
  options?: MemoryShotArtifactsOptions,
): Promise<MemoryShotArtifactAsset[]> {
  if (assets.length === 0) return [];

  const { data, error } = await client(options)
    .from("memory_shot_artifact_assets")
    .insert(
      assets.map((asset, index) => ({
        artifact_id: artifactId,
        asset_type: asset.assetType,
        asset_id: asset.assetId,
        role: asset.role ?? null,
        sort_order: asset.sortOrder ?? index,
        metadata: asset.metadata ?? {},
      })),
    )
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as MemoryShotArtifactAssetRow[]).map(mapArtifactAsset);
}

export type {
  AddMemoryShotArtifactAssetInput,
  CreateMemoryShotArtifactInput,
  ListMemoryShotArtifactsOptions,
  MarkMemoryShotArtifactFailedInput,
  MarkMemoryShotArtifactReadyInput,
  MemoryShotArtifact,
  MemoryShotArtifactAsset,
  MemoryShotArtifactStatus,
  MemoryShotArtifactType,
  MemoryShotArtifactVariant,
  UpdateMemoryShotArtifactStatusInput,
} from "./types";
