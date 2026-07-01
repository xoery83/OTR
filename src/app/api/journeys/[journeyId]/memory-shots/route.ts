import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { listMemoryShots } from "@/lib/memory-shots";

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

async function requireJourneyAccess(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  journeyId: string,
) {
  const { data, error } = await supabase
    .from("trips")
    .select("id")
    .eq("id", journeyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new HttpError("You must be a journey member to view Memory Shots.", 403);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ journeyId: string }> },
) {
  try {
    const { journeyId } = await context.params;
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    await requireJourneyAccess(supabase, journeyId);

    const memoryShots = await listMemoryShots(journeyId, {
      supabase,
      limit: 20,
    });

    return NextResponse.json({ memoryShots });
  } catch (error) {
    return jsonError(
      errorMessage(error, "Could not load Memory Shots."),
      error instanceof HttpError ? error.status : 500,
    );
  }
}
