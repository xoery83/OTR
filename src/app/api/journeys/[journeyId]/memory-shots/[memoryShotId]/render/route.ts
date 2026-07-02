import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { renderMemoryShotPreview } from "@/lib/memory-shots/renderer-worker";

type RenderRequest = {
  layoutKey?: string | null;
};

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
    throw new HttpError("Missing authorization header.", 401);
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
    throw new HttpError("You must be a journey member to render Memory Shots.", 403);
  }
}

async function requireMemoryShotInJourney(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  journeyId: string,
  memoryShotId: string,
) {
  const { data, error } = await supabase
    .from("memory_shots")
    .select("id")
    .eq("id", memoryShotId)
    .eq("journey_id", journeyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new HttpError("Memory Shot not found in this journey.", 404);
  }
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ journeyId: string; memoryShotId: string }>;
  },
) {
  try {
    const { journeyId, memoryShotId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as RenderRequest;
    if (body.layoutKey && body.layoutKey !== "cinematic_full_bleed") {
      return jsonError("Only layoutKey=cinematic_full_bleed is supported.", 400);
    }
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    await requireJourneyAccess(supabase, journeyId);
    await requireMemoryShotInJourney(supabase, journeyId, memoryShotId);

    const result = await renderMemoryShotPreview({
      supabase,
      memoryShotId,
      force: true,
      layoutKey: body.layoutKey === "cinematic_full_bleed" ? body.layoutKey : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(
      errorMessage(error, "Could not render Memory Shot preview."),
      error instanceof HttpError ? error.status : 500,
    );
  }
}
