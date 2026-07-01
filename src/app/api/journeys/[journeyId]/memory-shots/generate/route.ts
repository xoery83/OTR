import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getActivePrompt } from "@/lib/ai/prompt-center";
import { runDailyBestMomentsMemoryShotJob } from "@/lib/memory-shots/worker";
import { renderMemoryShotPreview } from "@/lib/memory-shots/renderer-worker";
import type { MemoryShot } from "@/lib/memory-shots/types";

type GenerateMemoryShotRequest = {
  templateKey?: string;
  date?: string | null;
  language?: string | null;
};

type AiJobRow = {
  id: string;
};

type TripAccessRow = {
  id: string;
  start_date: string | null;
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

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function jsonError(message: string, status: number, metadata?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(metadata ?? {}) }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `code: ${record.code}` : null,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  return fallback;
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
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeDate(value: string | null | undefined) {
  if (value == null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError("date must use YYYY-MM-DD format.", 400);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError("date is not a valid calendar date.", 400);
  }

  return value;
}

function dateKey(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
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

async function requireJourneyAccess(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  journeyId: string,
) {
  const { data, error } = await supabase
    .from("trips")
    .select("id, start_date")
    .eq("id", journeyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new HttpError(
      "You must be a journey member to generate Memory Shots.",
      403,
    );
  }

  return data as TripAccessRow;
}

async function inferGenerationDate(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  trip: TripAccessRow,
  explicitDate: string | null,
) {
  if (explicitDate) return explicitDate;

  const { data: memory } = await supabase
    .from("memory_entries")
    .select("captured_at")
    .eq("trip_id", trip.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return dateKey((memory as { captured_at?: string } | null)?.captured_at) ??
    trip.start_date ??
    new Date().toISOString().slice(0, 10);
}

async function assertActivePrompt(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  language: string,
) {
  const activePrompt =
    (await getActivePrompt("memory_shot_daily_best_moments", language, {
      supabase,
    })) ??
    (language === "en"
      ? null
      : await getActivePrompt("memory_shot_daily_best_moments", "en", {
          supabase,
        }));

  if (!activePrompt) {
    throw new HttpError(
      "Prompt Center active prompt not found for memory_shot_daily_best_moments.",
      422,
    );
  }
}

async function findGeneratingMemoryShot(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  journeyId: string,
  date: string,
) {
  const { data, error } = await supabase
    .from("memory_shots")
    .select("*")
    .eq("journey_id", journeyId)
    .eq("status", "generating")
    .contains("metadata", {
      templateKey: "memory_shot_daily_best_moments",
      date,
    })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? mapMemoryShot(data as MemoryShotRow) : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ journeyId: string }> },
) {
  let aiJobId: string | null = null;

  try {
    const { journeyId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as GenerateMemoryShotRequest;
    const templateKey = body.templateKey ?? "memory_shot_daily_best_moments";
    const language = body.language ?? "en";

    if (templateKey !== "memory_shot_daily_best_moments") {
      return jsonError("Only memory_shot_daily_best_moments is supported.", 400);
    }

    const requestedDate = normalizeDate(body.date);
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const trip = await requireJourneyAccess(supabase, journeyId);
    const date = await inferGenerationDate(supabase, trip, requestedDate);
    await assertActivePrompt(supabase, language);

    const generatingMemoryShot = await findGeneratingMemoryShot(
      supabase,
      journeyId,
      date,
    );
    if (generatingMemoryShot) {
      return NextResponse.json(
        {
          error:
            "A Daily Best Moments Memory Shot is already generating for this date.",
          memoryShot: generatingMemoryShot,
        },
        { status: 409 },
      );
    }

    const { data: jobRow, error: jobError } = await supabase
      .from("ai_jobs")
      .insert({
        journey_id: journeyId,
        user_id: userData.user.id,
        worker: "memory_shot_worker",
        task: "memory_shot_daily_best_moments",
        status: "queued",
        prompt_key: "memory_shot_daily_best_moments",
        payload: {
          templateKey: "memory_shot_daily_best_moments",
          date,
          language,
        },
      })
      .select("id")
      .single();

    if (jobError || !jobRow) {
      throw jobError || new Error("Could not create AI job.");
    }

    aiJobId = (jobRow as AiJobRow).id;
    let memoryShot = await runDailyBestMomentsMemoryShotJob({
      supabase,
      journeyId,
      userId: userData.user.id,
      aiJobId,
      date,
      language,
    });

    try {
      const renderResult = await renderMemoryShotPreview({
        supabase,
        memoryShotId: memoryShot.id,
        force: true,
      });
      memoryShot = {
        ...memoryShot,
        previewUrl: renderResult.previewUrl,
        thumbnailUrl: renderResult.thumbnailUrl,
        renderStatus: renderResult.renderStatus,
        renderError: null,
        renderedAt: new Date().toISOString(),
      };
    } catch {
      // Rendering is best-effort in Phase 6A. The worker records render_error.
    }

    return NextResponse.json({ aiJobId, memoryShot });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not generate Memory Shot."), error instanceof HttpError ? error.status : 500, {
      aiJobId,
    });
  }
}
