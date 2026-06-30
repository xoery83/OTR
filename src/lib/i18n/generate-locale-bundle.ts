import en from "@/locales/en.json";
import type { PartialTranslationDictionary, TranslationKey } from "./dictionaries";
import { translateTexts } from "@/lib/translation/provider";

const batchSize = 20;

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
    restored = restored.replace(`__OTR_PLACEHOLDER_${index + 1}__`, `{${placeholder}}`);
  });

  return restored;
}

function protectPlaceholders(value: string) {
  let protectedValue = value;
  placeholders(value).forEach((placeholder, index) => {
    protectedValue = protectedValue.replace(
      new RegExp(`\\{${placeholder}\\}`, "g"),
      `__OTR_PLACEHOLDER_${index + 1}__`,
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

  for (let index = 0; index < missingEntries.length; index += batchSize) {
    const batch = missingEntries.slice(index, index + batchSize);
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
        throw new Error(`Translation for ${key} did not preserve placeholders.`);
      }

      translations[key] = restored;
    });
  }

  return {
    translations,
    translatedKeyCount: missingEntries.length,
    totalKeyCount: entries.length,
  };
}
