import "server-only";

import { openAiVisionProvider } from "./providers/openai";
import { qwenVisionProvider } from "./providers/qwen";
import {
  emptyVisionAnalysis,
  VisionProviderError,
  type AnalyzeImageInput,
  type VisionAnalysis,
  type VisionMode,
  type VisionProvider,
  type VisionProviderName,
  type VisionProviderResult,
} from "./types";

const DEFAULT_PROMPT =
  "Analyze this travel photo for search, grouping, memory recall, and timeline context.";
const DEFAULT_TIMEOUT_MS = 45_000;

const providers: Record<Exclude<VisionProviderName, "local">, VisionProvider> = {
  openai: openAiVisionProvider,
  qwen: qwenVisionProvider,
};

function envProvider() {
  const provider = process.env.IMAGE_INDEX_VISION_PROVIDER?.toLowerCase();
  return provider === "openai" || provider === "qwen" ? provider : null;
}

function defaultProviderForMode(mode: VisionMode): VisionProviderName {
  if (mode === "basic") return "local";
  if (mode === "reasoning") return "openai";
  return "qwen";
}

function providerForMode(mode: VisionMode): VisionProviderName {
  if (mode === "basic") return "local";
  if (mode === "reasoning") return defaultProviderForMode(mode);
  return envProvider() ?? defaultProviderForMode(mode);
}

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

  const providerName = providerForMode(mode);
  if (providerName === "local") {
    return emptyVisionAnalysis("local", "metadata-only");
  }

  const provider = providers[providerName];
  return publicAnalysis(
    await provider.analyzeImage({
      imageUrl,
      prompt,
      mode,
      timeoutMs,
    }),
  );
}

export async function analyzeImageForDebug(
  input: AnalyzeImageInput,
): Promise<VisionProviderResult> {
  const mode = input.mode ?? "vision";
  const providerName = providerForMode(mode);
  if (providerName === "local") {
    return {
      ...emptyVisionAnalysis("local", "metadata-only"),
      rawResponse: null,
    };
  }

  return providers[providerName].analyzeImage({
    imageUrl: input.imageUrl,
    prompt: input.prompt ?? DEFAULT_PROMPT,
    mode,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}

export type { AnalyzeImageInput, VisionAnalysis, VisionMode } from "./types";
