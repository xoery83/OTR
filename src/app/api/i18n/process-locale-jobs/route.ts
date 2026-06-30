import { NextResponse } from "next/server";
import {
  getBuiltinLocaleBundle,
  i18nBaseVersion,
  i18nDefaultNamespace,
} from "@/lib/i18n/bundles";
import { generateLocaleBundleBatch } from "@/lib/i18n/generate-locale-bundle";
import { normalizeLanguageCode } from "@/lib/i18n/dictionaries";
import {
  getServiceSupabase,
  isAuthorizedI18nWorker,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type BackgroundJobRow = {
  id: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  progress: number;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTransientTranslationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /slowdown|rate|limit|too many|network|fetch failed|econnreset|etimedout|enotfound|eai_again|socket|tls|timeout/i.test(
    message,
  );
}

function retryStep(error: unknown) {
  const message = errorMessage(error);
  return /slowdown|rate|limit|too many/i.test(message)
    ? "Rate limited; retry queued"
    : "Translation service unavailable; retry queued";
}

function secondsFromNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
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
  const rawLanguageCode = payloadString(job.payload, "language_code");
  const languageCode = normalizeLanguageCode(rawLanguageCode);
  const namespace = payloadString(job.payload, "namespace") ?? i18nDefaultNamespace;
  const baseVersion = payloadString(job.payload, "base_version") ?? i18nBaseVersion;

  if (!rawLanguageCode) {
    throw new Error("Locale generation job is missing language_code.");
  }

  if (namespace !== i18nDefaultNamespace || baseVersion !== i18nBaseVersion) {
    throw new Error("Locale generation job has an unsupported namespace or version.");
  }

  await markJob(supabase, job.id, {
    status: "processing",
    progress: Math.max(1, Math.min(99, job.progress || 5)),
    current_step: `Generating ${languageCode}`,
    started_at: new Date().toISOString(),
    attempts: job.attempts + 1,
    error_message: null,
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

  const generated = await generateLocaleBundleBatch({
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

  if (!generated.complete) {
    const progress = Math.max(
      1,
      Math.min(
        99,
        Math.round((generated.translatedKeyCount / generated.totalKeyCount) * 100),
      ),
    );

    await markJob(supabase, job.id, {
      status: "queued",
      progress,
      current_step: `Generated ${generated.translatedKeyCount}/${generated.totalKeyCount} keys`,
      result: {
        languageCode,
        translatedKeyCount: generated.translatedKeyCount,
        translatedThisBatch: generated.translatedThisBatch,
        remainingKeyCount: generated.remainingKeyCount,
        totalKeyCount: generated.totalKeyCount,
      },
      available_at: secondsFromNow(15),
    });

    return {
      jobId: job.id,
      languageCode,
      status: "queued",
      translatedKeyCount: generated.translatedKeyCount,
      translatedThisBatch: generated.translatedThisBatch,
      remainingKeyCount: generated.remainingKeyCount,
      totalKeyCount: generated.totalKeyCount,
    };
  }

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
    const limit = 1;
    const supabase = getServiceSupabase();
    const now = new Date().toISOString();
    const buildQuery = (status: "queued" | "failed") => {
      let query = supabase
        .from("background_jobs")
        .select("id, payload, attempts, progress")
        .eq("job_type", "generate_locale_bundle")
        .eq("status", status)
        .lte("available_at", now)
        .order("created_at", { ascending: true })
        .limit(limit);

      if (body.languageCode) {
        query = query.eq("payload->>language_code", body.languageCode);
      }

      return query;
    };

    let { data: jobs, error } = await buildQuery("queued");
    if (error) throw error;

    if (!jobs || jobs.length === 0) {
      const failedResult = await buildQuery("failed");
      jobs = failedResult.data;
      error = failedResult.error;
    }

    if (error) throw error;

    const results = [];
    for (const job of (jobs ?? []) as BackgroundJobRow[]) {
      try {
        results.push(await processJob(supabase, job));
      } catch (jobError) {
        if (isTransientTranslationError(jobError)) {
          const message = errorMessage(jobError);
          await markJob(supabase, job.id, {
            status: "queued",
            progress: Math.max(1, Math.min(99, job.progress || 1)),
            current_step: retryStep(jobError),
            error_message: message,
            available_at: secondsFromNow(75),
          });
          results.push({
            jobId: job.id,
            status: "queued",
            retryAfterSeconds: 75,
            error: message,
          });
          continue;
        }

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
