import { createClient } from "@supabase/supabase-js";
import {
  i18nBaseVersion,
  i18nDefaultNamespace,
  i18nPrewarmLanguageCodes,
} from "./bundles";
import { normalizeLanguageCode } from "./dictionaries";

export function getRequestSupabase(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }
  if (!authorization) return null;

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function isAuthorizedI18nWorker(request: Request) {
  const configuredSecret = process.env.I18N_JOB_SECRET;
  const requestSecret = request.headers.get("x-otr-job-secret");
  if (configuredSecret && requestSecret === configuredSecret) return true;

  const supabase = getRequestSupabase(request);
  if (!supabase) return false;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return false;

  const { data, error } = await supabase.rpc("is_system_admin", {
    target_user_id: userData.user.id,
  });

  if (error) return false;
  return Boolean(data);
}

export function localeGenerationPayload(languageCode: string, requestedBy: string) {
  return {
    language_code: normalizeLanguageCode(languageCode),
    namespace: i18nDefaultNamespace,
    base_version: i18nBaseVersion,
    requested_by: requestedBy,
  };
}

export async function enqueueLocaleGenerationJob(
  supabase: ReturnType<typeof getServiceSupabase> | NonNullable<ReturnType<typeof getRequestSupabase>>,
  input: { languageCode: string; requestedBy: string; userId?: string | null },
) {
  const languageCode = normalizeLanguageCode(input.languageCode);
  const payload = localeGenerationPayload(languageCode, input.requestedBy);
  const { error } = await supabase.from("background_jobs").insert({
    journey_id: null,
    user_id: input.userId ?? null,
    job_type: "generate_locale_bundle",
    title: `Generate ${languageCode} language bundle`,
    current_step: "Queued",
    payload,
  });

  if (!error) return true;
  if ((error as { code?: string }).code === "23505") return false;
  throw error;
}

export async function enqueueCommonLocaleGenerationJobs(
  supabase: ReturnType<typeof getServiceSupabase> | NonNullable<ReturnType<typeof getRequestSupabase>>,
  input: { requestedBy: string; userId?: string | null; include?: string[] },
) {
  const languages = input.include ?? [...i18nPrewarmLanguageCodes];
  let queued = 0;
  let existing = 0;

  for (const languageCode of languages) {
    const didQueue = await enqueueLocaleGenerationJob(supabase, {
      languageCode,
      requestedBy: input.requestedBy,
      userId: input.userId,
    });

    if (didQueue) queued += 1;
    else existing += 1;
  }

  return { queued, existing, languages };
}
