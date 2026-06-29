import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

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

function normalizeActivityKeys(input: unknown) {
  if (!input || typeof input !== "object") return [];
  const activityKeys = (input as { activityKeys?: unknown }).activityKeys;
  if (!Array.isArray(activityKeys)) return [];
  return activityKeys
    .filter((key): key is string => typeof key === "string" && key.length > 0)
    .slice(0, 100);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const activityKeys = normalizeActivityKeys(body);
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    if (activityKeys.length === 0) {
      return NextResponse.json({ activityKeys: [] });
    }

    const { data, error } = await supabase
      .from("background_activity_dismissals")
      .select("activity_key")
      .eq("user_id", userData.user.id)
      .in("activity_key", activityKeys);

    if (error) throw error;

    return NextResponse.json({
      activityKeys: (data ?? [])
        .map((row) => row.activity_key)
        .filter((key): key is string => typeof key === "string"),
    });
  } catch (error) {
    return jsonError(
      errorMessage(error, "Could not load dismissed background activity."),
      500,
    );
  }
}
