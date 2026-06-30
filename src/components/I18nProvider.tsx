"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type Locale,
  type PartialTranslationDictionary,
  type TranslationKey,
  defaultLocale,
  formatTranslation,
  getDictionary,
  isLocale,
  normalizeLanguageCode,
  normalizeLocale,
} from "@/lib/i18n/dictionaries";
import { supabase } from "@/lib/supabase/client";

export const LOCALE_STORAGE_KEY = "otr:locale";
export const LOCALE_PREFERENCE_CHANGED_EVENT = "otr:locale-preference-changed";

type I18nContextValue = {
  contentLanguage: string;
  locale: Locale;
  localePreference: string;
  setLocale: (locale: string) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

type LocaleBundlePayload = {
  complete?: boolean;
  languageCode?: string;
  translations?: PartialTranslationDictionary;
  fallback?: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveLocalePreference(preference: string | null | undefined) {
  if (!preference || preference === "auto") {
    return normalizeLocale(
      typeof window === "undefined" ? null : window.navigator.language,
    );
  }

  return normalizeLocale(preference);
}

function getStoredPreference() {
  if (typeof window === "undefined") return "auto";
  return window.localStorage.getItem(LOCALE_STORAGE_KEY) || "auto";
}

function resolveBundleLanguage(preference: string | null | undefined) {
  const rawPreference =
    !preference || preference === "auto"
      ? typeof window === "undefined"
        ? defaultLocale
        : window.navigator.language
      : preference;

  return normalizeLanguageCode(rawPreference);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [localePreference, setLocalePreference] = useState("auto");
  const [dynamicTranslations, setDynamicTranslations] =
    useState<PartialTranslationDictionary | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const preference = getStoredPreference();
      setLocalePreference(preference);
      setLocaleState(resolveLocalePreference(preference));
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function handleLocalePreferenceChanged(event: Event) {
      const customEvent = event as CustomEvent<{ language?: string }>;
      const preference = customEvent.detail?.language ?? getStoredPreference();
      setLocalePreference(preference);
      setLocaleState(resolveLocalePreference(preference));
    }

    window.addEventListener(
      LOCALE_PREFERENCE_CHANGED_EVENT,
      handleLocalePreferenceChanged,
    );

    return () => {
      window.removeEventListener(
        LOCALE_PREFERENCE_CHANGED_EVENT,
        handleLocalePreferenceChanged,
      );
    };
  }, []);

  useEffect(() => {
    const documentLanguage =
      localePreference === "auto"
        ? locale
        : normalizeLanguageCode(localePreference);
    document.documentElement.lang = documentLanguage;
  }, [locale, localePreference]);

  useEffect(() => {
    let isMounted = true;
    const bundleLanguage = resolveBundleLanguage(localePreference);
    let retryTimer: number | null = null;

    if (isLocale(bundleLanguage)) {
      setDynamicTranslations(null);
      return;
    }

    async function loadBundle() {
      try {
        const { data } = await supabase.auth.getSession();
        const headers: HeadersInit = data.session?.access_token
          ? { Authorization: `Bearer ${data.session.access_token}` }
          : {};
        const response = await fetch(
          `/api/i18n/${encodeURIComponent(bundleLanguage)}`,
          { headers },
        );
        const payload = (await response.json()) as LocaleBundlePayload;

        if (!isMounted) return;

        if (!response.ok || payload.fallback || !payload.translations) {
          setDynamicTranslations(null);
          return;
        }

        setDynamicTranslations(payload.translations);

        if (!payload.complete) {
          retryTimer = window.setTimeout(() => {
            if (isMounted) void loadBundle();
          }, 2500);
        }
      } catch {
        if (isMounted) setDynamicTranslations(null);
      }
    }

    void loadBundle();

    return () => {
      isMounted = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [localePreference]);

  const setLocale = useCallback((nextLocale: string) => {
    const normalizedLanguage = normalizeLanguageCode(nextLocale);
    setLocaleState(resolveLocalePreference(normalizedLanguage));
    setLocalePreference(normalizedLanguage);
    setDynamicTranslations(null);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, normalizedLanguage);
    window.dispatchEvent(
      new CustomEvent(LOCALE_PREFERENCE_CHANGED_EVENT, {
        detail: { language: normalizedLanguage },
      }),
    );

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!data.user) return null;
        return supabase
          .from("profiles")
          .update({ preferred_language: normalizedLanguage })
          .eq("id", data.user.id);
      })
      .catch(() => null);
  }, []);

  const dictionary = useMemo(
    () => getDictionary(locale, dynamicTranslations),
    [dynamicTranslations, locale],
  );
  const contentLanguage = useMemo(
    () => resolveBundleLanguage(localePreference),
    [localePreference],
  );

  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      formatTranslation(dictionary[key] ?? key, values),
    [dictionary],
  );

  const value = useMemo(
    () => ({
      contentLanguage,
      locale,
      localePreference,
      setLocale,
      t,
    }),
    [contentLanguage, locale, localePreference, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}
