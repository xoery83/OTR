import "server-only";

import {
  estimateMessageTokens,
  estimateTokens,
  usageWithCost,
} from "../cost";
import type { ChatProvider, ModelRouterChatInput } from "../types";

type OpenAiCompatibleProviderConfig = {
  name: "openai" | "deepseek";
  apiKeyEnv: string;
  baseUrlEnv: string[];
  defaultBaseUrl: string;
  defaultModelEnv: string;
  defaultModel: string;
};

type ChatCompletionResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

function endpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/chat/completions")
    ? normalizedBaseUrl
    : normalizedBaseUrl.endsWith("/v1")
      ? `${normalizedBaseUrl}/chat/completions`
      : normalizedBaseUrl.includes("api.openai.com")
        ? `${normalizedBaseUrl}/v1/chat/completions`
        : `${normalizedBaseUrl}/chat/completions`;
}

function envValue(keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return null;
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig,
): ChatProvider {
  return {
    name: config.name,
    defaultModel: process.env[config.defaultModelEnv] || config.defaultModel,
    async generate(input: Required<ModelRouterChatInput>) {
      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) {
        throw new Error(`${config.apiKeyEnv} is not configured.`);
      }

      const model = input.model || this.defaultModel;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

      try {
        const response = await fetch(
          endpoint(envValue(config.baseUrlEnv) || config.defaultBaseUrl),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              messages: input.messages,
              temperature: input.temperature,
              max_tokens: input.maxTokens,
              ...(input.responseFormat === "json"
                ? { response_format: { type: "json_object" } }
                : {}),
            }),
          },
        );
        const text = await response.text();
        if (!response.ok) {
          throw new Error(
            `${config.name} request failed: ${text.slice(0, 300)}`,
          );
        }

        const payload = JSON.parse(text) as ChatCompletionResponse;
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new Error(`${config.name} returned empty content.`);
        }

        const usage = usageWithCost({
          provider: config.name,
          model,
          inputTokens:
            payload.usage?.prompt_tokens ??
            estimateMessageTokens(input.messages),
          outputTokens:
            payload.usage?.completion_tokens ?? estimateTokens(content),
        });

        return {
          content,
          model,
          usage,
          rawResponse: payload,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

