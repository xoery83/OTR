import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { classifyCapture2SafeIntent } from "@/lib/capture2/safe-classifier";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const CAPTURE2_TRANSCRIPTION_PROMPT = [
  "这是 OTR Journey 旅行应用的中文语音输入。",
  "用户常说：今天都有什么行程、今天有什么安排、导航去酒店、停车50欧、加油100欧、今晚订了酒店。",
  "请保留中文语义，特别注意把旅行语境里的“行程”不要误写成“形成”。",
  "地名、人名、货币可以保留中英混合。",
].join("\n");

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

function sttEndpoint(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/stt/transcribe`;
}

function isLikelyEmptyCapture2Transcript(value: string) {
  const normalized = value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？、]/g, "");
  if (!normalized) return true;

  const promptSamples = [
    "今天都有什么行程",
    "今天有什么安排",
    "导航去酒店",
    "停车50欧",
    "加油100欧",
    "今晚订了酒店",
  ];
  const sampleHits = promptSamples.filter((sample) =>
    normalized.includes(sample.replace(/\s+/g, "")),
  ).length;
  if (sampleHits >= 3) return true;

  return /^(嗯+|啊+|呃+|额+|唔+|silence|blank|nospeech)$/i.test(normalized);
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

function parseMetadata(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

type TranscriptionOptions = {
  preferOpenAi?: boolean;
  language?: string;
  prompt?: string;
};

async function transcribeAudio(file: File, options: TranscriptionOptions = {}) {
  if (options.preferOpenAi && process.env.OPENAI_API_KEY) {
    try {
      return await transcribeWithOpenAi(file, options);
    } catch (openAiError) {
      try {
        return await transcribeWithAiServer(file, options);
      } catch {
        throw openAiError;
      }
    }
  }

  try {
    return await transcribeWithAiServer(file, options);
  } catch (error) {
    if (!process.env.OPENAI_API_KEY) {
      throw error;
    }
    return transcribeWithOpenAi(file, options);
  }
}

async function transcribeWithAiServer(file: File, options: TranscriptionOptions = {}) {
  const aiServerUrl = process.env.STT_SERVICE_URL || process.env.AI_SERVER_URL;
  const aiServerSecret = process.env.AI_SERVER_SECRET;
  if (!aiServerUrl || !aiServerSecret) {
    throw new Error("STT_SERVICE_URL/AI_SERVER_URL or AI_SERVER_SECRET is not configured.");
  }

  const formData = new FormData();
  formData.append("audio", file, file.name || "capture-audio.webm");
  if (options.language) formData.append("language", options.language);
  if (options.prompt) formData.append("prompt", options.prompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(sttEndpoint(aiServerUrl), {
      method: "POST",
      headers: {
        "x-ai-server-secret": aiServerSecret,
      },
      body: formData,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`AI Server STT failed: ${text.slice(0, 300)}`);
    }
    const payload = JSON.parse(text) as {
      text?: string;
      provider?: string;
      model?: string;
      language?: string | null;
      duration?: number | null;
      segments?: unknown[];
    };
    return {
      text: payload.text?.trim() ?? "",
      rawResponse: payload,
      provider: payload.provider || "faster-whisper",
      model: payload.model || process.env.STT_MODEL_SIZE || "base",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeWithOpenAi(file: File, options: TranscriptionOptions = {}) {
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
  if (options.language) formData.append("language", options.language);
  if (options.prompt) formData.append("prompt", options.prompt);

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
      provider: "openai",
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
    const extraMetadata = parseMetadata(formData.get("metadata"));

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

    const isCapture2Preview = extraMetadata.source === "capture2_preview";
    const transcript = await transcribeAudio(file, {
      preferOpenAi:
        isCapture2Preview && process.env.CAPTURE2_STT_PROVIDER !== "ai_server",
      language: isCapture2Preview ? "zh" : undefined,
      prompt: isCapture2Preview ? CAPTURE2_TRANSCRIPTION_PROMPT : undefined,
    });
    if (!transcript.text) {
      return jsonError("No speech was detected.", 422);
    }
    if (isCapture2Preview && isLikelyEmptyCapture2Transcript(transcript.text)) {
      return jsonError("No speech was detected.", 422);
    }
    const safeClassification =
      isCapture2Preview
        ? classifyCapture2SafeIntent(transcript.text)
        : null;

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
          ...extraMetadata,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          transcriptionProvider: transcript.provider,
          transcriptionModel: transcript.model,
          rawTranscriptionResponse: transcript.rawResponse,
          ...(safeClassification
            ? {
                safeClassifier: {
                  version: "v2",
                  ...safeClassification,
                },
              }
            : {}),
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
      provider: transcript.provider,
      model: transcript.model,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not transcribe audio.";
    return jsonError(message, 500);
  }
}
