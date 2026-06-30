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
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

type SummaryPayload = {
  advancement?: {
    complete: boolean;
    error?: string;
    languageCode: string;
    translatedKeyCount: number;
    totalKeyCount: number;
  } | null;
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

function AdminLocalizationContent({ user }: { user: User }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [summary, setSummary] = useState<SummaryPayload>({
    bundles: [],
    jobs: [],
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const incompletePrewarmCount = useMemo(() => {
    const total = summary.totalKeyCount ?? 0;
    if (!total) return 0;
    return i18nPrewarmLanguageCodes.filter((languageCode) => {
      const bundle = summary.bundles.find(
        (item) => item.language_code === languageCode,
      );
      return !bundle || countKeys(bundle) < total;
    }).length;
  }, [summary.bundles, summary.totalKeyCount]);

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
      advancement: payload.advancement ?? null,
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
    if (!isAdmin || incompletePrewarmCount === 0 || isWorking) return;

    const timer = window.setTimeout(() => {
      void loadSummary();
    }, summary.advancement?.error ? 30000 : 3500);

    return () => window.clearTimeout(timer);
  }, [incompletePrewarmCount, isAdmin, isWorking, loadSummary, summary]);

  async function postWorker(path: string, body: Record<string, unknown>) {
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Operation failed.");
      setNotice("Operation finished. Summary refreshed.");
      await loadSummary();
    } catch (workError) {
      setError(getErrorMessage(workError, "Localization operation failed."));
    } finally {
      setIsWorking(false);
    }
  }

  async function markReviewed(bundleId: string) {
    setIsWorking(true);
    setError(null);
    setNotice(null);
    try {
      const { error: updateError } = await supabase
        .from("i18n_locale_bundles")
        .update({ status: "reviewed", created_by: "admin" })
        .eq("id", bundleId);
      if (updateError) throw updateError;
      setNotice("Language bundle marked as reviewed.");
      await loadSummary();
    } catch (reviewError) {
      setError(getErrorMessage(reviewError, "Could not mark bundle reviewed."));
    } finally {
      setIsWorking(false);
    }
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
              Language bundles and translation cache
            </h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Base version {i18nBaseVersion}. Prewarm languages:{" "}
              {i18nPrewarmLanguageCodes.join(", ")}.
            </p>
            {incompletePrewarmCount > 0 ? (
              <p className="mt-1 text-sm font-semibold text-emerald-700">
                Auto prewarming {incompletePrewarmCount} language bundle
                {incompletePrewarmCount === 1 ? "" : "s"}...
              </p>
            ) : null}
            {summary.advancement ? (
              summary.advancement.error ? (
                <p className="mt-1 text-xs font-semibold text-red-600">
                  Latest batch paused: {summary.advancement.languageCode} ·{" "}
                  {summary.advancement.error}
                </p>
              ) : (
                <p className="mt-1 text-xs font-semibold text-stone-500">
                  Latest batch: {summary.advancement.languageCode}{" "}
                  {summary.advancement.translatedKeyCount}/
                  {summary.advancement.totalKeyCount}
                </p>
              )
            ) : null}
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

      <section className="grid gap-3 md:grid-cols-3">
        <button
          type="button"
          onClick={() => void postWorker("/api/i18n/prewarm", {})}
          disabled={isWorking}
          className="rounded-2xl border border-emerald-100 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 disabled:opacity-60"
        >
          <p className="text-sm font-bold text-emerald-800">Prewarm bundles</p>
          <p className="mt-1 text-xs leading-5 text-stone-600">
            Queue common language bundles.
          </p>
        </button>
        <button
          type="button"
          onClick={() =>
            void postWorker("/api/i18n/process-locale-jobs", { limit: 3 })
          }
          disabled={isWorking}
          className="rounded-2xl border border-sky-100 bg-white p-4 text-left shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:opacity-60"
        >
          <p className="text-sm font-bold text-sky-800">
            Process bundle jobs ({queuedLocaleJobs})
          </p>
          <p className="mt-1 text-xs leading-5 text-stone-600">
            Generate queued menu language packs.
          </p>
        </button>
        <button
          type="button"
          onClick={() =>
            void postWorker("/api/i18n/process-content-jobs", { limit: 10 })
          }
          disabled={isWorking}
          className="rounded-2xl border border-amber-100 bg-white p-4 text-left shadow-sm transition hover:border-amber-200 hover:bg-amber-50 disabled:opacity-60"
        >
          <p className="text-sm font-bold text-amber-800">
            Process content jobs ({queuedContentJobs})
          </p>
          <p className="mt-1 text-xs leading-5 text-stone-600">
            Translate queued user notes and descriptions.
          </p>
        </button>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">Language bundles</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-100 text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="py-2 pr-4">Language</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Keys</th>
                <th className="py-2 pr-4">Engine</th>
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
                  <td className="py-3 pr-4 text-stone-700">{bundle.status}</td>
                  <td className="py-3 pr-4 text-stone-700">{countKeys(bundle)}</td>
                  <td className="py-3 pr-4 text-stone-700">{bundle.engine}</td>
                  <td className="py-3 pr-4 text-stone-500">
                    {new Date(bundle.updated_at).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    {bundle.status === "machine" ? (
                      <button
                        type="button"
                        onClick={() => void markReviewed(bundle.id)}
                        disabled={isWorking}
                        className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 disabled:text-stone-400"
                      >
                        Mark reviewed
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-stone-400">
                        Reviewed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {summary.bundles.length === 0 ? (
                <tr>
                  <td className="py-5 text-sm font-semibold text-stone-500" colSpan={6}>
                    No generated bundles yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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
                    {job.title || job.job_type} {jobLanguage(job) ? `· ${jobLanguage(job)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {job.status} · {job.current_step || "Queued"} ·{" "}
                    {new Date(job.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-stone-600">
                  {job.progress ?? 0}%
                </span>
              </div>
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
