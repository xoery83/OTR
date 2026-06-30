import en from "@/locales/en.json";
import type { PartialTranslationDictionary, TranslationKey } from "./dictionaries";
import { translateTexts } from "@/lib/translation/provider";

const defaultBatchSize = 80;
const placeholderTokenPrefix = "XOTRPH";
const placeholderTokenSuffix = "X";

function placeholders(value: string) {
  return Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
}

function samePlaceholders(source: string, translated: string) {
  const sourcePlaceholders = placeholders(source);
  const translatedPlaceholders = placeholders(translated);

  return (
    sourcePlaceholders.length === translatedPlaceholders.length &&
    sourcePlaceholders.every((value, index) => value === translatedPlaceholders[index])
  );
}

function restorePlaceholders(source: string, translated: string) {
  if (samePlaceholders(source, translated)) return translated;

  const sourcePlaceholders = placeholders(source);
  if (sourcePlaceholders.length === 0) return translated;

  let restored = translated;
  sourcePlaceholders.forEach((placeholder, index) => {
    const number = index + 1;
    const tokenPatterns = [
      `${placeholderTokenPrefix}${number}${placeholderTokenSuffix}`,
      `__OTR_PLACEHOLDER_${number}__`,
      `OTR_PLACEHOLDER_${number}`,
    ];

    tokenPatterns.forEach((token) => {
      restored = restored.split(token).join(`{${placeholder}}`);
    });
  });

  return restored;
}

function protectPlaceholders(value: string) {
  let protectedValue = value;
  placeholders(value).forEach((placeholder, index) => {
    protectedValue = protectedValue.replace(
      new RegExp(`\\{${placeholder}\\}`, "g"),
      `${placeholderTokenPrefix}${index + 1}${placeholderTokenSuffix}`,
    );
  });
  return protectedValue;
}

export async function generateLocaleBundle(input: {
  targetLanguage: string;
  existingTranslations?: PartialTranslationDictionary | null;
}) {
  const entries = Object.entries(en) as Array<[TranslationKey, string]>;
  const existingTranslations = input.existingTranslations ?? {};
  const missingEntries = entries.filter(([key]) => !existingTranslations[key]);
  const translations: PartialTranslationDictionary = {
    ...existingTranslations,
  };

  while (Object.keys(translations).length < entries.length) {
    const batch = await generateLocaleBundleBatch({
      targetLanguage: input.targetLanguage,
      existingTranslations: translations,
      batchSize: defaultBatchSize,
    });
    Object.assign(translations, batch.translations);
  }

  return {
    translations,
    translatedKeyCount: missingEntries.length,
    totalKeyCount: entries.length,
  };
}

export async function generateLocaleBundleBatch(input: {
  targetLanguage: string;
  existingTranslations?: PartialTranslationDictionary | null;
  batchSize?: number;
}) {
  const entries = Object.entries(en) as Array<[TranslationKey, string]>;
  const existingTranslations = input.existingTranslations ?? {};
  const missingEntries = entries.filter(([key]) => !existingTranslations[key]);
  const batchSize = Math.max(
    1,
    Math.min(input.batchSize ?? defaultBatchSize, defaultBatchSize),
  );
  const batch = missingEntries.slice(0, batchSize);
  const translations: PartialTranslationDictionary = {
    ...existingTranslations,
  };

  if (batch.length === 0) {
    return {
      translations,
      translatedKeyCount: Object.keys(translations).length,
      translatedThisBatch: 0,
      remainingKeyCount: 0,
      totalKeyCount: entries.length,
      complete: true,
    };
  }

  const protectedTexts = batch.map(([, value]) => protectPlaceholders(value));
  const translatedBatch = await translateTexts({
    texts: protectedTexts,
    sourceLanguage: "en",
    targetLanguage: input.targetLanguage,
  });

  translatedBatch.forEach((result, batchIndex) => {
    const [key, sourceValue] = batch[batchIndex];
    const restored = restorePlaceholders(sourceValue, result.translatedText);

    if (!samePlaceholders(sourceValue, restored)) {
      translations[key] = sourceValue;
      return;
    }

    translations[key] = restored;
  });

  const translatedKeyCount = Object.keys(translations).length;

  return {
    translations,
    translatedKeyCount,
    translatedThisBatch: batch.length,
    remainingKeyCount: entries.length - translatedKeyCount,
    totalKeyCount: entries.length,
    complete: translatedKeyCount >= entries.length,
  };
}
