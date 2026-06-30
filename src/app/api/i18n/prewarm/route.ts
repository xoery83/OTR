import { NextResponse } from "next/server";
import {
  enqueueCommonLocaleGenerationJobs,
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

    const supabase = getServiceSupabase();
    const result = await enqueueCommonLocaleGenerationJobs(supabase, {
      requestedBy: "prewarm",
      userId: null,
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not prewarm locale bundles.",
      500,
    );
  }
}
