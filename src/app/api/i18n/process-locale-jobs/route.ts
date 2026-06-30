import { NextResponse } from "next/server";
import {
  getBuiltinLocaleBundle,
  i18nBaseVersion,
  i18nDefaultNamespace,
} from "@/lib/i18n/bundles";
import { normalizeLanguageCode } from "@/lib/i18n/dictionaries";
import {
  generateMenuLanguagePack,
  validateCompleteLanguagePack,
} from "@/lib/i18n/menu-language-pack";
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
  id?: string;
  translations_json: Record<string, string> | null;
  status: "machine" | "reviewed";
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function payloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function payloadBoolean(payload: Record<string, unknown> | null, key: string) {
  return payload?.[key] === true;
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

async function processingLocaleJobCount(
  supabase: ReturnType<typeof getServiceSupabase>,
) {
  const { count, error } = await supabase
    .from("background_jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_type", "generate_locale_bundle")
    .eq("status", "processing");

  if (error) throw error;
  return count ?? 0;
}

async function completeStaleLanguageJobs(
  supabase: ReturnType<typeof getServiceSupabase>,
  languageCode: string,
  currentJobId: string,
  skipped: "draft" | "published",
) {
  const { error } = await supabase
    .from("background_jobs")
    .update({
      status: "completed",
      progress: 100,
      current_step:
        skipped === "published"
          ? "Published language pack already exists"
          : "Draft language pack already exists",
      result: { languageCode, skipped },
      error_message: null,
      completed_at: new Date().toISOString(),
    })
    .eq("job_type", "generate_locale_bundle")
    .eq("payload->>language_code", languageCode)
    .in("status", ["queued", "failed"])
    .neq("id", currentJobId);

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
  const fullRegenerate = payloadBoolean(job.payload, "full_regenerate");

  if (!rawLanguageCode) {
    throw new Error("Language pack job is missing language_code.");
  }

  if (namespace !== i18nDefaultNamespace || baseVersion !== i18nBaseVersion) {
    throw new Error("Language pack job has an unsupported namespace or version.");
  }

  await markJob(supabase, job.id, {
    status: "processing",
    progress: Math.max(1, Math.min(99, job.progress || 5)),
    current_step: `Generating ${languageCode} language pack with LLM`,
    started_at: new Date().toISOString(),
    attempts: job.attempts + 1,
    error_message: null,
  });

  if (getBuiltinLocaleBundle(languageCode)) {
    await markJob(supabase, job.id, {
      status: "completed",
      progress: 100,
      current_step: "Built-in language pack already exists",
      result: { languageCode, skipped: "builtin" },
      completed_at: new Date().toISOString(),
    });
    return { jobId: job.id, languageCode, skipped: "builtin" };
  }

  const { data: existingBundle, error: bundleError } = await supabase
    .from("i18n_locale_bundles")
    .select("id, translations_json, status")
    .eq("language_code", languageCode)
    .eq("namespace", namespace)
    .eq("base_version", baseVersion)
    .maybeSingle();

  if (bundleError) throw bundleError;

  const existing = existingBundle as LocaleBundleRow | null;
  if (existing && !fullRegenerate) {
    const validation = validateCompleteLanguagePack(
      existing.translations_json ?? {},
    );
    if (
      validation.missingKeys.length === 0 &&
      validation.extraKeys.length === 0 &&
      validation.placeholderErrors.length === 0
    ) {
      const skipped = existing.status === "reviewed" ? "published" : "draft";
      await markJob(supabase, job.id, {
        status: "completed",
        progress: 100,
        current_step:
          existing.status === "reviewed"
            ? "Published language pack already exists"
            : "Draft language pack already exists",
        result: { languageCode, skipped },
        error_message: null,
        completed_at: new Date().toISOString(),
      });
      await completeStaleLanguageJobs(supabase, languageCode, job.id, skipped);
      return { jobId: job.id, languageCode, skipped };
    }
  }

  await markJob(supabase, job.id, {
    progress: 20,
    current_step: fullRegenerate
      ? "Regenerating all keys with LLM"
      : "Generating missing keys with LLM",
  });

  const generated = await generateMenuLanguagePack({
    targetLanguage: languageCode,
    existingTranslations: existing?.translations_json ?? null,
    fullRegenerate,
  });

  const { error: upsertError } = await supabase
    .from("i18n_locale_bundles")
    .upsert(
      {
        language_code: languageCode,
        namespace,
        base_version: baseVersion,
        translations_json: generated.content,
        status: "machine",
        engine: generated.provider,
        created_by: "admin",
        generated_by: "llm",
        provider: generated.provider,
        model: generated.model,
        prompt_version: generated.promptVersion,
        missing_keys_count: generated.missingKeysCount,
        token_estimate: generated.tokenEstimate,
        cost_estimate_usd: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "language_code,namespace,base_version" },
    );

  if (upsertError) throw upsertError;

  await markJob(supabase, job.id, {
    status: "completed",
    progress: 100,
    current_step: "Language pack generated. Ready to preview and publish.",
    result: {
      languageCode,
      generatedKeyCount: generated.generatedKeyCount,
      totalKeyCount: generated.totalKeyCount,
      provider: generated.provider,
      model: generated.model,
      promptVersion: generated.promptVersion,
      tokenEstimate: generated.tokenEstimate,
    },
    completed_at: new Date().toISOString(),
  });

  return {
    jobId: job.id,
    languageCode,
    generatedKeyCount: generated.generatedKeyCount,
    totalKeyCount: generated.totalKeyCount,
    provider: generated.provider,
    model: generated.model,
  };
}

export async function POST(request: Request) {
  try {
    if (!(await isAuthorizedI18nWorker(request))) {
      return jsonError("Not authorized.", 401);
    }

    const body = (await request.json().catch(() => ({}))) as {
      languageCode?: string;
    };
    const supabase = getServiceSupabase();
    const activeCount = await processingLocaleJobCount(supabase);
    if (activeCount > 0) {
      return NextResponse.json({
        processed: 0,
        results: [],
        skipped: "A language pack generation job is already running.",
      });
    }

    const now = new Date().toISOString();
    const buildQuery = (status: "queued" | "failed") => {
      let query = supabase
        .from("background_jobs")
        .select("id, payload, attempts, progress")
        .eq("job_type", "generate_locale_bundle")
        .eq("status", status)
        .lte("available_at", now)
        .order("created_at", { ascending: true })
        .limit(1);

      if (body.languageCode) {
        query = query.eq(
          "payload->>language_code",
          normalizeLanguageCode(body.languageCode),
        );
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
        const message = errorMessage(jobError);
        await markJob(supabase, job.id, {
          status: "failed",
          progress: 100,
          current_step: "Language pack generation failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        });
        results.push({ jobId: job.id, error: message });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not process language pack jobs.",
      500,
    );
  }
}
