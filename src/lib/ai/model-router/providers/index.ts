import "server-only";

import { createOpenAiCompatibleProvider } from "./openai-compatible";

export const openAiChatProvider = createOpenAiCompatibleProvider({
  name: "openai",
  apiKeyEnv: "OPENAI_API_KEY",
  baseUrlEnv: ["OPENAI_BASE_URL", "OPENAI_API_URL"],
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultModelEnv: "OPENAI_MODEL",
  defaultModel: "gpt-4.1-mini",
});

export const deepSeekChatProvider = createOpenAiCompatibleProvider({
  name: "deepseek",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  baseUrlEnv: ["DEEPSEEK_BASE_URL", "DEEPSEEK_API_URL"],
  defaultBaseUrl: "https://api.deepseek.com",
  defaultModelEnv: "DEEPSEEK_MODEL",
  defaultModel: "deepseek-chat",
});

