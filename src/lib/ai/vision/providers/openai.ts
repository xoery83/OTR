import "server-only";

import {
  VisionProviderError,
  type VisionProvider,
  type VisionProviderInput,
  type VisionProviderResult,
} from "../types";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

function openAiEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/chat/completions`
    : normalizedBaseUrl.includes("api.openai.com")
      ? `${normalizedBaseUrl}/v1/chat/completions`
      : `${normalizedBaseUrl}/chat/completions`;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringifyModelValue(item))
    .filter(Boolean)
    .slice(0, 24);
}

function stringifyModelValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyModelValue(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "name", "description", "label", "value", "title", "content"]) {
      const nested = stringifyModelValue(record[key]);
      if (nested) return nested;
    }
    return JSON.stringify(record);
  }
  return String(value).trim();
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed) as Record<string, unknown>;
}

function normalizeVisionPayload(
  payload: Record<string, unknown>,
  provider: string,
  model: string,
): VisionProviderResult {
  const confidence = Number(payload.confidence);
  return {
    summary: stringifyModelValue(payload.summary),
    tags: asStringArray(payload.tags),
    people: asStringArray(payload.people),
    locationHints: asStringArray(payload.locationHints),
    activities: asStringArray(payload.activities),
    objects: asStringArray(payload.objects),
    food: asStringArray(payload.food),
    ocrText: stringifyModelValue(payload.ocrText),
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0.7,
    provider,
    model,
    rawResponse: payload,
  };
}

async function postVisionChat(input: VisionProviderInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new VisionProviderError("OPENAI_API_KEY is not configured.", "openai");
  }

  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_OPENAI_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(
      openAiEndpoint(
        process.env.OPENAI_BASE_URL ||
          process.env.OPENAI_API_URL ||
          "https://api.openai.com/v1",
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content:
                "You analyze travel photos for OTR. Return only compact JSON. Do not identify people by name.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `${input.prompt}\n\nReturn JSON with summary, tags, people, locationHints, activities, objects, food, ocrText, confidence.`,
                },
                {
                  type: "image_url",
                  image_url: { url: input.imageUrl, detail: "low" },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new VisionProviderError(
        `OpenAI vision request failed: ${text.slice(0, 300)}`,
        "openai",
      );
    }

    const responsePayload = JSON.parse(text) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = responsePayload.choices?.[0]?.message?.content;
    if (!content) {
      throw new VisionProviderError("OpenAI vision returned empty content.", "openai");
    }

    const parsed = parseJsonContent(content);
    return {
      result: normalizeVisionPayload(parsed, "openai", model),
      rawResponse: responsePayload,
    };
  } catch (error) {
    if (error instanceof VisionProviderError) throw error;
    throw new VisionProviderError("OpenAI vision request failed.", "openai", error);
  } finally {
    clearTimeout(timeout);
  }
}

export const openAiVisionProvider: VisionProvider = {
  name: "openai",
  async analyzeImage(input) {
    const { result, rawResponse } = await postVisionChat(input);
    return { ...result, rawResponse };
  },
};
