import { getCurrentUser } from "@/lib/supabase/auth";
import { supabase as defaultSupabase } from "@/lib/supabase/client";
import type {
  AddMemoryShotAssetInput,
  CreateMemoryShotInput,
  ListMemoryShotsOptions,
  ListRecommendationsOptions,
  MarkMemoryShotReadyInput,
  MemoryShot,
  MemoryShotAsset,
  MemoryShotRecommendation,
  MemoryShotsOptions,
  MemoryShotsSupabase,
  MemoryShotSnapshot,
  MemoryShotTemplate,
  SaveMemoryShotSnapshotInput,
} from "./types";

type MemoryShotTemplateRow = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  worker: string;
  task: string;
  status: "draft" | "active" | "archived";
  default_visibility: MemoryShotTemplate["defaultVisibility"];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type MemoryShotRow = {
  id: string;
  journey_id: string;
  template_id: string | null;
  author_user_id: string | null;
  title: string | null;
  subtitle: string | null;
  language: string;
  status: MemoryShot["status"];
  visibility: MemoryShot["visibility"];
  cover_url: string | null;
  preview_url: string | null;
  thumbnail_url?: string | null;
  drive_file_id: string | null;
  original_drive_file_id?: string | null;
  original_drive_url?: string | null;
  error_message: string | null;
  render_status?: MemoryShot["renderStatus"];
  render_error?: string | null;
  render_warning?: string | null;
  rendered_at?: string | null;
  original_storage_provider?: MemoryShot["originalStorageProvider"];
  original_storage_path?: string | null;
  preview_storage_provider?: MemoryShot["previewStorageProvider"];
  preview_storage_path?: string | null;
  thumbnail_storage_provider?: MemoryShot["thumbnailStorageProvider"];
  thumbnail_storage_path?: string | null;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryShotAssetRow = {
  id: string;
  memory_shot_id: string;
  journey_id: string;
  asset_type: MemoryShotAsset["assetType"];
  source_id: string;
  role: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

type MemoryShotSnapshotRow = {
  id: string;
  memory_shot_id: string;
  journey_id: string;
  snapshot: Record<string, unknown>;
  source_summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
};

type MemoryShotRecommendationRow = {
  id: string;
  journey_id: string;
  user_id: string | null;
  template_id: string | null;
  recommendation_key: string;
  title: string;
  reason: string | null;
  score: number;
  status: MemoryShotRecommendation["status"];
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function client(options?: MemoryShotsOptions): MemoryShotsSupabase {
  return options?.supabase ?? defaultSupabase;
}

function mapTemplate(row: MemoryShotTemplateRow): MemoryShotTemplate {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    worker: row.worker,
    task: row.task,
    status: row.status,
    defaultVisibility: row.default_visibility,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemoryShot(row: MemoryShotRow): MemoryShot {
  return {
    id: row.id,
    journeyId: row.journey_id,
    templateId: row.template_id,
    authorUserId: row.author_user_id,
    title: row.title,
    subtitle: row.subtitle,
    language: row.language,
    status: row.status,
    visibility: row.visibility,
    coverUrl: row.cover_url,
    previewUrl: row.preview_url,
    thumbnailUrl: row.thumbnail_url ?? null,
    driveFileId: row.drive_file_id,
    originalDriveFileId: row.original_drive_file_id ?? null,
    originalDriveUrl: row.original_drive_url ?? null,
    errorMessage: row.error_message,
    renderStatus: row.render_status ?? "not_started",
    renderError: row.render_error ?? null,
    renderWarning: row.render_warning ?? null,
    renderedAt: row.rendered_at ?? null,
    originalStorageProvider: row.original_storage_provider ?? null,
    originalStoragePath: row.original_storage_path ?? null,
    previewStorageProvider: row.preview_storage_provider ?? null,
    previewStoragePath: row.preview_storage_path ?? null,
    thumbnailStorageProvider: row.thumbnail_storage_provider ?? null,
    thumbnailStoragePath: row.thumbnail_storage_path ?? null,
    content: row.content ?? {},
    metadata: row.metadata ?? {},
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAsset(row: MemoryShotAssetRow): MemoryShotAsset {
  return {
    id: row.id,
    memoryShotId: row.memory_shot_id,
    journeyId: row.journey_id,
    assetType: row.asset_type,
    sourceId: row.source_id,
    role: row.role,
    sortOrder: row.sort_order,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapSnapshot(row: MemoryShotSnapshotRow): MemoryShotSnapshot {
  return {
    id: row.id,
    memoryShotId: row.memory_shot_id,
    journeyId: row.journey_id,
    snapshot: row.snapshot ?? {},
    sourceSummary: row.source_summary ?? {},
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapRecommendation(
  row: MemoryShotRecommendationRow,
): MemoryShotRecommendation {
  return {
    id: row.id,
    journeyId: row.journey_id,
    userId: row.user_id,
    templateId: row.template_id,
    recommendationKey: row.recommendation_key,
    title: row.title,
    reason: row.reason,
    score: row.score,
    status: row.status,
    payload: row.payload ?? {},
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getTemplateId(
  supabase: MemoryShotsSupabase,
  input: Pick<CreateMemoryShotInput, "templateId" | "templateKey">,
) {
  if (input.templateId) return input.templateId;
  if (!input.templateKey) return null;

  const { data, error } = await supabase
    .from("memory_shot_templates")
    .select("id")
    .eq("key", input.templateKey)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

async function getUserId(options?: MemoryShotsOptions) {
  if (options?.userId) return options.userId;
  const user = await getCurrentUser();
  return user?.id ?? null;
}

export async function createMemoryShot(
  input: CreateMemoryShotInput,
  options?: MemoryShotsOptions,
): Promise<MemoryShot> {
  const supabase = client(options);
  const userId = await getUserId(options);
  if (!userId) throw new Error("You must be logged in.");

  const templateId = await getTemplateId(supabase, input);
  const { data, error } = await supabase
    .from("memory_shots")
    .insert({
      journey_id: input.journeyId,
      template_id: templateId,
      author_user_id: userId,
      title: input.title ?? null,
      subtitle: input.subtitle ?? null,
      language: input.language ?? "en",
      status: input.status ?? "draft",
      visibility: input.visibility ?? "journey_members",
      cover_url: input.coverUrl ?? null,
      preview_url: input.previewUrl ?? null,
      drive_file_id: input.driveFileId ?? null,
      content: input.content ?? {},
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error || !data) throw error || new Error("Could not create Memory Shot.");
  return mapMemoryShot(data as MemoryShotRow);
}

export async function addMemoryShotAssets(
  memoryShot: Pick<MemoryShot, "id" | "journeyId">,
  assets: AddMemoryShotAssetInput[],
  options?: MemoryShotsOptions,
): Promise<MemoryShotAsset[]> {
  if (assets.length === 0) return [];

  const { data, error } = await client(options)
    .from("memory_shot_assets")
    .insert(
      assets.map((asset, index) => ({
        memory_shot_id: memoryShot.id,
        journey_id: memoryShot.journeyId,
        asset_type: asset.assetType,
        source_id: asset.sourceId,
        role: asset.role ?? null,
        sort_order: asset.sortOrder ?? index,
        metadata: asset.metadata ?? {},
      })),
    )
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as MemoryShotAssetRow[]).map(mapAsset);
}

export async function saveMemoryShotSnapshot(
  memoryShot: Pick<MemoryShot, "id" | "journeyId">,
  input: SaveMemoryShotSnapshotInput,
  options?: MemoryShotsOptions,
): Promise<MemoryShotSnapshot> {
  const { data, error } = await client(options)
    .from("memory_shot_snapshots")
    .upsert(
      {
        memory_shot_id: memoryShot.id,
        journey_id: memoryShot.journeyId,
        snapshot: input.snapshot,
        source_summary: input.sourceSummary ?? {},
        metadata: input.metadata ?? {},
      },
      { onConflict: "memory_shot_id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error || new Error("Could not save Memory Shot snapshot.");
  }
  return mapSnapshot(data as MemoryShotSnapshotRow);
}

export async function markMemoryShotReady(
  memoryShotId: string,
  input: MarkMemoryShotReadyInput = {},
  options?: MemoryShotsOptions,
): Promise<MemoryShot> {
  const patch: Record<string, unknown> = {
    status: "ready",
    error_message: null,
    generated_at: new Date().toISOString(),
  };
  if ("title" in input) patch.title = input.title;
  if ("subtitle" in input) patch.subtitle = input.subtitle;
  if ("coverUrl" in input) patch.cover_url = input.coverUrl;
  if ("previewUrl" in input) patch.preview_url = input.previewUrl;
  if ("driveFileId" in input) patch.drive_file_id = input.driveFileId;
  if ("content" in input) patch.content = input.content;
  if ("metadata" in input) patch.metadata = input.metadata;

  const { data, error } = await client(options)
    .from("memory_shots")
    .update(patch)
    .eq("id", memoryShotId)
    .select("*")
    .single();

  if (error || !data) {
    throw error || new Error("Could not mark Memory Shot ready.");
  }
  return mapMemoryShot(data as MemoryShotRow);
}

export async function listMemoryShots(
  journeyId: string,
  options?: ListMemoryShotsOptions & MemoryShotsOptions,
): Promise<MemoryShot[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
  let query = client(options)
    .from("memory_shots")
    .select("*")
    .eq("journey_id", journeyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.status) query = query.eq("status", options.status);
  if (options?.visibility) query = query.eq("visibility", options.visibility);

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as MemoryShotRow[]).map(mapMemoryShot);
}

export async function markMemoryShotRead(
  memoryShot: Pick<MemoryShot, "id" | "journeyId">,
  options?: MemoryShotsOptions,
) {
  const userId = await getUserId(options);
  if (!userId) throw new Error("You must be logged in.");

  const { data, error } = await client(options)
    .from("memory_shot_reads")
    .upsert(
      {
        memory_shot_id: memoryShot.id,
        journey_id: memoryShot.journeyId,
        user_id: userId,
        read_at: new Date().toISOString(),
      },
      { onConflict: "memory_shot_id,user_id" },
    )
    .select("read_at")
    .single();

  if (error || !data) {
    throw error || new Error("Could not mark Memory Shot as read.");
  }
  return data.read_at as string;
}

export async function listRecommendations(
  journeyId: string,
  options?: ListRecommendationsOptions & MemoryShotsOptions,
): Promise<MemoryShotRecommendation[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  let query = client(options)
    .from("memory_shot_recommendations")
    .select("*")
    .eq("journey_id", journeyId)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as MemoryShotRecommendationRow[]).map(mapRecommendation);
}

export async function listMemoryShotTemplates(
  options?: MemoryShotsOptions,
): Promise<MemoryShotTemplate[]> {
  const { data, error } = await client(options)
    .from("memory_shot_templates")
    .select("*")
    .eq("status", "active")
    .order("title", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as MemoryShotTemplateRow[]).map(mapTemplate);
}

export type {
  AddMemoryShotAssetInput,
  CreateMemoryShotInput,
  ListMemoryShotsOptions,
  ListRecommendationsOptions,
  MarkMemoryShotReadyInput,
  MemoryShot,
  MemoryShotAsset,
  MemoryShotAssetType,
  MemoryShotRecommendation,
  MemoryShotRenderStatus,
  MemoryShotRenderStorageProvider,
  MemoryShotSnapshot,
  MemoryShotStatus,
  MemoryShotTemplate,
  MemoryShotVisibility,
  SaveMemoryShotSnapshotInput,
} from "./types";
