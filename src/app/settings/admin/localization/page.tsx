"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { i18nBaseVersion, i18nPrewarmLanguageCodes } from "@/lib/i18n/bundles";
import { supabase } from "@/lib/supabase/client";
import { getProfile } from "@/lib/supabase/profiles";

type LocaleBundleRow = {
  id: string;
  language_code: string;
  namespace: string;
  base_version: string;
  translations_json: Record<string, string> | null;
  status: "machine" | "reviewed";
  engine: string;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  missing_keys_count: number | null;
  token_estimate: number | null;
  cost_estimate_usd: number | null;
  error_message: string | null;
  generated_by: string | null;
  published_at: string | null;
  updated_at: string;
};

type BackgroundJobRow = {
  id: string;
  job_type: "generate_locale_bundle" | "translate_user_content";
  status: string;
  title: string | null;
  current_step: string | null;
  progress: number | null;
  error_message: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

type SummaryPayload = {
  bundles: LocaleBundleRow[];
  jobs: BackgroundJobRow[];
  totalKeyCount?: number;
};

function countKeys(bundle: LocaleBundleRow) {
  return Object.keys(bundle.translations_json ?? {}).length;
}

function jobLanguage(job: BackgroundJobRow) {
  const payload = job.payload;
  const value =
    job.job_type === "generate_locale_bundle"
      ? payload?.language_code
      : payload?.target_lang;
  return typeof value === "string" ? value : "";
}

function statusLabel(status: string) {
  if (status === "queued") return "pending";
  if (status === "processing") return "running";
  return status;
}

function AdminLocalizationContent({ user }: { user: User }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [summary, setSummary] = useState<SummaryPayload>({
    bundles: [],
    jobs: [],
  });
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    i18nPrewarmLanguageCodes[0],
  );
  const [fullRegenerate, setFullRegenerate] = useState(false);
  const [previewBundleId, setPreviewBundleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewBundle = useMemo(
    () => summary.bundles.find((bundle) => bundle.id === previewBundleId) ?? null,
    [previewBundleId, summary.bundles],
  );
  const selectedBundle = useMemo(
    () =>
      summary.bundles.find(
        (bundle) => bundle.language_code === selectedLanguage,
      ) ?? null,
    [selectedLanguage, summary.bundles],
  );
  const selectedMissingCount = Math.max(
    0,
    (summary.totalKeyCount ?? 0) - (selectedBundle ? countKeys(selectedBundle) : 0),
  );
  const queuedLocaleJobs = useMemo(
    () =>
      summary.jobs.filter(
        (job) =>
          job.job_type === "generate_locale_bundle" &&
          (job.status === "queued" || job.status === "failed"),
      ).length,
    [summary.jobs],
  );
  const queuedContentJobs = useMemo(
    () =>
      summary.jobs.filter(
        (job) => job.job_type === "translate_user_content" && job.status === "queued",
      ).length,
    [summary.jobs],
  );

  const loadSummary = useCallback(async () => {
    setError(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Missing auth session.");

    const response = await fetch("/api/i18n/admin/summary", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = (await response.json()) as SummaryPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Could not load localization.");
    setSummary({
      bundles: payload.bundles ?? [],
      jobs: payload.jobs ?? [],
      totalKeyCount: payload.totalKeyCount,
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const profile = await getProfile(user.id);
        if (!isMounted) return;
        const admin = profile?.accountRole === "admin";
        setIsAdmin(admin);
        if (admin) await loadSummary();
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError, "Could not load localization."));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [loadSummary, user.id]);

  useEffect(() => {
    if (!isAdmin) return;
    const hasRunningJob = summary.jobs.some(
      (job) =>
        job.job_type === "generate_locale_bundle" &&
        (job.status === "queued" || job.status === "processing"),
    );
    if (!hasRunningJob) return;

    const timer = window.setTimeout(() => {
      void loadSummary();
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [isAdmin, loadSummary, summary.jobs]);

  async function postJson(path: string, body: Record<string, unknown>) {
    setIsWorking(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Missing auth session.");

      const response = await fetch(path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        queued?: boolean;
      };
      if (!response.ok) throw new Error(payload.error || "Operation failed.");
      await loadSummary();
      return payload;
    } catch (workError) {
      setError(getErrorMessage(workError, "Localization operation failed."));
      return null;
    } finally {
      setIsWorking(false);
    }
  }

  async function generateLanguagePack() {
    const payload = await postJson("/api/i18n/admin/language-pack-jobs", {
      languageCode: selectedLanguage,
      fullRegenerate,
      requestedBy: user.id,
    });
    if (!payload) return;
    setNotice(
      payload.queued
        ? "Language pack generation queued."
        : "A matching language pack job is already pending.",
    );
  }

  async function processBundleJob() {
    const payload = await postJson("/api/i18n/process-locale-jobs", {
      languageCode: selectedLanguage,
    });
    if (!payload) return;
    setNotice("Language pack worker finished one pass.");
  }

  async function processContentJobs() {
    const payload = await postJson("/api/i18n/process-content-jobs", { limit: 10 });
    if (!payload) return;
    setNotice("Content translation worker finished one pass.");
  }

  async function publishBundle(bundleId: string) {
    const payload = await postJson(
      `/api/i18n/admin/language-packs/${encodeURIComponent(bundleId)}/publish`,
      {},
    );
    if (!payload) return;
    setNotice("Language pack published.");
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-semibold text-stone-600 shadow-sm">
          Loading localization tools...
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
          Admin access is required.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <section className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-emerald-700">Localization</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-950">
              Language packs and translation cache
            </h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Base version {i18nBaseVersion}. Source locale: English. Dynamic user
              content still uses LibreTranslate.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={isWorking}
            className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-700 disabled:text-stone-400"
          >
            Refresh
          </button>
        </div>
      </section>

      {notice ? (
        <p className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">
          Generate Language Pack
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">
              Target language
            </span>
            <select
              value={selectedLanguage}
              onChange={(event) => setSelectedLanguage(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-900"
            >
              {i18nPrewarmLanguageCodes.map((languageCode) => (
                <option key={languageCode} value={languageCode}>
                  {languageCode}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-stone-200 px-4 py-3 text-sm font-bold text-stone-700">
            <input
              type="checkbox"
              checked={fullRegenerate}
              onChange={(event) => setFullRegenerate(event.target.checked)}
              className="h-4 w-4 accent-emerald-700"
            />
            Full regenerate
          </label>
          <button
            type="button"
            onClick={() => void generateLanguagePack()}
            disabled={isWorking}
            className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm disabled:bg-stone-300"
          >
            Generate Language Pack
          </button>
        </div>
        <p className="mt-3 text-xs font-semibold text-stone-500">
          {selectedBundle
            ? `${selectedLanguage} has ${countKeys(selectedBundle)}/${
                summary.totalKeyCount ?? 0
              } keys. Missing: ${selectedMissingCount}.`
            : `${selectedLanguage} has not been generated yet.`}
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => void processBundleJob()}
          disabled={isWorking}
          className="rounded-2xl border border-sky-100 bg-white p-4 text-left shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:opacity-60"
        >
          <p className="text-sm font-bold text-sky-800">
            Process language pack job ({queuedLocaleJobs})
          </p>
          <p className="mt-1 text-xs leading-5 text-stone-600">
            Runs one queued LLM generation task. Only one language pack can run at a
            time.
          </p>
        </button>
        <button
          type="button"
          onClick={() => void processContentJobs()}
          disabled={isWorking}
          className="rounded-2xl border border-amber-100 bg-white p-4 text-left shadow-sm transition hover:border-amber-200 hover:bg-amber-50 disabled:opacity-60"
        >
          <p className="text-sm font-bold text-amber-800">
            Process content jobs ({queuedContentJobs})
          </p>
          <p className="mt-1 text-xs leading-5 text-stone-600">
            Translates queued user notes and descriptions through LibreTranslate.
          </p>
        </button>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">Language packs</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-100 text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="py-2 pr-4">Language</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Keys</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2 pr-4">Updated</th>
                <th className="py-2 pr-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {summary.bundles.map((bundle) => (
                <tr key={bundle.id}>
                  <td className="py-3 pr-4 font-semibold text-stone-900">
                    {bundle.language_code}
                  </td>
                  <td className="py-3 pr-4 text-stone-700">
                    {bundle.status === "reviewed" ? "published" : "draft"}
                  </td>
                  <td className="py-3 pr-4 text-stone-700">
                    {countKeys(bundle)}/{summary.totalKeyCount ?? "-"}
                  </td>
                  <td className="py-3 pr-4 text-stone-700">
                    {bundle.provider || bundle.engine}
                    {bundle.model ? ` · ${bundle.model}` : ""}
                  </td>
                  <td className="py-3 pr-4 text-stone-700">
                    {bundle.token_estimate ?? "-"}
                  </td>
                  <td className="py-3 pr-4 text-stone-500">
                    {new Date(bundle.updated_at).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewBundleId(bundle.id)}
                        className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700"
                      >
                        Preview
                      </button>
                      {bundle.status === "machine" ? (
                        <button
                          type="button"
                          onClick={() => void publishBundle(bundle.id)}
                          disabled={isWorking}
                          className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 disabled:text-stone-400"
                        >
                          Publish
                        </button>
                      ) : (
                        <span className="rounded-full bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-400">
                          Published
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {summary.bundles.length === 0 ? (
                <tr>
                  <td className="py-5 text-sm font-semibold text-stone-500" colSpan={7}>
                    No generated language packs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {previewBundle ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">
                Preview JSON · {previewBundle.language_code}
              </h2>
              <p className="mt-1 text-xs font-semibold text-stone-500">
                {countKeys(previewBundle)} keys ·{" "}
                {previewBundle.prompt_version || "no prompt version"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPreviewBundleId(null)}
              className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-700"
            >
              Close preview
            </button>
          </div>
          <pre className="mt-4 max-h-96 overflow-auto rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-50">
            {JSON.stringify(previewBundle.translations_json ?? {}, null, 2)}
          </pre>
        </section>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">Recent jobs</h2>
        <div className="mt-4 space-y-3">
          {summary.jobs.map((job) => (
            <article
              key={job.id}
              className="rounded-2xl border border-stone-100 bg-stone-50 p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-stone-900">
                    {job.title || job.job_type}{" "}
                    {jobLanguage(job) ? `· ${jobLanguage(job)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {statusLabel(job.status)} · {job.current_step || "Queued"} ·{" "}
                    {new Date(job.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-stone-600">
                  {job.progress ?? 0}%
                </span>
              </div>
              {job.result ? (
                <p className="mt-2 text-xs font-semibold text-stone-500">
                  {typeof job.result.provider === "string"
                    ? `${job.result.provider} · ${job.result.model ?? ""} · ${
                        job.result.tokenEstimate ?? "-"
                      } tokens`
                    : null}
                </p>
              ) : null}
              {job.error_message ? (
                <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">
                  {job.error_message}
                </p>
              ) : null}
            </article>
          ))}
          {summary.jobs.length === 0 ? (
            <p className="rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-500">
              No localization jobs yet.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function AdminLocalizationPage() {
  return <AuthGate>{(user) => <AdminLocalizationContent user={user} />}</AuthGate>;
}
