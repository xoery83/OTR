export const supportedAppLanguageCodes = [
  "en",
  "zh-CN",
  "fr",
  "de",
  "es",
  "ja",
  "ko",
  "it",
  "pt",
] as const;

export type AppLanguageCode = (typeof supportedAppLanguageCodes)[number];

export function normalizeAppLanguageCode(value: string | null | undefined) {
  if (!value) return "en";

  const normalized = value.trim().replace("_", "-");
  const lower = normalized.toLowerCase();

  if (lower === "zh" || lower === "zh-cn" || lower === "zh-hans") {
    return "zh-CN";
  }
  if (lower === "zh-tw" || lower === "zh-hant") return "zh-CN";

  const base = lower.split("-")[0];
  const supported = supportedAppLanguageCodes.find(
    (languageCode) => languageCode.toLowerCase() === base,
  );

  return supported ?? lower;
}

export function toLibreTranslateLanguageCode(
  languageCode: string | null | undefined,
) {
  const normalized = normalizeAppLanguageCode(languageCode);

  if (normalized === "zh-CN") return "zh-Hans";

  return normalized;
}
