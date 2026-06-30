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
  type TranslationKey,
  defaultLocale,
  normalizeLocale,
  translate,
} from "@/lib/i18n/dictionaries";
import { supabase } from "@/lib/supabase/client";

export const LOCALE_STORAGE_KEY = "otr:locale";
export const LOCALE_PREFERENCE_CHANGED_EVENT = "otr:locale-preference-changed";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
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

function getInitialLocale() {
  if (typeof window === "undefined") return defaultLocale;

  return resolveLocalePreference(getStoredPreference());
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocaleState(getInitialLocale());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function handleLocalePreferenceChanged(event: Event) {
      const customEvent = event as CustomEvent<{ language?: string }>;
      const preference = customEvent.detail?.language ?? getStoredPreference();
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
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    window.dispatchEvent(
      new CustomEvent(LOCALE_PREFERENCE_CHANGED_EVENT, {
        detail: { language: nextLocale },
      }),
    );

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!data.user) return null;
        return supabase
          .from("profiles")
          .update({ preferred_language: nextLocale })
          .eq("id", data.user.id);
      })
      .catch(() => null);
  }, []);

  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale, t],
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
