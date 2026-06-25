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
  isLocale,
  normalizeLocale,
  translate,
} from "@/lib/i18n/dictionaries";

const STORAGE_KEY = "otr:locale";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLocale() {
  if (typeof window === "undefined") return defaultLocale;

  const storedLocale = window.localStorage.getItem(STORAGE_KEY);
  if (isLocale(storedLocale)) return storedLocale;

  return normalizeLocale(window.navigator.language);
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
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
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
