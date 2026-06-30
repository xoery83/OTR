import { toLibreTranslateLanguageCode } from "./languages";

export type TranslationEngine =
  | "libretranslate"
  | "deepseek"
  | "openai"
  | "disabled";

export type TranslateTextInput = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export type TranslateTextResult = {
  translatedText: string;
  engine: TranslationEngine;
  sourceLanguage: string;
  targetLanguage: string;
};

type LibreTranslateResponse = {
  translatedText?: string;
  error?: string;
};

function configuredProvider(): TranslationEngine {
  const provider = process.env.TRANSLATION_PROVIDER?.toLowerCase();
  if (
    provider === "libretranslate" ||
    provider === "deepseek" ||
    provider === "openai" ||
    provider === "disabled"
  ) {
    return provider;
  }

  return "libretranslate";
}

async function translateWithLibreTranslate(
  input: TranslateTextInput,
): Promise<TranslateTextResult> {
  const baseUrl = process.env.TRANSLATION_API_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.TRANSLATION_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("TRANSLATION_API_BASE_URL and TRANSLATION_API_KEY are required.");
  }

  const sourceLanguage = toLibreTranslateLanguageCode(input.sourceLanguage);
  const targetLanguage = toLibreTranslateLanguageCode(input.targetLanguage);

  const response = await fetch(`${baseUrl}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: input.text,
      source: sourceLanguage,
      target: targetLanguage,
      format: "text",
      api_key: apiKey,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | LibreTranslateResponse
    | Record<string, never>;

  if (!response.ok || !("translatedText" in payload) || !payload.translatedText) {
    throw new Error(
      "error" in payload && payload.error
        ? payload.error
        : "LibreTranslate request failed.",
    );
  }

  return {
    translatedText: payload.translatedText,
    engine: "libretranslate",
    sourceLanguage,
    targetLanguage,
  };
}

export async function translateText(
  input: TranslateTextInput,
): Promise<TranslateTextResult> {
  const text = input.text.trim();
  if (!text) {
    return {
      translatedText: "",
      engine: "disabled",
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
    };
  }

  const provider = configuredProvider();
  if (provider === "disabled") {
    throw new Error("Translation provider is disabled.");
  }

  if (provider === "libretranslate") {
    return translateWithLibreTranslate({ ...input, text });
  }

  throw new Error(`Translation provider ${provider} is not implemented yet.`);
}
