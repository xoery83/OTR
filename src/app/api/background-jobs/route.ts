import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type {
  BackgroundJob,
  CreateBackgroundJobInput,
} from "@/lib/background-jobs/types";

type JobRow = {
  id: string;
  batch_id: string | null;
  journey_id: string | null;
  user_id: string | null;
  job_type: string;
  title: string;
  status: BackgroundJob["status"];
  progress: number;
  current_step: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  attempts: number;
  available_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

function mapJob(row: JobRow): BackgroundJob {
  return {
    id: row.id,
    batchId: row.batch_id,
    journeyId: row.journey_id,
    userId: row.user_id,
    jobType: row.job_type,
    title: row.title,
    status: row.status,
    progress: row.progress,
    currentStep: row.current_step,
    payload: row.payload ?? {},
    result: row.result ?? {},
    errorMessage: row.error_message,
    attempts: row.attempts,
    availableAt: row.available_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data, error } = await supabase
      .from("background_jobs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    return NextResponse.json({
      jobs: ((data ?? []) as JobRow[]).map(mapJob),
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not load background jobs."), 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBackgroundJobInput;
    if (!body.jobType || !body.title) {
      return jsonError("jobType and title are required.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const mediaAssetId =
      typeof body.payload?.mediaAssetId === "string"
        ? body.payload.mediaAssetId
        : null;
    if (mediaAssetId) {
      const { data: existing, error: existingError } = await supabase
        .from("background_jobs")
        .select("*")
        .eq("job_type", body.jobType)
        .eq("payload->>mediaAssetId", mediaAssetId)
        .in("status", ["queued", "uploading", "processing", "waiting_for_user"])
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        const existingRow = existing as JobRow;
        const existingPayload = existingRow.payload ?? {};
        if (existingPayload.placeholder || existingPayload.pendingImplementation) {
          const { data: repaired, error: repairError } = await supabase
            .from("background_jobs")
            .update({
              status: "queued",
              progress: 0,
              current_step: body.currentStep || "Queued",
              payload: body.payload ?? {},
              result: {},
              error_message: null,
              attempts: 0,
              available_at: new Date().toISOString(),
              started_at: null,
              completed_at: null,
            })
            .eq("id", existingRow.id)
            .select("*")
            .single();

          if (repairError || !repaired) {
            throw repairError || new Error("Could not repair background job.");
          }

          return NextResponse.json({ job: mapJob(repaired as JobRow) });
        }

        return NextResponse.json({ job: mapJob(existing as JobRow) });
      }
    }

    const { data, error } = await supabase
      .from("background_jobs")
      .insert({
        batch_id: body.batchId || null,
        journey_id: body.journeyId || null,
        user_id: userData.user.id,
        job_type: body.jobType,
        title: body.title,
        current_step: body.currentStep || null,
        payload: body.payload ?? {},
      })
      .select("*")
      .single();

    if (error || !data) throw error || new Error("Could not create job.");

    return NextResponse.json({ job: mapJob(data as JobRow) });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not create background job."), 500);
  }
}
