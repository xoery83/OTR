import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type {
  BackgroundJobBatch,
  UpdateBackgroundJobBatchInput,
} from "@/lib/background-jobs/types";

type BatchRow = {
  id: string;
  journey_id: string | null;
  user_id: string | null;
  batch_type: string;
  title: string;
  total_items: number;
  completed_items: number;
  failed_items: number;
  status: BackgroundJobBatch["status"];
  current_step: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

function mapBatch(row: BatchRow): BackgroundJobBatch {
  return {
    id: row.id,
    journeyId: row.journey_id,
    userId: row.user_id,
    batchType: row.batch_type,
    title: row.title,
    totalItems: row.total_items,
    completedItems: row.completed_items,
    failedItems: row.failed_items,
    status: row.status,
    currentStep: row.current_step,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const body = (await request.json()) as UpdateBackgroundJobBatchInput;
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const patch: Record<string, unknown> = {};
    if (body.status) patch.status = body.status;
    if (typeof body.totalItems === "number") patch.total_items = body.totalItems;
    if (typeof body.completedItems === "number") {
      patch.completed_items = body.completedItems;
    }
    if (typeof body.failedItems === "number") patch.failed_items = body.failedItems;
    if ("currentStep" in body) patch.current_step = body.currentStep;
    if (body.metadata) patch.metadata = body.metadata;

    const { data, error } = await supabase
      .from("background_job_batches")
      .update(patch)
      .eq("id", batchId)
      .select("*")
      .single();

    if (error || !data) throw error || new Error("Could not update batch.");

    return NextResponse.json({ batch: mapBatch(data as BatchRow) });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not update job batch.",
      500,
    );
  }
}
