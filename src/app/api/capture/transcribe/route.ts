import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function openAiAudioEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/audio/transcriptions`
    : normalizedBaseUrl.includes("api.openai.com")
      ? `${normalizedBaseUrl}/v1/audio/transcriptions`
      : `${normalizedBaseUrl}/audio/transcriptions`;
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

async function transcribeAudio(file: File) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "capture-audio.webm");
  formData.append(
    "model",
    process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
  );
  formData.append("response_format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(
      openAiAudioEndpoint(
        process.env.OPENAI_BASE_URL ||
          process.env.OPENAI_API_URL ||
          "https://api.openai.com/v1",
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: controller.signal,
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Transcription failed: ${text.slice(0, 300)}`);
    }

    const payload = JSON.parse(text) as { text?: string };
    return {
      text: payload.text?.trim() ?? "",
      rawResponse: payload,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const tripId = String(formData.get("tripId") || "");
    const timezone = String(formData.get("timezone") || "");
    const capturedAt = String(formData.get("capturedAt") || new Date().toISOString());
    const file = formData.get("audio");

    if (!tripId) {
      return jsonError("tripId is required.", 400);
    }

    if (!(file instanceof File)) {
      return jsonError("audio file is required.", 400);
    }

    if (file.size > MAX_AUDIO_BYTES) {
      return jsonError("Audio file is too large.", 413);
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

    const transcript = await transcribeAudio(file);
    if (!transcript.text) {
      return jsonError("No speech was detected.", 422);
    }

    const { data: eventRow, error: insertError } = await supabase
      .from("journey_capture_events")
      .insert({
        journey_id: tripId,
        user_id: userData.user.id,
        input_type: "voice",
        original_input: transcript.text,
        transcription_text: transcript.text,
        captured_at: new Date(capturedAt).toISOString(),
        timezone: timezone || null,
        metadata: {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          transcriptionProvider: "openai",
          transcriptionModel: transcript.model,
          rawTranscriptionResponse: transcript.rawResponse,
        },
        status: "raw",
      })
      .select("id")
      .single();

    if (insertError || !eventRow) {
      throw insertError || new Error("Could not save capture event.");
    }

    return NextResponse.json({
      captureEventId: eventRow.id,
      transcript: transcript.text,
      provider: "openai",
      model: transcript.model,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not transcribe audio.";
    return jsonError(message, 500);
  }
}

