import { NextResponse } from "next/server";
import {
  getServiceSupabase,
  isAuthorizedI18nWorker,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthorizedI18nWorker(request))) {
      return jsonError("Not authorized.", 401);
    }

    const supabase = getServiceSupabase();
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
      bundles: bundlesResult.data ?? [],
      jobs: jobsResult.data ?? [],
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
