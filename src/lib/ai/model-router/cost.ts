import "server-only";

import type {
  ModelRouterProviderName,
  ModelRouterUsage,
} from "./types";

type CostRate = {
  inputPer1k: number;
  outputPer1k: number;
};

const defaultRates: Record<string, CostRate> = {
  "openai:gpt-4.1-mini": { inputPer1k: 0.0004, outputPer1k: 0.0016 },
  "openai:gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "deepseek:deepseek-chat": { inputPer1k: 0.00014, outputPer1k: 0.00028 },
  "qwen:qwen3-vl-plus": { inputPer1k: 0, outputPer1k: 0 },
  "local:metadata-only": { inputPer1k: 0, outputPer1k: 0 },
};

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageTokens(
  messages: Array<{ role: string; content: string }>,
) {
  return messages.reduce(
    (total, message) =>
      total + estimateTokens(`${message.role}\n${message.content}`),
    0,
  );
}

export function usageWithCost(input: {
  provider: ModelRouterProviderName;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): ModelRouterUsage {
  const inputTokens = Math.max(0, Math.ceil(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.ceil(input.outputTokens ?? 0));
  const rate = defaultRates[`${input.provider}:${input.model}`] ?? {
    inputPer1k: 0,
    outputPer1k: 0,
  };

  return {
    inputTokens,
    outputTokens,
    costEstimate:
      (inputTokens / 1000) * rate.inputPer1k +
      (outputTokens / 1000) * rate.outputPer1k,
    currency: "USD",
  };
}

export function emptyUsage(): ModelRouterUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costEstimate: 0,
    currency: "USD",
  };
}

