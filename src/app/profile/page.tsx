"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { logout } from "@/lib/supabase/auth";
import { getErrorMessage } from "@/lib/errors";
import { getMemoryStats } from "@/lib/journeys/stats";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { getLedgerData, type LedgerData } from "@/lib/supabase/ledger";
import { getTripMemories } from "@/lib/supabase/memories";
import { getProfile, updateProfile } from "@/lib/supabase/profiles";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { LedgerCategory, Profile, Trip } from "@/types";

const ledgerCategories: LedgerCategory[] = [
  "flight",
  "hotel",
  "car",
  "fuel",
  "food",
  "ticket",
  "shopping",
  "transport",
  "insurance",
  "other",
];

const categoryLabelKeys: Record<LedgerCategory, TranslationKey> = {
  flight: "planner.expense.flight",
  hotel: "planner.expense.hotel",
  car: "planner.expense.car",
  fuel: "planner.expense.fuel",
  food: "planner.expense.food",
  ticket: "planner.expense.ticket",
  shopping: "planner.expense.shopping",
  transport: "planner.expense.transport",
  insurance: "planner.expense.insurance",
  other: "planner.expense.other",
};

type ProfileLedgerReport = {
  trip: Trip;
  data: LedgerData;
};

type MyLedgerReport = {
  trip: Trip;
  currency: string;
  total: number;
  shared: number;
  statsOnly: number;
  entries: number;
  categories: Record<LedgerCategory, number>;
};

type CurrencyLedgerSummary = {
  total: number;
  shared: number;
  statsOnly: number;
  entries: number;
  categories: Record<LedgerCategory, number>;
};

function emptyCategoryTotals() {
  return ledgerCategories.reduce(
    (totals, category) => ({ ...totals, [category]: 0 }),
    {} as Record<LedgerCategory, number>,
  );
}

function money(amount: number, currency: string, locale: "en" | "zh-CN") {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function buildMyLedgerReport(
  report: ProfileLedgerReport,
  userId: string,
): MyLedgerReport | null {
  const { trip, data } = report;
  const member = data.members.find((item) => item.userId === userId);
  if (!member) return null;

  const balance = data.summary.balances.find(
    (item) => item.member.id === member.id,
  );
  const categories = emptyCategoryTotals();
  let entries = 0;

  data.entries.forEach((entry) => {
    const participant = entry.participants.find(
      (item) => item.memberId === member.id,
    );
    const amount =
      participant?.computedShareBaseAmount ??
      (entry.accountingMode === "stats_only" && entry.payerMemberId === member.id
        ? entry.baseAmount
        : 0);

    if (amount <= 0) return;
    categories[entry.category] += amount;
    entries += 1;
  });

  const shared = balance?.owedTotal ?? 0;
  const statsOnly = balance?.statsOnlyTotal ?? 0;

  return {
    trip,
    currency: data.ledger.displayCurrency || data.ledger.baseCurrency,
    total: shared + statsOnly,
    shared,
    statsOnly,
    entries,
    categories,
  };
}

function ProfileContent({ user }: { user: User }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [journeys, setJourneys] = useState(0);
  const [memories, setMemories] = useState(0);
  const [photos, setPhotos] = useState(0);
  const [ledgerReports, setLedgerReports] = useState<ProfileLedgerReport[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLedgerLoading, setIsLedgerLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const profileData = await getProfile(user.id);
        const trips = await getTripsForCurrentUser();
        const [memoryGroups, ledgerResults] = await Promise.all([
          Promise.all(trips.map((trip) => getTripMemories(trip.id))),
          Promise.allSettled(
            trips.map(async (trip) => ({
              trip,
              data: await getLedgerData(trip.id),
            })),
          ),
        ]);
        const allMemories = memoryGroups.flat();
        const mine = allMemories.filter((memory) => memory.userId === user.id);
        const stats = getMemoryStats(mine);
        setProfile(profileData);
        setDisplayName(profileData.displayName);
        setAvatarUrl(profileData.avatarUrl ?? "");
        setJourneys(trips.length);
        setMemories(stats.total);
        setPhotos(stats.photos);
        setLedgerReports(
          ledgerResults.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
        );
      } catch (loadError) {
        setError(getErrorMessage(loadError, t("profile.error.load")));
      } finally {
        setIsLedgerLoading(false);
      }
    }
    loadProfile();
  }, [t, user.id]);

  const myLedgerReports = useMemo(
    () =>
      ledgerReports
        .map((report) => buildMyLedgerReport(report, user.id))
        .filter((report): report is MyLedgerReport => Boolean(report)),
    [ledgerReports, user.id],
  );

  const ledgerSummaryByCurrency = useMemo(() => {
    const summaries = new Map<string, CurrencyLedgerSummary>();

    myLedgerReports.forEach((report) => {
      const currency = report.currency;
      const summary =
        summaries.get(currency) ??
        ({
          total: 0,
          shared: 0,
          statsOnly: 0,
          entries: 0,
          categories: emptyCategoryTotals(),
        } satisfies CurrencyLedgerSummary);

      summary.total += report.total;
      summary.shared += report.shared;
      summary.statsOnly += report.statsOnly;
      summary.entries += report.entries;
      ledgerCategories.forEach((category) => {
        summary.categories[category] += report.categories[category] ?? 0;
      });
      summaries.set(currency, summary);
    });

    return [...summaries.entries()].map(([currency, summary]) => ({
      currency,
      summary,
    }));
  }, [myLedgerReports]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  async function saveProfile() {
    if (!displayName.trim()) {
      setError("Display name cannot be empty.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateProfile({
        id: user.id,
        displayName,
        avatarUrl,
      });
      setProfile(updated);
      setDisplayName(updated.displayName);
      setAvatarUrl(updated.avatarUrl ?? "");
      setNotice("Profile saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save profile."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Profile</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {profile?.displayName ?? "Your profile"}
        </h1>
        <p className="mt-2 text-sm text-stone-500">{user.email}</p>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="grid size-16 place-items-center overflow-hidden rounded-2xl bg-emerald-100 text-xl font-bold text-emerald-800">
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              profile?.displayName.slice(0, 1).toUpperCase() ?? "O"
            )}
          </div>
          <div>
            <p className="text-sm text-stone-500">Joined</p>
            <p className="font-semibold text-stone-950">
              {profile ? new Date(profile.createdAt).toLocaleDateString() : "..."}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Journeys", journeys],
            ["Memories", memories],
            ["Photos", photos],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-xl font-semibold text-stone-950">{value}</p>
              <p className="text-xs text-stone-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Basic fields</h2>
        {error ? (
          <p className="rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            {notice}
          </p>
        ) : null}
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Display name"
          className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
        />
        <input
          value={avatarUrl}
          onChange={(event) => setAvatarUrl(event.target.value)}
          placeholder="Avatar URL"
          className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
        />
        <button
          type="button"
          onClick={saveProfile}
          disabled={isSaving || !displayName.trim()}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          {isSaving ? "Saving..." : "Save profile"}
        </button>
      </section>

      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-bold text-emerald-800">
            {t("profile.ledger.eyebrow")}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-stone-950">
            {t("profile.ledger.title")}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {t("profile.ledger.description")}
          </p>
        </div>

        {isLedgerLoading ? (
          <div className="rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-500">
            {t("profile.ledger.loading")}
          </div>
        ) : myLedgerReports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            {t("profile.ledger.empty")}
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {ledgerSummaryByCurrency.map(({ currency, summary }) => {
                const categoryTotals = ledgerCategories
                  .map((category) => ({
                    category,
                    amount: summary.categories[category] ?? 0,
                  }))
                  .filter((item) => item.amount > 0)
                  .sort((left, right) => right.amount - left.amount);

                return (
                  <div key={currency} className="rounded-2xl bg-emerald-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                          {currency}
                        </p>
                        <p className="mt-1 text-2xl font-semibold text-emerald-950">
                          {money(summary.total, currency, locale)}
                        </p>
                      </div>
                      <p className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-emerald-800">
                        {t("profile.ledger.entryCount", {
                          count: summary.entries,
                        })}
                      </p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
                      <div className="rounded-xl bg-white/70 p-2 text-amber-900">
                        <p>{t("ledger.shared")}</p>
                        <p className="mt-1 text-sm">
                          {money(summary.shared, currency, locale)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white/70 p-2 text-stone-700">
                        <p>{t("ledger.statsOnly")}</p>
                        <p className="mt-1 text-sm">
                          {money(summary.statsOnly, currency, locale)}
                        </p>
                      </div>
                    </div>
                    {categoryTotals.length > 0 ? (
                      <div className="mt-3 rounded-xl bg-white/70 p-3">
                        <p className="text-[11px] font-black uppercase tracking-wide text-emerald-800">
                          {t("ledger.categoryMix")}
                        </p>
                        <div className="mt-2 space-y-1.5">
                          {categoryTotals.map(({ category, amount }) => (
                            <div
                              key={category}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="font-bold text-stone-600">
                                {t(categoryLabelKeys[category])}
                              </span>
                              <span className="font-black text-stone-950">
                                {money(amount, currency, locale)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="space-y-3">
              {myLedgerReports.map((report) => {
                const topCategories = ledgerCategories
                  .map((category) => ({
                    category,
                    amount: report.categories[category] ?? 0,
                  }))
                  .filter((item) => item.amount > 0)
                  .sort((left, right) => right.amount - left.amount)
                  .slice(0, 4);

                return (
                  <article
                    key={report.trip.id}
                    className="rounded-2xl border border-stone-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-stone-950">
                          {report.trip.name}
                        </h3>
                        <p className="mt-1 text-xs text-stone-500">
                          {report.trip.destination || t("tripCard.destinationTbd")}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-black text-emerald-900">
                          {money(report.total, report.currency, locale)}
                        </p>
                        <Link
                          href={`/trips/${report.trip.id}/ledger`}
                          className="mt-1 inline-block text-xs font-bold text-emerald-700"
                        >
                          {t("profile.ledger.open")}
                        </Link>
                      </div>
                    </div>

                    {topCategories.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topCategories.map(({ category, amount }) => (
                          <span
                            key={category}
                            className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700"
                          >
                            {t(categoryLabelKeys[category])} ·{" "}
                            {money(amount, report.currency, locale)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-2xl bg-stone-50 p-3 text-sm text-stone-500">
                        {t("profile.ledger.noExpenses")}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <button
        type="button"
        onClick={handleLogout}
        className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
      >
        Logout
      </button>
    </div>
  );
}

export default function ProfilePage() {
  return <AuthGate>{(user) => <ProfileContent user={user} />}</AuthGate>;
}
