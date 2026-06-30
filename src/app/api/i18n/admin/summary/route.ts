import { NextResponse } from "next/server";
import {
  getBuiltinLocaleBundle,
  i18nBaseVersion,
  i18nDefaultNamespace,
  i18nPrewarmLanguageCodes,
} from "@/lib/i18n/bundles";
import { generateLocaleBundleBatch } from "@/lib/i18n/generate-locale-bundle";
import {
  getServiceSupabase,
  isAuthorizedI18nWorker,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type LocaleBundleRow = {
  language_code: string;
  translations_json: Record<string, string> | null;
  status: "machine" | "reviewed";
};

function totalKeyCount() {
  return Object.keys(getBuiltinLocaleBundle("en") ?? {}).length;
}

function countKeys(translations: Record<string, string> | null | undefined) {
  return Object.keys(translations ?? {}).length;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function advanceOnePrewarmBundle(
  supabase: ReturnType<typeof getServiceSupabase>,
) {
  const { data, error } = await supabase
    .from("i18n_locale_bundles")
    .select("language_code, translations_json, status")
    .eq("namespace", i18nDefaultNamespace)
    .eq("base_version", i18nBaseVersion);

  if (error) throw error;

  const bundlesByLanguage = new Map(
    ((data ?? []) as LocaleBundleRow[]).map((bundle) => [
      bundle.language_code,
      bundle,
    ]),
  );
  const total = totalKeyCount();

  for (const languageCode of i18nPrewarmLanguageCodes) {
    const existing = bundlesByLanguage.get(languageCode);
    if (existing?.status === "reviewed") continue;
    if (countKeys(existing?.translations_json) >= total) continue;

    let generated: Awaited<ReturnType<typeof generateLocaleBundleBatch>>;
    try {
      generated = await generateLocaleBundleBatch({
        targetLanguage: languageCode,
        existingTranslations: existing?.translations_json ?? null,
      });
    } catch (generateError) {
      return {
        complete: false,
        error: errorMessage(generateError),
        languageCode,
        translatedKeyCount: countKeys(existing?.translations_json),
        totalKeyCount: total,
      };
    }

    const { error: upsertError } = await supabase
      .from("i18n_locale_bundles")
      .upsert(
        {
          language_code: languageCode,
          namespace: i18nDefaultNamespace,
          base_version: i18nBaseVersion,
          translations_json: generated.translations,
          status: existing?.status ?? "machine",
          engine: process.env.TRANSLATION_PROVIDER || "libretranslate",
          created_by: "auto",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "language_code,namespace,base_version" },
      );

    if (upsertError) throw upsertError;

    return {
      complete: generated.complete,
      languageCode,
      translatedKeyCount: generated.translatedKeyCount,
      totalKeyCount: generated.totalKeyCount,
    };
  }

  return null;
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthorizedI18nWorker(request))) {
      return jsonError("Not authorized.", 401);
    }

    const supabase = getServiceSupabase();
    const advancement = await advanceOnePrewarmBundle(supabase);
    const [bundlesResult, jobsResult] = await Promise.all([
      supabase
        .from("i18n_locale_bundles")
        .select(
          "id, language_code, namespace, base_version, translations_json, status, engine, updated_at",
        )
        .order("language_code", { ascending: true }),
      supabase
        .from("background_jobs")
        .select(
          "id, job_type, status, title, current_step, progress, error_message, payload, created_at, updated_at, completed_at",
        )
        .in("job_type", ["generate_locale_bundle", "translate_user_content"])
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (bundlesResult.error) throw bundlesResult.error;
    if (jobsResult.error) throw jobsResult.error;

    return NextResponse.json({
      advancement,
      bundles: bundlesResult.data ?? [],
      jobs: jobsResult.data ?? [],
      totalKeyCount: totalKeyCount(),
    });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Could not load localization summary.",
      500,
    );
  }
}
