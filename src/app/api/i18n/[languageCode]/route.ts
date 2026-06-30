import { NextResponse } from "next/server";
import {
  getBuiltinLocaleBundle,
  i18nBaseVersion,
  i18nDefaultNamespace,
  i18nPrewarmLanguageCodes,
  type LocaleBundleResponse,
  type LocaleBundleStatus,
} from "@/lib/i18n/bundles";
import { generateLocaleBundleBatch } from "@/lib/i18n/generate-locale-bundle";
import { defaultLocale, normalizeLanguageCode } from "@/lib/i18n/dictionaries";
import {
  enqueueCommonLocaleGenerationJobs,
  getRequestSupabase,
  getServiceSupabase,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type LocaleBundleRow = {
  language_code: string;
  namespace: string;
  base_version: string;
  translations_json: Record<string, string> | null;
  status: Exclude<LocaleBundleStatus, "builtin">;
};

function keyCount(translations: Record<string, string> | null | undefined) {
  return Object.keys(translations ?? {}).length;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `code: ${record.code}` : null,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  return fallback;
}

function responsePayload(
  input: Omit<LocaleBundleResponse, "namespace" | "baseVersion">,
) {
  return NextResponse.json({
    ...input,
    namespace: i18nDefaultNamespace,
    baseVersion: i18nBaseVersion,
  } satisfies LocaleBundleResponse);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ languageCode: string }> },
) {
  try {
    const { languageCode: rawLanguageCode } = await params;
    const languageCode = normalizeLanguageCode(decodeURIComponent(rawLanguageCode));
    const builtinBundle = getBuiltinLocaleBundle(languageCode);

    if (builtinBundle) {
      return responsePayload({
        languageCode,
        translations: builtinBundle,
        status: "builtin",
        fallback: false,
        jobQueued: false,
        complete: true,
      });
    }

    const fallbackBundle = getBuiltinLocaleBundle(defaultLocale) ?? {};
    const supabase = getRequestSupabase(request);
    if (!supabase) {
      return responsePayload({
        languageCode,
        translations: fallbackBundle,
        status: "builtin",
        fallback: true,
        jobQueued: false,
        complete: true,
      });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return responsePayload({
        languageCode,
        translations: fallbackBundle,
        status: "builtin",
        fallback: true,
        jobQueued: false,
        complete: true,
      });
    }

    const { data, error } = await supabase
      .from("i18n_locale_bundles")
      .select("language_code, namespace, base_version, translations_json, status")
      .eq("language_code", languageCode)
      .eq("namespace", i18nDefaultNamespace)
      .eq("base_version", i18nBaseVersion)
      .maybeSingle();

    if (error) throw error;

    const serviceSupabase = getServiceSupabase();

    if (data) {
      const bundle = data as LocaleBundleRow;
      const existingTranslations = bundle.translations_json ?? {};
      const generated = await generateLocaleBundleBatch({
        targetLanguage: languageCode,
        existingTranslations,
      });

      if (generated.translatedThisBatch > 0) {
        const { error: upsertError } = await serviceSupabase
          .from("i18n_locale_bundles")
          .upsert(
            {
              language_code: languageCode,
              namespace: i18nDefaultNamespace,
              base_version: i18nBaseVersion,
              translations_json: generated.translations,
              status: bundle.status,
              engine: process.env.TRANSLATION_PROVIDER || "libretranslate",
              created_by: "auto",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "language_code,namespace,base_version" },
          );

        if (upsertError) throw upsertError;
      }

      return responsePayload({
        languageCode,
        translations: generated.translations,
        status: bundle.status,
        fallback: false,
        jobQueued: false,
        complete: generated.complete,
      });
    }

    const generated = await generateLocaleBundleBatch({
      targetLanguage: languageCode,
      existingTranslations: null,
    });

    const { error: upsertError } = await serviceSupabase
      .from("i18n_locale_bundles")
      .upsert(
        {
          language_code: languageCode,
          namespace: i18nDefaultNamespace,
          base_version: i18nBaseVersion,
          translations_json: generated.translations,
          status: "machine",
          engine: process.env.TRANSLATION_PROVIDER || "libretranslate",
          created_by: "auto",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "language_code,namespace,base_version" },
      );

    if (upsertError) throw upsertError;

    const prewarmLanguages = i18nPrewarmLanguageCodes.filter(
      (prewarmLanguage) => prewarmLanguage !== languageCode,
    );
    await enqueueCommonLocaleGenerationJobs(supabase, {
      requestedBy: userData.user.id,
      userId: userData.user.id,
      include: prewarmLanguages,
    });

    return responsePayload({
      languageCode,
      translations: keyCount(generated.translations) > 0
        ? generated.translations
        : fallbackBundle,
      status: "machine",
      fallback: false,
      jobQueued: !generated.complete,
      complete: generated.complete,
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not load language bundle."), 500);
  }
}
