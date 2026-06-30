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

function detectSimpleLanguage(text: string) {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh-CN";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  return "en";
}

export function TranslatedText({
  as: Element = "p",
  className,
  fallback = null,
  protectedEntities = [],
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

  useEffect(() => {
    setTranslatedText(null);
    setShowOriginal(false);

    if (!sourceText || !contentLanguage) return;
    if (detectedSourceLanguage === contentLanguage) return;

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
  ]);

  if (!sourceText) return fallback;

  const displayText = translatedText && !showOriginal ? translatedText : sourceText;

  return (
    <>
      <Element className={className}>{displayText}</Element>
      {translatedText ? (
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
