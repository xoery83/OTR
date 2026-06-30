import en from "@/locales/en.json";
import zhCN from "@/locales/zh-CN.json";

export const builtinLocales = ["en", "zh-CN"] as const;
export const locales = builtinLocales;
export const defaultLocale = "en";

export type BuiltinLocale = (typeof builtinLocales)[number];
export type Locale = BuiltinLocale;
export type TranslationKey = keyof typeof en;
export type TranslationDictionary = Record<TranslationKey, string>;
export type PartialTranslationDictionary = Partial<TranslationDictionary>;

export const dictionaries: Record<BuiltinLocale, TranslationDictionary> = {
  en,
  "zh-CN": zhCN,
};

export function isLocale(
  value: string | null | undefined,
): value is BuiltinLocale {
  return builtinLocales.some((locale) => locale === value);
}

export function normalizeLocale(
  value: string | null | undefined,
): BuiltinLocale {
  if (!value) return defaultLocale;

  const normalized = value.trim().replace("_", "-").toLowerCase();
  if (normalized === "zh-cn" || normalized === "zh-hans") return "zh-CN";
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";

  return defaultLocale;
}

export function normalizeLanguageCode(value: string | null | undefined) {
  if (!value) return defaultLocale;

  const [language, region] = value.trim().replace("_", "-").split("-");
  if (!language) return defaultLocale;
  if (language.toLowerCase() === "en") return "en";
  if (
    language.toLowerCase() === "zh" &&
    (region?.toLowerCase() === "tw" || region?.toLowerCase() === "hant")
  ) {
    return "zh-CN";
  }
  if (!region) return language.toLowerCase();

  return `${language.toLowerCase()}-${region.toUpperCase()}`;
}

export function getDictionary(
  locale: string | null | undefined,
  override?: PartialTranslationDictionary | null,
) {
  const builtinLocale = normalizeLocale(locale);
  return {
    ...dictionaries[defaultLocale],
    ...dictionaries[builtinLocale],
    ...(override ?? {}),
  };
}

export function formatTranslation(
  template: string,
  values?: Record<string, string | number>,
) {
  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

export function translate(
  locale: BuiltinLocale,
  key: TranslationKey,
  values?: Record<string, string | number>,
) {
  const dictionary = getDictionary(locale);
  return formatTranslation(dictionary[key] ?? key, values);
}
