"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { supabase } from "@/lib/supabase/client";
import type { ContentTranslationSourceType } from "@/lib/i18n/content-translation";

type TranslatedTextProps = {
  as?: "div" | "p" | "span";
  className?: string;
  fallback?: React.ReactNode;
  protectedEntities?: Array<string | null | undefined>;
  showToggle?: boolean;
  sourceField: string;
  sourceId: string;
  sourceLanguage?: string | null;
  sourceType: ContentTranslationSourceType;
  text: string | null | undefined;
};

type TranslationResponse = {
  status?: "source" | "machine" | "reviewed" | "queued";
  translatedText?: string | null;
};

const CONTENT_TRANSLATION_CACHE_PREFIX = "otr:content-translation:v1:";
const CONTENT_TRANSLATION_CACHE_INDEX = "otr:content-translation:index:v1";
const CONTENT_TRANSLATION_CACHE_LIMIT = 600;
const memoryTranslationCache = new Map<string, string>();

function detectSimpleLanguage(text: string) {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh-CN";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  return "en";
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(input: {
  protectedEntityKey: string;
  sourceField: string;
  sourceId: string;
  sourceLanguage: string;
  sourceText: string;
  sourceType: string;
  targetLanguage: string;
}) {
  return [
    input.sourceType,
    input.sourceId,
    input.sourceField,
    input.sourceLanguage,
    input.targetLanguage,
    simpleHash(input.sourceText),
    simpleHash(input.protectedEntityKey),
  ].join(":");
}

function readCachedTranslation(key: string) {
  const memoryValue = memoryTranslationCache.get(key);
  if (memoryValue) return memoryValue;
  if (typeof window === "undefined") return null;

  try {
    const storedValue = window.localStorage.getItem(
      `${CONTENT_TRANSLATION_CACHE_PREFIX}${key}`,
    );
    if (!storedValue) return null;
    memoryTranslationCache.set(key, storedValue);
    return storedValue;
  } catch {
    return null;
  }
}

function rememberCacheKey(key: string) {
  if (typeof window === "undefined") return;

  try {
    const rawIndex = window.localStorage.getItem(CONTENT_TRANSLATION_CACHE_INDEX);
    const index = rawIndex ? (JSON.parse(rawIndex) as string[]) : [];
    const nextIndex = [key, ...index.filter((value) => value !== key)].slice(
      0,
      CONTENT_TRANSLATION_CACHE_LIMIT,
    );
    index.slice(CONTENT_TRANSLATION_CACHE_LIMIT).forEach((oldKey) => {
      window.localStorage.removeItem(`${CONTENT_TRANSLATION_CACHE_PREFIX}${oldKey}`);
    });
    window.localStorage.setItem(
      CONTENT_TRANSLATION_CACHE_INDEX,
      JSON.stringify(nextIndex),
    );
  } catch {
    return;
  }
}

function writeCachedTranslation(key: string, value: string) {
  memoryTranslationCache.set(key, value);
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(`${CONTENT_TRANSLATION_CACHE_PREFIX}${key}`, value);
    rememberCacheKey(key);
  } catch {
    return;
  }
}

export function TranslatedText({
  as: Element = "p",
  className,
  fallback = null,
  protectedEntities = [],
  showToggle = true,
  sourceField,
  sourceId,
  sourceLanguage,
  sourceType,
  text,
}: TranslatedTextProps) {
  const { contentLanguage } = useI18n();
  const sourceText = text?.trim() ?? "";
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const protectedEntityKey = protectedEntities
    .filter((entity): entity is string => Boolean(entity))
    .join("\n");

  const detectedSourceLanguage = useMemo(
    () => sourceLanguage || detectSimpleLanguage(sourceText),
    [sourceLanguage, sourceText],
  );
  const translationCacheKey = useMemo(
    () =>
      cacheKey({
        protectedEntityKey,
        sourceField,
        sourceId,
        sourceLanguage: detectedSourceLanguage,
        sourceText,
        sourceType,
        targetLanguage: contentLanguage,
      }),
    [
      contentLanguage,
      detectedSourceLanguage,
      protectedEntityKey,
      sourceField,
      sourceId,
      sourceText,
      sourceType,
    ],
  );

  useEffect(() => {
    setShowOriginal(false);

    if (!sourceText || !contentLanguage) {
      setTranslatedText(null);
      return;
    }
    if (detectedSourceLanguage === contentLanguage) {
      setTranslatedText(null);
      return;
    }

    const cached = readCachedTranslation(translationCacheKey);
    setTranslatedText(cached);
    if (cached) return;

    let isMounted = true;

    async function requestTranslation() {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const response = await fetch("/api/i18n/content-translation", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            protectedEntities: protectedEntityKey.split("\n").filter(Boolean),
            sourceField,
            sourceId,
            sourceLanguage: detectedSourceLanguage,
            sourceType,
            targetLanguage: contentLanguage,
            text: sourceText,
          }),
        });

        if (!response.ok) return;
        const payload = (await response.json()) as TranslationResponse;
        if (isMounted && payload.translatedText) {
          writeCachedTranslation(translationCacheKey, payload.translatedText);
          setTranslatedText(payload.translatedText);
        }
      } catch {
        if (isMounted) setTranslatedText(null);
      }
    }

    void requestTranslation();

    return () => {
      isMounted = false;
    };
  }, [
    contentLanguage,
    detectedSourceLanguage,
    protectedEntityKey,
    sourceField,
    sourceId,
    sourceText,
    sourceType,
    translationCacheKey,
  ]);

  if (!sourceText) return fallback;

  const displayText = translatedText && !showOriginal ? translatedText : sourceText;

  return (
    <>
      <Element className={className}>{displayText}</Element>
      {translatedText && showToggle ? (
        <button
          type="button"
          onClick={() => setShowOriginal((current) => !current)}
          className="mt-1 text-[11px] font-semibold text-emerald-700 underline decoration-emerald-200 underline-offset-2"
        >
          {showOriginal ? "Show translation" : "Show original"}
        </button>
      ) : null}
    </>
  );
}
