import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type {
  BackgroundJobBatch,
  CreateBackgroundJobBatchInput,
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

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data, error } = await supabase
      .from("background_job_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    return NextResponse.json({
      batches: ((data ?? []) as BatchRow[]).map(mapBatch),
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not load job batches.",
      500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBackgroundJobBatchInput;
    if (!body.batchType || !body.title) {
      return jsonError("batchType and title are required.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data, error } = await supabase
      .from("background_job_batches")
      .insert({
        journey_id: body.journeyId || null,
        user_id: userData.user.id,
        batch_type: body.batchType,
        title: body.title,
        total_items: body.totalItems ?? 0,
        current_step: body.currentStep || null,
        metadata: body.metadata ?? {},
      })
      .select("*")
      .single();

    if (error || !data) throw error || new Error("Could not create batch.");

    return NextResponse.json({ batch: mapBatch(data as BatchRow) });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not create job batch.",
      500,
    );
  }
}
