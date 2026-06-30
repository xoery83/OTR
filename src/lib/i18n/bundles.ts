import en from "@/locales/en.json";
import zhCN from "@/locales/zh-CN.json";
import type { PartialTranslationDictionary } from "./dictionaries";

export const i18nDefaultNamespace = "common";
export const i18nBaseVersion = "2026-06-30";
export const i18nPrewarmLanguageCodes = [
  "fr",
  "de",
  "es",
  "ja",
  "ko",
  "it",
  "pt",
] as const;

export type LocaleBundleStatus = "machine" | "reviewed" | "builtin";

export type LocaleBundleResponse = {
  languageCode: string;
  namespace: string;
  baseVersion: string;
  translations: PartialTranslationDictionary;
  status: LocaleBundleStatus;
  fallback: boolean;
  jobQueued: boolean;
};

export function getBuiltinLocaleBundle(languageCode: string) {
  if (languageCode === "en") return en;
  if (languageCode === "zh-CN") return zhCN;
  return null;
}
