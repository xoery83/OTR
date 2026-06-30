import en from "@/locales/en.json";
import type { PartialTranslationDictionary, TranslationKey } from "./dictionaries";

export const menuLanguagePackPromptVersion = "menu-pack-v2";

type MenuTranslationProvider = "openai" | "deepseek" | "bailian";

type ProviderConfig = {
  provider: MenuTranslationProvider;
  apiKey: string;
  endpoint: string;
  model: string;
};

type GenerateMenuLanguagePackInput = {
  existingTranslations?: PartialTranslationDictionary | null;
  fullRegenerate?: boolean;
  targetLanguage: string;
};

type GenerateMenuLanguagePackResult = {
  content: PartialTranslationDictionary;
  generatedKeyCount: number;
  missingKeysCount: number;
  model: string;
  provider: MenuTranslationProvider;
  promptVersion: string;
  tokenEstimate: number;
  totalKeyCount: number;
};

type ValidationResult = {
  extraKeys: string[];
  missingKeys: string[];
  placeholderErrors: string[];
};

const brandTerms = [
  "OTR",
  "Journey",
  "Capture",
  "Google Drive",
  "Supabase",
  "Vercel",
  "Hetzner",
];
const chunkSize = 120;
const protectedAcronymPattern = /\b[A-Z][A-Z0-9]{1,}(?:[-_/][A-Z0-9]{2,})*\b/g;

function sourceEntries() {
  return Object.entries(en) as Array<[TranslationKey, string]>;
}

export function sourceMenuLanguagePack() {
  return en as Record<TranslationKey, string>;
}

function openAiEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/chat/completions`
    : normalizedBaseUrl.includes("api.openai.com")
      ? `${normalizedBaseUrl}/v1/chat/completions`
      : `${normalizedBaseUrl}/chat/completions`;
}

function getProviderConfig(): ProviderConfig {
  const preferred = process.env.MENU_TRANSLATION_PROVIDER?.toLowerCase();
  const configs: ProviderConfig[] = [];

  if (process.env.OPENAI_API_KEY) {
    configs.push({
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      endpoint: openAiEndpoint(
        process.env.OPENAI_BASE_URL ||
          process.env.OPENAI_API_URL ||
          "https://api.openai.com/v1",
      ),
      model:
        process.env.MENU_TRANSLATION_MODEL ||
        process.env.OPENAI_MODEL ||
        "gpt-4.1-mini",
    });
  }

  if (process.env.DEEPSEEK_API_KEY) {
    configs.push({
      provider: "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY,
      endpoint: `${(
        process.env.DEEPSEEK_BASE_URL ||
        process.env.DEEPSEEK_API_URL ||
        "https://api.deepseek.com"
      ).replace(/\/$/, "")}/chat/completions`,
      model:
        process.env.MENU_TRANSLATION_MODEL ||
        process.env.DEEPSEEK_MODEL ||
        "deepseek-chat",
    });
  }

  const bailianKey =
    process.env.BAILIAN_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.ALIBABA_API_KEY;
  if (bailianKey) {
    configs.push({
      provider: "bailian",
      apiKey: bailianKey,
      endpoint: `${(
        process.env.BAILIAN_BASE_URL ||
        process.env.DASHSCOPE_BASE_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1"
      ).replace(/\/$/, "")}/chat/completions`,
      model:
        process.env.MENU_TRANSLATION_MODEL ||
        process.env.BAILIAN_MODEL ||
        "qwen-plus",
    });
  }

  if (preferred === "openai" || preferred === "deepseek" || preferred === "bailian") {
    const preferredConfig = configs.find((config) => config.provider === preferred);
    if (preferredConfig) return preferredConfig;
    throw new Error(`MENU_TRANSLATION_PROVIDER ${preferred} is not configured.`);
  }

  const fallback = configs.find((config) => config.provider === "deepseek") ?? configs[0];
  if (!fallback) {
    throw new Error(
      "Missing menu translation LLM configuration. Set MENU_TRANSLATION_PROVIDER and its API key.",
    );
  }

  return fallback;
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function parseTranslationJson(content: string) {
  const parsed = JSON.parse(extractJsonObject(content)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response must be a JSON object.");
  }

  const translations: Record<string, string> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
    translations[key] = typeof value === "string" ? value : String(value ?? "");
  });
  return translations;
}

function tokens(value: string) {
  return [
    ...value.matchAll(/\{\{\s*[\w.-]+\s*\}\}/g),
    ...value.matchAll(/\{[\w.-]+\}/g),
    ...value.matchAll(/%[sd]/g),
    ...value.matchAll(/<\/?[a-z][^>]*>/gi),
    ...value.matchAll(protectedAcronymPattern),
  ].map((match) => match[0]).sort();
}

function sameTokens(source: string, translated: string) {
  const sourceTokens = tokens(source);
  const translatedTokens = tokens(translated);
  return (
    sourceTokens.length === translatedTokens.length &&
    sourceTokens.every((value, index) => value === translatedTokens[index])
  );
}

function preserveSourceTokens(source: string, translated: string) {
  if (sameTokens(source, translated)) return translated;

  const sourceTokens = tokens(source);
  const translatedTokens = tokens(translated);
  if (sourceTokens.length === 0) return translated;

  if (sourceTokens.length !== translatedTokens.length) {
    return source;
  }

  let repaired = translated;
  translatedTokens.forEach((translatedToken, index) => {
    repaired = repaired.replace(translatedToken, sourceTokens[index]);
  });

  return sameTokens(source, repaired) ? repaired : source;
}

function repairPlaceholderMismatches(
  sourceSubset: Record<string, string>,
  generated: Record<string, string>,
) {
  const repaired = { ...generated };
  Object.entries(sourceSubset).forEach(([key, sourceValue]) => {
    const translatedValue = repaired[key];
    if (translatedValue === undefined) return;
    repaired[key] = preserveSourceTokens(sourceValue, translatedValue);
  });
  return repaired;
}

function validateGeneratedKeys(
  sourceSubset: Record<string, string>,
  generated: Record<string, string>,
): ValidationResult {
  const sourceKeys = Object.keys(sourceSubset).sort();
  const generatedKeys = Object.keys(generated).sort();
  const sourceSet = new Set(sourceKeys);
  const generatedSet = new Set(generatedKeys);
  const missingKeys = sourceKeys.filter((key) => !generatedSet.has(key));
  const extraKeys = generatedKeys.filter((key) => !sourceSet.has(key));
  const placeholderErrors = sourceKeys.filter(
    (key) =>
      generated[key] !== undefined &&
      !sameTokens(sourceSubset[key] ?? "", generated[key] ?? ""),
  );

  return { extraKeys, missingKeys, placeholderErrors };
}

function assertValidSubset(
  sourceSubset: Record<string, string>,
  generated: Record<string, string>,
) {
  const validation = validateGeneratedKeys(sourceSubset, generated);
  const errors = [
    validation.missingKeys.length
      ? `Missing keys: ${validation.missingKeys.slice(0, 8).join(", ")}`
      : null,
    validation.extraKeys.length
      ? `Extra keys: ${validation.extraKeys.slice(0, 8).join(", ")}`
      : null,
    validation.placeholderErrors.length
      ? `Placeholder mismatch: ${validation.placeholderErrors.slice(0, 8).join(", ")}`
      : null,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors.join(" | "));
  }
}

export function validateCompleteLanguagePack(content: Record<string, string>) {
  const source = sourceMenuLanguagePack();
  const validation = validateGeneratedKeys(source, content);
  if (
    validation.missingKeys.length ||
    validation.extraKeys.length ||
    validation.placeholderErrors.length
  ) {
    return validation;
  }

  return validation;
}

function chunkEntries<T>(entries: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
}

function promptForChunk(
  targetLanguage: string,
  sourceSubset: Record<string, string>,
) {
  return [
    "You are translating UI/menu text for a travel collaboration app called OTR.",
    `Target language: ${targetLanguage}.`,
    "Keep JSON keys exactly unchanged.",
    "Translate only values.",
    "Preserve placeholders such as {name}, {count}, {{variable}}, %s, %d.",
    "Preserve HTML tags / Markdown syntax if any.",
    `Do not translate brand/product names: ${brandTerms.join(", ")}.`,
    "Do not translate all-uppercase acronyms or codes such as TMB, GPS, API, NZD, FI543, or TMB-ABC.",
    "Do not translate file paths, URLs, email addresses, currency codes, airport codes, GPS coordinates.",
    "Return JSON only. No explanation.",
    "",
    "Source JSON:",
    JSON.stringify(sourceSubset, null, 2),
  ].join("\n");
}

async function callLanguagePackModel(
  config: ProviderConfig,
  targetLanguage: string,
  sourceSubset: Record<string, string>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a precise localization engine. Return only valid JSON.",
          },
          { role: "user", content: promptForChunk(targetLanguage, sourceSubset) },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${config.provider} ${response.status}: ${text.slice(0, 500)}`);
    }

    const payload = JSON.parse(text) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${config.provider} returned an empty response.`);

    return parseTranslationJson(content);
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateMenuLanguagePack(
  input: GenerateMenuLanguagePackInput,
): Promise<GenerateMenuLanguagePackResult> {
  const config = getProviderConfig();
  const source = sourceMenuLanguagePack();
  const existing = input.fullRegenerate ? {} : (input.existingTranslations ?? {});
  const entriesToGenerate = sourceEntries().filter(([key, sourceValue]) => {
    if (sourceValue === "") return false;
    const existingValue = existing[key];
    return input.fullRegenerate || typeof existingValue !== "string";
  });
  const merged: PartialTranslationDictionary = input.fullRegenerate
    ? {}
    : Object.fromEntries(
        Object.entries(existing).filter(([key]) => key in source),
      ) as PartialTranslationDictionary;
  let tokenEstimate = 0;

  for (const chunk of chunkEntries(entriesToGenerate, chunkSize)) {
    const sourceSubset = Object.fromEntries(chunk);
    tokenEstimate += Math.ceil(JSON.stringify(sourceSubset).length / 4);
    const translated = repairPlaceholderMismatches(
      sourceSubset,
      await callLanguagePackModel(
        config,
        input.targetLanguage,
        sourceSubset,
      ),
    );
    assertValidSubset(sourceSubset, translated);
    Object.assign(merged, translated);
  }

  sourceEntries().forEach(([key, value]) => {
    if (value === "") merged[key] = "";
  });

  const completeValidation = validateCompleteLanguagePack(merged as Record<string, string>);
  if (
    completeValidation.extraKeys.length ||
    completeValidation.missingKeys.length ||
    completeValidation.placeholderErrors.length
  ) {
    throw new Error(
      [
        completeValidation.missingKeys.length
          ? `Missing keys: ${completeValidation.missingKeys.slice(0, 8).join(", ")}`
          : null,
        completeValidation.extraKeys.length
          ? `Extra keys: ${completeValidation.extraKeys.slice(0, 8).join(", ")}`
          : null,
        completeValidation.placeholderErrors.length
          ? `Placeholder mismatch: ${completeValidation.placeholderErrors
              .slice(0, 8)
              .join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }

  return {
    content: merged,
    generatedKeyCount: entriesToGenerate.length,
    missingKeysCount: completeValidation.missingKeys.length,
    model: config.model,
    provider: config.provider,
    promptVersion: menuLanguagePackPromptVersion,
    tokenEstimate,
    totalKeyCount: sourceEntries().length,
  };
}
