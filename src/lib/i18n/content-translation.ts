import { createHash } from "crypto";
import { translateText } from "@/lib/translation/provider";

export type ContentTranslationSourceType =
  | "memory"
  | "comment"
  | "chat_message"
  | "trip"
  | "plan_item"
  | "expense"
  | "summary"
  | "caption";

export function hashSourceText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function detectSourceLanguage(text: string) {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh-CN";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  return "en";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function collectProtectedEntities(
  text: string,
  extraEntities: string[] = [],
) {
  const patterns = [
    /\b[A-Z][A-Z0-9]{1,}(?:[-_/][A-Z0-9]{2,})*\b/g,
    /\b[A-Z]{2}\d{2,5}\b/g,
    /\b[A-Z]{3}\b/g,
    /\b[A-Z]{3}\s?\d{1,4}\b/g,
    /\b[A-Z]{2,3}\d[A-Z0-9]?\s?\d[A-Z]{2}\b/g,
    /\b[A-Z]{3}\b/g,
    /\b(?:NZD|USD|EUR|GBP|DKK|ISK|JPY|KRW|CNY|AUD|CAD|CHF|SEK|NOK)\b/g,
    /https?:\/\/[^\s]+/g,
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    /\+?\d[\d\s().-]{7,}\d/g,
  ];

  return unique([
    ...extraEntities,
    ...patterns.flatMap((pattern) => text.match(pattern) ?? []),
  ]).sort((left, right) => right.length - left.length);
}

export function protectEntities(text: string, entities: string[]) {
  const replacements: Array<{ token: string; value: string }> = [];
  let protectedText = text;

  entities.forEach((entity, index) => {
    const token = `__OTR_ENTITY_${index + 1}__`;
    if (!protectedText.includes(entity)) return;
    protectedText = protectedText.split(entity).join(token);
    replacements.push({ token, value: entity });
  });

  return { protectedText, replacements };
}

export function restoreEntities(
  text: string,
  replacements: Array<{ token: string; value: string }>,
) {
  return replacements.reduce(
    (current, replacement) =>
      current.split(replacement.token).join(replacement.value),
    text,
  );
}

export async function translateUserContent(input: {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  protectedEntities?: string[];
}) {
  const entities = collectProtectedEntities(input.text, input.protectedEntities);
  const { protectedText, replacements } = protectEntities(input.text, entities);
  const translated = await translateText({
    text: protectedText,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
  });

  return {
    translatedText: restoreEntities(translated.translatedText, replacements),
    engine: translated.engine,
  };
}
