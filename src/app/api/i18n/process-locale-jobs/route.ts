import { NextResponse } from "next/server";
import {
  getBuiltinLocaleBundle,
  i18nBaseVersion,
  i18nDefaultNamespace,
} from "@/lib/i18n/bundles";
import { generateLocaleBundle } from "@/lib/i18n/generate-locale-bundle";
import {
  getServiceSupabase,
  isAuthorizedI18nWorker,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type BackgroundJobRow = {
  id: string;
  payload: Record<string, unknown> | null;
};

type LocaleBundleRow = {
  translations_json: Record<string, string> | null;
  status: "machine" | "reviewed";
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function payloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

async function markJob(
  supabase: ReturnType<typeof getServiceSupabase>,
  jobId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("background_jobs")
    .update(patch)
    .eq("id", jobId);

  if (error) throw error;
}

async function processJob(
  supabase: ReturnType<typeof getServiceSupabase>,
  job: BackgroundJobRow,
) {
  const languageCode = payloadString(job.payload, "language_code");
  const namespace = payloadString(job.payload, "namespace") ?? i18nDefaultNamespace;
  const baseVersion = payloadString(job.payload, "base_version") ?? i18nBaseVersion;

  if (!languageCode) {
    throw new Error("Locale generation job is missing language_code.");
  }

  if (namespace !== i18nDefaultNamespace || baseVersion !== i18nBaseVersion) {
    throw new Error("Locale generation job has an unsupported namespace or version.");
  }

  await markJob(supabase, job.id, {
    status: "processing",
    progress: 5,
    current_step: `Generating ${languageCode}`,
    started_at: new Date().toISOString(),
    attempts: 1,
  });

  if (getBuiltinLocaleBundle(languageCode)) {
    await markJob(supabase, job.id, {
      status: "completed",
      progress: 100,
      current_step: "Built-in language bundle already exists",
      result: { languageCode, skipped: "builtin" },
      completed_at: new Date().toISOString(),
    });
    return { jobId: job.id, languageCode, skipped: "builtin" };
  }

  const { data: existingBundle, error: bundleError } = await supabase
    .from("i18n_locale_bundles")
    .select("translations_json, status")
    .eq("language_code", languageCode)
    .eq("namespace", namespace)
    .eq("base_version", baseVersion)
    .maybeSingle();

  if (bundleError) throw bundleError;

  const existing = existingBundle as LocaleBundleRow | null;
  if (existing?.status === "reviewed") {
    await markJob(supabase, job.id, {
      status: "completed",
      progress: 100,
      current_step: "Reviewed language bundle already exists",
      result: { languageCode, skipped: "reviewed" },
      completed_at: new Date().toISOString(),
    });
    return { jobId: job.id, languageCode, skipped: "reviewed" };
  }

  const generated = await generateLocaleBundle({
    targetLanguage: languageCode,
    existingTranslations: existing?.translations_json ?? null,
  });

  const { error: upsertError } = await supabase
    .from("i18n_locale_bundles")
    .upsert(
      {
        language_code: languageCode,
        namespace,
        base_version: baseVersion,
        translations_json: generated.translations,
        status: "machine",
        engine: process.env.TRANSLATION_PROVIDER || "libretranslate",
        created_by: "auto",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "language_code,namespace,base_version" },
    );

  if (upsertError) throw upsertError;

  await markJob(supabase, job.id, {
    status: "completed",
    progress: 100,
    current_step: `Generated ${languageCode}`,
    result: {
      languageCode,
      translatedKeyCount: generated.translatedKeyCount,
      totalKeyCount: generated.totalKeyCount,
    },
    completed_at: new Date().toISOString(),
  });

  return {
    jobId: job.id,
    languageCode,
    translatedKeyCount: generated.translatedKeyCount,
    totalKeyCount: generated.totalKeyCount,
  };
}

export async function POST(request: Request) {
  try {
    if (!(await isAuthorizedI18nWorker(request))) {
      return jsonError("Not authorized.", 401);
    }

    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      languageCode?: string;
    };
    const limit = Math.max(1, Math.min(3, Math.round(body.limit ?? 1)));
    const supabase = getServiceSupabase();
    let query = supabase
      .from("background_jobs")
      .select("id, payload")
      .eq("job_type", "generate_locale_bundle")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (body.languageCode) {
      query = query.eq("payload->>language_code", body.languageCode);
    }

    const { data: jobs, error } = await query;
    if (error) throw error;

    const results = [];
    for (const job of (jobs ?? []) as BackgroundJobRow[]) {
      try {
        results.push(await processJob(supabase, job));
      } catch (jobError) {
        await markJob(supabase, job.id, {
          status: "failed",
          progress: 100,
          current_step: "Locale generation failed",
          error_message:
            jobError instanceof Error ? jobError.message : "Locale generation failed.",
          completed_at: new Date().toISOString(),
        });
        results.push({
          jobId: job.id,
          error: jobError instanceof Error ? jobError.message : "Locale generation failed.",
        });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not process locale jobs.",
      500,
    );
  }
}
