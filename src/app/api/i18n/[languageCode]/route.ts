import { NextResponse } from "next/server";
import {
  getBuiltinLocaleBundle,
  i18nBaseVersion,
  i18nDefaultNamespace,
  i18nPrewarmLanguageCodes,
  type LocaleBundleResponse,
  type LocaleBundleStatus,
} from "@/lib/i18n/bundles";
import { defaultLocale, normalizeLanguageCode } from "@/lib/i18n/dictionaries";
import {
  enqueueCommonLocaleGenerationJobs,
  enqueueLocaleGenerationJob,
  getRequestSupabase,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type LocaleBundleRow = {
  language_code: string;
  namespace: string;
  base_version: string;
  translations_json: Record<string, string> | null;
  status: Exclude<LocaleBundleStatus, "builtin">;
};

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

    if (data) {
      const bundle = data as LocaleBundleRow;
      return responsePayload({
        languageCode,
        translations: bundle.translations_json ?? {},
        status: bundle.status,
        fallback: false,
        jobQueued: false,
      });
    }

    const jobQueued = await enqueueLocaleGenerationJob(supabase, {
      languageCode,
      requestedBy: userData.user.id,
      userId: userData.user.id,
    });
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
      translations: fallbackBundle,
      status: "builtin",
      fallback: true,
      jobQueued,
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not load language bundle."), 500);
  }
}
