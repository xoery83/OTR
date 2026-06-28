import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type {
  BackgroundJob,
  UpdateBackgroundJobInput,
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const body = (await request.json()) as UpdateBackgroundJobInput;
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const patch: Record<string, unknown> = {};
    if (body.status) patch.status = body.status;
    if (typeof body.progress === "number") {
      patch.progress = Math.max(0, Math.min(100, Math.round(body.progress)));
    }
    if ("currentStep" in body) patch.current_step = body.currentStep;
    if (body.result) patch.result = body.result;
    if ("errorMessage" in body) patch.error_message = body.errorMessage;
    if (body.status === "processing" || body.status === "uploading") {
      patch.started_at = new Date().toISOString();
    }
    if (
      body.status === "completed" ||
      body.status === "failed" ||
      body.status === "cancelled" ||
      body.status === "waiting_for_user"
    ) {
      patch.completed_at =
        body.status === "completed" || body.status === "failed"
          ? new Date().toISOString()
          : null;
    }

    const { data, error } = await supabase
      .from("background_jobs")
      .update(patch)
      .eq("id", jobId)
      .select("*")
      .single();

    if (error || !data) throw error || new Error("Could not update job.");

    return NextResponse.json({ job: mapJob(data as JobRow) });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not update background job."), 500);
  }
}
