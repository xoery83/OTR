import { NextResponse } from "next/server";
import {
  hashSourceText,
  translateUserContent,
} from "@/lib/i18n/content-translation";
import {
  getServiceSupabase,
  isAuthorizedI18nWorker,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type BackgroundJobRow = {
  id: string;
  payload: Record<string, unknown> | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function payloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function payloadStringArray(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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
  const payload = job.payload;
  const sourceType = payloadString(payload, "source_type");
  const sourceId = payloadString(payload, "source_id");
  const sourceField = payloadString(payload, "source_field");
  const sourceLanguage = payloadString(payload, "source_lang");
  const targetLanguage = payloadString(payload, "target_lang");
  const sourceText = payloadString(payload, "source_text");
  const sourceHash = payloadString(payload, "source_hash") || hashSourceText(sourceText);

  if (!sourceType || !sourceId || !sourceField || !sourceLanguage || !targetLanguage || !sourceText) {
    throw new Error("Content translation job payload is incomplete.");
  }

  await markJob(supabase, job.id, {
    status: "processing",
    progress: 10,
    current_step: `Translating ${sourceType}.${sourceField}`,
    started_at: new Date().toISOString(),
    attempts: 1,
  });

  const translated = await translateUserContent({
    text: sourceText,
    sourceLanguage,
    targetLanguage,
    protectedEntities: payloadStringArray(payload, "protected_entities"),
  });

  const { error: upsertError } = await supabase
    .from("content_translations")
    .upsert(
      {
        source_type: sourceType,
        source_id: sourceId,
        source_field: sourceField,
        source_lang: sourceLanguage,
        target_lang: targetLanguage,
        source_hash: sourceHash,
        translated_text: translated.translatedText,
        engine: translated.engine,
        status: "machine",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict:
          "source_type,source_id,source_field,target_lang,source_hash",
      },
    );

  if (upsertError) throw upsertError;

  await markJob(supabase, job.id, {
    status: "completed",
    progress: 100,
    current_step: "Translation cached",
    result: { sourceType, sourceId, sourceField, targetLanguage },
    completed_at: new Date().toISOString(),
  });

  return { jobId: job.id, sourceType, sourceId, sourceField, targetLanguage };
}

export async function POST(request: Request) {
  try {
    if (!(await isAuthorizedI18nWorker(request))) {
      return jsonError("Not authorized.", 401);
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.max(1, Math.min(10, Math.round(body.limit ?? 5)));
    const supabase = getServiceSupabase();
    const { data: jobs, error } = await supabase
      .from("background_jobs")
      .select("id, payload")
      .eq("job_type", "translate_user_content")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;

    const results = [];
    for (const job of (jobs ?? []) as BackgroundJobRow[]) {
      try {
        results.push(await processJob(supabase, job));
      } catch (jobError) {
        await markJob(supabase, job.id, {
          status: "failed",
          progress: 100,
          current_step: "Content translation failed",
          error_message:
            jobError instanceof Error
              ? jobError.message
              : "Content translation failed.",
          completed_at: new Date().toISOString(),
        });
        results.push({
          jobId: job.id,
          error:
            jobError instanceof Error
              ? jobError.message
              : "Content translation failed.",
        });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not process content jobs.",
      500,
    );
  }
}
