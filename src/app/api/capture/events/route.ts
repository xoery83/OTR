import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type CaptureEventRequest = {
  tripId?: string;
  inputType?: "text" | "voice" | "photo" | "video" | "attachment";
  originalInput?: string | null;
  capturedAt?: string | null;
  timezone?: string | null;
  metadata?: Record<string, unknown>;
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
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CaptureEventRequest;
    const tripId = body.tripId;
    const inputType = body.inputType;

    if (!tripId || !inputType) {
      return jsonError("tripId and inputType are required.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return jsonError("Journey not found.", 404);
    }

    const { data: eventRow, error: insertError } = await supabase
      .from("journey_capture_events")
      .insert({
        journey_id: tripId,
        user_id: userData.user.id,
        input_type: inputType,
        original_input: body.originalInput || null,
        captured_at: body.capturedAt
          ? new Date(body.capturedAt).toISOString()
          : new Date().toISOString(),
        timezone: body.timezone || null,
        metadata: body.metadata ?? {},
        status: "raw",
      })
      .select("id")
      .single();

    if (insertError || !eventRow) {
      throw insertError || new Error("Could not save capture event.");
    }

    return NextResponse.json({ captureEventId: eventRow.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save capture event.";
    return jsonError(message, 500);
  }
}

