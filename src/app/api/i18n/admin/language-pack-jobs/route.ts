import { NextResponse } from "next/server";
import { getBuiltinLocaleBundle } from "@/lib/i18n/bundles";
import { normalizeLanguageCode } from "@/lib/i18n/dictionaries";
import {
  enqueueLocaleGenerationJob,
  getServiceSupabase,
  isAuthorizedI18nWorker,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    if (!(await isAuthorizedI18nWorker(request))) {
      return jsonError("Not authorized.", 401);
    }

    const body = (await request.json().catch(() => ({}))) as {
      fullRegenerate?: boolean;
      languageCode?: string;
      requestedBy?: string;
    };
    const languageCode = normalizeLanguageCode(body.languageCode);
    if (!body.languageCode) return jsonError("languageCode is required.", 400);
    if (getBuiltinLocaleBundle(languageCode)) {
      return jsonError("Built-in language packs do not need generation.", 400);
    }

    const supabase = getServiceSupabase();
    const queued = await enqueueLocaleGenerationJob(supabase, {
      languageCode,
      requestedBy: body.requestedBy || "admin",
      userId: null,
      fullRegenerate: body.fullRegenerate === true,
    });

    return NextResponse.json({ languageCode, queued });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not create language pack job.",
      500,
    );
  }
}
