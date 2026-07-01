import "server-only";

import { emptyVisionAnalysis } from "@/lib/ai/vision/types";
import { openAiVisionProvider } from "@/lib/ai/vision/providers/openai";
import { qwenVisionProvider } from "@/lib/ai/vision/providers/qwen";
import { emptyUsage, estimateTokens, usageWithCost } from "./cost";
import { deepSeekChatProvider, openAiChatProvider } from "./providers";
import type {
  ChatProvider,
  ModelRouterAttempt,
  ModelRouterCapability,
  ModelRouterChatInput,
  ModelRouterChatResult,
  ModelRouterProviderName,
  ModelRouterResult,
  ModelRouterTranslateInput,
  ModelRouterTranslateResult,
  ModelRouterUsage,
  ModelRouterVisionInput,
  ModelRouterVisionResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_PROMPT =
  "Analyze this travel photo for search, grouping, memory recall, and timeline context.";

const chatProviders: Record<"openai" | "deepseek", ChatProvider> = {
  openai: openAiChatProvider,
  deepseek: deepSeekChatProvider,
};

const visionProviders = {
  openai: openAiVisionProvider,
  qwen: qwenVisionProvider,
};

function nowIso() {
  return new Date().toISOString();
}

function envProvider(
  key: string,
  allowed: ModelRouterProviderName[],
): ModelRouterProviderName | null {
  const provider = process.env[key]?.toLowerCase();
  return allowed.includes(provider as ModelRouterProviderName)
    ? (provider as ModelRouterProviderName)
    : null;
}

function routeForChat(
  preferred?: ModelRouterProviderName,
): Array<"openai" | "deepseek"> {
  if (preferred === "openai" || preferred === "deepseek") return [preferred];
  const configured = envProvider("AI_CHAT_PROVIDER", ["openai", "deepseek"]);
  const primary =
    configured === "openai" || configured === "deepseek"
      ? configured
      : process.env.DEEPSEEK_API_KEY
        ? "deepseek"
        : "openai";
  return primary === "deepseek" ? ["deepseek", "openai"] : ["openai", "deepseek"];
}

function routeForTranslation(
  preferred?: ModelRouterProviderName,
): Array<"openai" | "deepseek"> {
  if (preferred === "openai" || preferred === "deepseek") return [preferred];
  const configured = envProvider("AI_TRANSLATION_PROVIDER", [
    "openai",
    "deepseek",
  ]);
  const primary =
    configured === "openai" || configured === "deepseek"
      ? configured
      : process.env.DEEPSEEK_API_KEY
        ? "deepseek"
        : "openai";
  return primary === "deepseek" ? ["deepseek", "openai"] : ["openai", "deepseek"];
}

function routeForVision(
  preferred?: ModelRouterProviderName,
  mode?: string,
): Array<"local" | "openai" | "qwen"> {
  if (preferred === "local" || preferred === "openai" || preferred === "qwen") {
    return [preferred];
  }
  if (mode === "basic") return ["local"];
  const configured = envProvider("IMAGE_INDEX_VISION_PROVIDER", [
    "openai",
    "qwen",
  ]);
  if (mode === "reasoning") return ["openai", "qwen"];
  return configured === "openai" ? ["openai", "qwen"] : ["qwen", "openai"];
}

function buildAttempt(input: {
  provider: ModelRouterProviderName;
  model: string;
  status: "completed" | "failed";
  startedAt: string;
  usage?: ModelRouterUsage;
  error?: unknown;
}): ModelRouterAttempt {
  return {
    provider: input.provider,
    model: input.model,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: nowIso(),
    usage: input.usage ?? emptyUsage(),
    ...(input.error ? { error: errorMessage(input.error) } : {}),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logAttempt(
  capability: ModelRouterCapability,
  task: string,
  attempt: ModelRouterAttempt,
) {
  const payload = {
    capability,
    task,
    provider: attempt.provider,
    model: attempt.model,
    status: attempt.status,
    inputTokens: attempt.usage.inputTokens,
    outputTokens: attempt.usage.outputTokens,
    costEstimate: attempt.usage.costEstimate,
    error: attempt.error,
  };

  if (attempt.status === "failed") {
    console.error("[model-router]", payload);
  } else {
    console.info("[model-router]", payload);
  }
}

function withRouter<T>(
  capability: ModelRouterCapability,
  value: T,
  attempts: ModelRouterAttempt[],
): ModelRouterResult<T> {
  const completed = attempts.find((attempt) => attempt.status === "completed");
  if (!completed) {
    throw new Error("Model Router result requires a completed attempt.");
  }

  return {
    ...value,
    router: {
      provider: completed.provider,
      model: completed.model,
      capability,
      attempts,
      usage: completed.usage,
    },
  };
}

async function generateChatWithRoute(
  input: ModelRouterChatInput,
  route: Array<"openai" | "deepseek">,
): Promise<ModelRouterResult<ModelRouterChatResult>> {
  const task = input.task ?? "chat";
  const attempts: ModelRouterAttempt[] = [];

  for (const providerName of route) {
    const provider = chatProviders[providerName];
    const model = input.model || provider.defaultModel;
    const startedAt = nowIso();

    try {
      const result = await provider.generate({
        messages: input.messages,
        task,
        provider: providerName,
        model,
        temperature: input.temperature ?? 0.2,
        maxTokens: input.maxTokens ?? 1200,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        responseFormat: input.responseFormat ?? "text",
      });
      const attempt = buildAttempt({
        provider: providerName,
        model: result.model,
        status: "completed",
        startedAt,
        usage: {
          ...emptyUsage(),
          ...result.usage,
          currency: "USD",
        },
      });
      attempts.push(attempt);
      logAttempt("chat", task, attempt);
      return withRouter(
        "chat",
        {
          content: result.content,
          rawResponse: result.rawResponse,
        },
        attempts,
      );
    } catch (error) {
      const attempt = buildAttempt({
        provider: providerName,
        model,
        status: "failed",
        startedAt,
        error,
      });
      attempts.push(attempt);
      logAttempt("chat", task, attempt);
    }
  }

  throw new Error(
    `Model Router chat failed: ${attempts.map((attempt) => attempt.error).join(" | ")}`,
  );
}

export async function generateChat(
  input: ModelRouterChatInput,
): Promise<ModelRouterResult<ModelRouterChatResult>> {
  return generateChatWithRoute(input, routeForChat(input.provider));
}

export async function translateText(
  input: ModelRouterTranslateInput,
): Promise<ModelRouterResult<ModelRouterTranslateResult>> {
  const text = input.text.trim();
  if (!text) {
    return withRouter(
      "translation",
      {
        translatedText: "",
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
      },
      [
        buildAttempt({
          provider: "local",
          model: "empty-translation",
          status: "completed",
          startedAt: nowIso(),
        }),
      ],
    );
  }

  const result = await generateChatWithRoute(
    {
      task: input.task ?? "translation",
      provider: input.provider,
      model: input.model,
      timeoutMs: input.timeoutMs,
      temperature: 0,
      maxTokens: Math.max(256, Math.ceil(text.length * 1.5)),
      messages: [
        {
          role: "system",
          content:
            "Translate the user's text. Return only the translated text, with no explanation.",
        },
        {
          role: "user",
          content: `Source language: ${input.sourceLanguage}\nTarget language: ${input.targetLanguage}\n\n${text}`,
        },
      ],
    },
    routeForTranslation(input.provider),
  );

  return {
    translatedText: result.content,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    router: {
      ...result.router,
      capability: "translation",
    },
  };
}

export async function analyzeImage(
  input: ModelRouterVisionInput,
): Promise<ModelRouterResult<ModelRouterVisionResult>> {
  const task = input.task ?? "vision";
  const attempts: ModelRouterAttempt[] = [];
  const prompt = input.prompt ?? DEFAULT_PROMPT;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mode = input.mode ?? "vision";

  for (const providerName of routeForVision(input.provider, mode)) {
    const startedAt = nowIso();
    const model =
      providerName === "local"
        ? "metadata-only"
        : providerName === "openai"
          ? process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini"
          : process.env.DASHSCOPE_VISION_MODEL || "qwen3-vl-plus";

    try {
      const result =
        providerName === "local"
          ? {
              ...emptyVisionAnalysis("local", "metadata-only"),
              rawResponse: null,
            }
          : await visionProviders[providerName].analyzeImage({
              imageUrl: input.imageUrl,
              prompt,
              mode,
              timeoutMs,
            });
      const usage = usageWithCost({
        provider: providerName,
        model: result.model,
        inputTokens: estimateTokens(`${prompt}\n${input.imageUrl}`),
        outputTokens: estimateTokens(JSON.stringify(result.rawResponse ?? result)),
      });
      const attempt = buildAttempt({
        provider: providerName,
        model: result.model,
        status: "completed",
        startedAt,
        usage,
      });
      attempts.push(attempt);
      logAttempt("vision", task, attempt);
      return withRouter("vision", result, attempts);
    } catch (error) {
      const attempt = buildAttempt({
        provider: providerName,
        model,
        status: "failed",
        startedAt,
        error,
      });
      attempts.push(attempt);
      logAttempt("vision", task, attempt);
    }
  }

  throw new Error(
    `Model Router vision failed: ${attempts.map((attempt) => attempt.error).join(" | ")}`,
  );
}
