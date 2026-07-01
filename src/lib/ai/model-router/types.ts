import "server-only";

import type {
  AnalyzeImageInput,
  VisionAnalysis,
  VisionProviderResult,
} from "@/lib/ai/vision/types";

export type ModelRouterCapability = "chat" | "vision" | "translation";

export type ModelRouterProviderName = "local" | "openai" | "deepseek" | "qwen";

export type ModelRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelRouterUsage = {
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  currency: "USD";
};

export type ModelRouterAttempt = {
  provider: ModelRouterProviderName;
  model: string;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  usage: ModelRouterUsage;
  error?: string;
};

export type ModelRouterMetadata = {
  provider: ModelRouterProviderName;
  model: string;
  capability: ModelRouterCapability;
  attempts: ModelRouterAttempt[];
  usage: ModelRouterUsage;
};

export type ModelRouterResult<T> = T & {
  router: ModelRouterMetadata;
};

export type ModelRouterChatInput = {
  messages: ModelRouterMessage[];
  task?: string;
  provider?: ModelRouterProviderName;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  responseFormat?: "text" | "json";
};

export type ModelRouterChatResult = {
  content: string;
  rawResponse: unknown;
};

export type ModelRouterTranslateInput = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  task?: string;
  provider?: ModelRouterProviderName;
  model?: string;
  timeoutMs?: number;
};

export type ModelRouterTranslateResult = {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export type ModelRouterVisionInput = AnalyzeImageInput & {
  provider?: ModelRouterProviderName;
  task?: string;
};

export type ModelRouterVisionResult = VisionProviderResult;

export type PublicVisionAnalysis = ModelRouterResult<VisionAnalysis>;

export type ChatProvider = {
  name: Exclude<ModelRouterProviderName, "local" | "qwen">;
  defaultModel: string;
  generate(input: Required<ModelRouterChatInput>): Promise<{
    content: string;
    model: string;
    usage: Partial<ModelRouterUsage>;
    rawResponse: unknown;
  }>;
};

