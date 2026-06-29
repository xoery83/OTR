import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { BackgroundJobStatus } from "@/lib/background-jobs/types";

type DismissActivityInput = {
  type: "job" | "batch";
  id: string;
  status: BackgroundJobStatus;
};

const validStatuses = new Set<BackgroundJobStatus>([
  "queued",
  "uploading",
  "processing",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
]);

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

function normalizeActivities(input: unknown): DismissActivityInput[] {
  if (!input || typeof input !== "object") return [];
  const activities = (input as { activities?: unknown }).activities;
  if (!Array.isArray(activities)) return [];

  return activities
    .map((activity) => {
      if (!activity || typeof activity !== "object") return null;
      const record = activity as Record<string, unknown>;
      const type = record.type;
      const id = record.id;
      const status = record.status;
      if (type !== "job" && type !== "batch") return null;
      if (typeof id !== "string" || id.length === 0) return null;
      if (typeof status !== "string") return null;
      if (!validStatuses.has(status as BackgroundJobStatus)) return null;
      return { type, id, status: status as BackgroundJobStatus };
    })
    .filter((activity): activity is DismissActivityInput => Boolean(activity));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const activities = normalizeActivities(body);
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    if (activities.length === 0) {
      return NextResponse.json({ dismissed: 0 });
    }

    const rows = activities.map((activity) => ({
      user_id: userData.user.id,
      activity_key: `${activity.type}:${activity.id}:${activity.status}`,
      job_id: activity.type === "job" ? activity.id : null,
      batch_id: activity.type === "batch" ? activity.id : null,
      status: activity.status,
    }));

    const { error } = await supabase
      .from("background_activity_dismissals")
      .upsert(rows, {
        onConflict: "user_id,activity_key",
        ignoreDuplicates: true,
      });

    if (error) throw error;

    return NextResponse.json({ dismissed: rows.length });
  } catch (error) {
    return jsonError(
      errorMessage(error, "Could not dismiss background activity."),
      500,
    );
  }
}
