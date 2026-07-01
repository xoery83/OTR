import "server-only";

import { analyzeImage as analyzeImageWithModelRouter } from "@/lib/ai/model-router";
import {
  VisionProviderError,
  type AnalyzeImageInput,
  type VisionAnalysis,
  type VisionProviderResult,
} from "./types";

const DEFAULT_PROMPT =
  "Analyze this travel photo for search, grouping, memory recall, and timeline context.";
const DEFAULT_TIMEOUT_MS = 45_000;

function publicAnalysis(result: VisionProviderResult): VisionAnalysis {
  return {
    summary: result.summary,
    tags: result.tags,
    people: result.people,
    locationHints: result.locationHints,
    activities: result.activities,
    objects: result.objects,
    food: result.food,
    ocrText: result.ocrText,
    confidence: result.confidence,
    provider: result.provider,
    model: result.model,
  };
}

export async function analyzeImage({
  imageUrl,
  prompt = DEFAULT_PROMPT,
  mode = "vision",
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: AnalyzeImageInput): Promise<VisionAnalysis> {
  if (!imageUrl) {
    throw new VisionProviderError("imageUrl is required.", "router");
  }

  return publicAnalysis(
    await analyzeImageWithModelRouter({
      imageUrl,
      prompt,
      mode,
      timeoutMs,
      task: "legacy_vision_analysis",
    }),
  );
}

export async function analyzeImageForDebug(
  input: AnalyzeImageInput,
): Promise<VisionProviderResult> {
  if (!input.imageUrl) {
    throw new VisionProviderError("imageUrl is required.", "router");
  }

  return analyzeImageWithModelRouter({
    imageUrl: input.imageUrl,
    prompt: input.prompt ?? DEFAULT_PROMPT,
    mode: input.mode ?? "vision",
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    task: "legacy_vision_debug",
  });
}

export type { AnalyzeImageInput, VisionAnalysis, VisionMode } from "./types";
