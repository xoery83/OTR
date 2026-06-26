import "server-only";

import {
  VisionProviderError,
  type VisionProvider,
  type VisionProviderInput,
  type VisionProviderResult,
} from "../types";

const DEFAULT_QWEN_MODEL = "qwen3-vl-plus";

function dashScopeEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/chat/completions`
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

export const qwenVisionProvider: VisionProvider = {
  name: "qwen",
  async analyzeImage(input: VisionProviderInput) {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    const baseUrl = process.env.DASHSCOPE_BASE_URL;
    if (!apiKey) {
      throw new VisionProviderError("DASHSCOPE_API_KEY is not configured.", "qwen");
    }
    if (!baseUrl) {
      throw new VisionProviderError("DASHSCOPE_BASE_URL is not configured.", "qwen");
    }

    const model = process.env.DASHSCOPE_VISION_MODEL || DEFAULT_QWEN_MODEL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(dashScopeEndpoint(baseUrl), {
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
                  image_url: { url: input.imageUrl },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new VisionProviderError(
          `Qwen vision request failed: ${text.slice(0, 300)}`,
          "qwen",
        );
      }

      const responsePayload = JSON.parse(text) as {
        choices?: { message?: { content?: string | null } }[];
      };
      const content = responsePayload.choices?.[0]?.message?.content;
      if (!content) {
        throw new VisionProviderError("Qwen vision returned empty content.", "qwen");
      }

      const parsed = parseJsonContent(content);
      const result = normalizeVisionPayload(parsed, "qwen", model);
      return { ...result, rawResponse: responsePayload };
    } catch (error) {
      if (error instanceof VisionProviderError) throw error;
      throw new VisionProviderError("Qwen vision request failed.", "qwen", error);
    } finally {
      clearTimeout(timeout);
    }
  },
};
