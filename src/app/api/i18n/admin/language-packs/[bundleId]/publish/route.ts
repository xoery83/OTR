import { NextResponse } from "next/server";
import { validateCompleteLanguagePack } from "@/lib/i18n/menu-language-pack";
import {
  getServiceSupabase,
  isAuthorizedI18nWorker,
} from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type BundleRow = {
  id: string;
  translations_json: Record<string, string> | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bundleId: string }> },
) {
  try {
    if (!(await isAuthorizedI18nWorker(request))) {
      return jsonError("Not authorized.", 401);
    }

    const { bundleId } = await params;
    const supabase = getServiceSupabase();
    const { data: bundle, error: loadError } = await supabase
      .from("i18n_locale_bundles")
      .select("id, translations_json")
      .eq("id", bundleId)
      .single();

    if (loadError || !bundle) {
      throw loadError || new Error("Language pack not found.");
    }

    const row = bundle as BundleRow;
    const validation = validateCompleteLanguagePack(row.translations_json ?? {});
    if (
      validation.missingKeys.length ||
      validation.extraKeys.length ||
      validation.placeholderErrors.length
    ) {
      return jsonError(
        [
          validation.missingKeys.length
            ? `Missing keys: ${validation.missingKeys.slice(0, 8).join(", ")}`
            : null,
          validation.extraKeys.length
            ? `Extra keys: ${validation.extraKeys.slice(0, 8).join(", ")}`
            : null,
          validation.placeholderErrors.length
            ? `Placeholder mismatch: ${validation.placeholderErrors
                .slice(0, 8)
                .join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join(" | "),
        400,
      );
    }

    const { data, error } = await supabase
      .from("i18n_locale_bundles")
      .update({
        status: "reviewed",
        published_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bundleId)
      .select("*")
      .single();

    if (error || !data) throw error || new Error("Could not publish language pack.");

    return NextResponse.json({ bundle: data });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not publish language pack.",
      500,
    );
  }
}
