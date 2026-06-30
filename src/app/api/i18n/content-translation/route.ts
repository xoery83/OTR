import { NextResponse } from "next/server";
import {
  type ContentTranslationSourceType,
  detectSourceLanguage,
  hashSourceText,
} from "@/lib/i18n/content-translation";
import {
  getRequestSupabase,
  getServiceSupabase,
} from "@/lib/i18n/server";
import { normalizeLanguageCode } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

type TranslationRow = {
  translated_text: string;
  engine: string;
  status: "machine" | "reviewed";
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  try {
    const supabase = getRequestSupabase(request);
    if (!supabase) return jsonError("You must be logged in.", 401);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const body = (await request.json()) as {
      sourceType?: ContentTranslationSourceType;
      sourceId?: string;
      sourceField?: string;
      text?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      protectedEntities?: string[];
    };

    const text = stringValue(body.text).trim();
    const sourceType = stringValue(body.sourceType);
    const sourceId = stringValue(body.sourceId);
    const sourceField = stringValue(body.sourceField);
    const targetLanguage = normalizeLanguageCode(body.targetLanguage);
    const sourceLanguage = normalizeLanguageCode(
      body.sourceLanguage || detectSourceLanguage(text),
    );
    const sourceHash = hashSourceText(text);

    if (!text || !sourceType || !sourceId || !sourceField || !targetLanguage) {
      return jsonError("sourceType, sourceId, sourceField, text and targetLanguage are required.", 400);
    }

    if (sourceLanguage === targetLanguage) {
      return NextResponse.json({
        status: "source",
        translatedText: text,
        sourceLanguage,
        targetLanguage,
      });
    }

    const serviceSupabase = getServiceSupabase();
    const { data: existing, error: existingError } = await serviceSupabase
      .from("content_translations")
      .select("translated_text, engine, status")
      .eq("source_type", sourceType)
      .eq("source_id", sourceId)
      .eq("source_field", sourceField)
      .eq("target_lang", targetLanguage)
      .eq("source_hash", sourceHash)
      .order("status", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      const row = existing as TranslationRow;
      return NextResponse.json({
        status: row.status,
        translatedText: row.translated_text,
        engine: row.engine,
        sourceLanguage,
        targetLanguage,
      });
    }

    const { error: enqueueError } = await serviceSupabase
      .from("background_jobs")
      .insert({
        journey_id: null,
        user_id: userData.user.id,
        job_type: "translate_user_content",
        title: `Translate ${sourceType}.${sourceField}`,
        current_step: "Queued",
        payload: {
          source_type: sourceType,
          source_id: sourceId,
          source_field: sourceField,
          source_lang: sourceLanguage,
          target_lang: targetLanguage,
          source_hash: sourceHash,
          source_text: text,
          protected_entities: Array.isArray(body.protectedEntities)
            ? body.protectedEntities
            : [],
          requested_by: userData.user.id,
        },
      });

    if (enqueueError && (enqueueError as { code?: string }).code !== "23505") {
      throw enqueueError;
    }

    return NextResponse.json({
      status: "queued",
      translatedText: null,
      sourceLanguage,
      targetLanguage,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not request translation.",
      500,
    );
  }
}
