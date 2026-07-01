import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { assessJourneyStoryDay } from "@/lib/story-recommendations";

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

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

function getRequestSupabase(request: Request) {
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

function normalizeDate(value: string | null) {
  if (!value) throw new HttpError("date query parameter is required.", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError("date must use YYYY-MM-DD format.", 400);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError("date is not a valid calendar date.", 400);
  }

  return value;
}

async function requireJourneyMember(
  supabase: ReturnType<typeof getRequestSupabase>,
  journeyId: string,
) {
  const { data, error } = await supabase
    .from("trips")
    .select("id")
    .eq("id", journeyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new HttpError("You must be a journey member to view story day ideas.", 403);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ journeyId: string }> },
) {
  try {
    const { journeyId } = await context.params;
    const url = new URL(request.url);
    const date = normalizeDate(url.searchParams.get("date"));
    const language = url.searchParams.get("language") || "zh-CN";
    const supabase = getRequestSupabase(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    await requireJourneyMember(supabase, journeyId);
    const assessment = await assessJourneyStoryDay({
      journeyId,
      date,
      language,
      options: { supabase },
    });

    return NextResponse.json({ assessment });
  } catch (error) {
    return jsonError(
      errorMessage(error, "Could not assess this story day."),
      error instanceof HttpError ? error.status : 500,
    );
  }
}
