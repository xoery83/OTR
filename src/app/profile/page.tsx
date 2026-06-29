"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { getErrorMessage } from "@/lib/errors";
import { getMemoryStats } from "@/lib/journeys/stats";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { logout } from "@/lib/supabase/auth";
import { getMyItineraryRatingCount } from "@/lib/supabase/itinerary-ratings";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getLedgerData, type LedgerData } from "@/lib/supabase/ledger";
import { getTripMemories } from "@/lib/supabase/memories";
import { getProfile, updateProfile } from "@/lib/supabase/profiles";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type {
  JourneyMember,
  LedgerCategory,
  LedgerEntry,
  Profile,
  Trip,
  AccountRole,
} from "@/types";

const accountRoleLabels: Record<AccountRole, string> = {
  admin: "管理员",
  free_user: "免费用户",
  plus: "Plus用户",
  pro: "Pro用户",
};

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

type LedgerSearchResult = {
  trip: Trip;
  entry: LedgerEntry;
  currency: string;
  amount: number;
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

function normalize(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function memberShareForEntry(entry: LedgerEntry, member: JourneyMember) {
  const participant = entry.participants.find(
    (item) => item.memberId === member.id,
  );

  return (
    participant?.computedShareBaseAmount ??
    (entry.accountingMode === "stats_only" && entry.payerMemberId === member.id
      ? entry.baseAmount
      : 0)
  );
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
    const amount = memberShareForEntry(entry, member);
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

function entryMatchesQuery(
  entry: LedgerEntry,
  query: string,
  categoryLabel: string,
) {
  if (!query) return true;
  return [
    entry.title,
    entry.description,
    entry.addressText,
    entry.expenseDate,
    entry.startDate,
    entry.endDate,
    entry.originalCurrency,
    entry.baseCurrency,
    entry.originalAmount,
    entry.baseAmount,
    entry.accountingMode,
    categoryLabel,
    entry.payer?.displayName,
    ...entry.participants.map((participant) => participant.member?.displayName),
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ")
    .includes(query);
}

function buildFriends(
  trips: Trip[],
  membersByTrip: Map<string, JourneyMember[]>,
  user: User,
) {
  const byEmail = new Map<
    string,
    {
      email: string;
      displayName: string;
      avatarUrl: string | null;
      journeyIds: Set<string>;
      journeys: Set<string>;
    }
  >();
  const myEmail = normalize(user.email);

  trips.forEach((trip) => {
    const members = membersByTrip.get(trip.id) ?? [];
    members.forEach((member) => {
      const email = normalize(member.inviteEmail);
      if (!email || email === myEmail) return;
      const current =
        byEmail.get(email) ??
        {
          email,
          displayName: member.displayName,
          avatarUrl: member.avatarUrl,
          journeyIds: new Set<string>(),
          journeys: new Set<string>(),
        };

      current.journeyIds.add(trip.id);
      current.journeys.add(trip.name);
      if (!current.avatarUrl && member.avatarUrl) current.avatarUrl = member.avatarUrl;
      byEmail.set(email, current);
    });
  });

  return [...byEmail.values()]
    .map((item) => ({
      email: item.email,
      displayName: item.displayName,
      avatarUrl: item.avatarUrl,
      journeyCount: item.journeyIds.size,
      journeys: [...item.journeys],
    }))
    .sort((left, right) => right.journeyCount - left.journeyCount);
}

function ProfileContent({ user }: { user: User }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [journeys, setJourneys] = useState<Trip[]>([]);
  const [membersByTrip, setMembersByTrip] = useState<
    Map<string, JourneyMember[]>
  >(new Map());
  const [memoryCount, setMemoryCount] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [ledgerReports, setLedgerReports] = useState<ProfileLedgerReport[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [globalAka, setGlobalAka] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLedgerLoading, setIsLedgerLoading] = useState(true);
  const [ledgerUnlocked, setLedgerUnlocked] = useState(false);
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        const [profileData, trips, ratings] = await Promise.all([
          getProfile(user.id),
          getTripsForCurrentUser(),
          getMyItineraryRatingCount(),
        ]);
        const [memoryGroups, ledgerResults, memberResults] = await Promise.all([
          Promise.all(trips.map((trip) => getTripMemories(trip.id))),
          Promise.allSettled(
            trips.map(async (trip) => ({
              trip,
              data: await getLedgerData(trip.id),
            })),
          ),
          Promise.allSettled(
            trips.map(async (trip) => ({
              tripId: trip.id,
              members: await getJourneyMembers(trip.id),
            })),
          ),
        ]);

        if (!isMounted) return;

        const allMemories = memoryGroups.flat();
        const mine = allMemories.filter((memory) => memory.userId === user.id);
        const stats = getMemoryStats(mine);
        setProfile(profileData);
        setDisplayName(profileData.displayName);
        setGlobalAka(profileData.globalAka ?? "");
        setJourneys(trips);
        setMemoryCount(stats.total);
        setPhotoCount(stats.photos);
        setRatingCount(ratings);
        setLedgerReports(
          ledgerResults.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
        );
        setMembersByTrip(
          new Map(
            memberResults.flatMap((result) =>
              result.status === "fulfilled"
                ? [[result.value.tripId, result.value.members] as const]
                : [],
            ),
          ),
        );
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError, t("profile.error.load")));
        }
      } finally {
        if (isMounted) setIsLedgerLoading(false);
      }
    }

    loadProfile();
    return () => {
      isMounted = false;
    };
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
      const summary =
        summaries.get(report.currency) ??
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
      summaries.set(report.currency, summary);
    });

    return [...summaries.entries()].map(([currency, summary]) => ({
      currency,
      summary,
    }));
  }, [myLedgerReports]);

  const ledgerSearchResults = useMemo(() => {
    const query = normalize(ledgerSearchQuery);
    if (!query) return [];

    return ledgerReports
      .flatMap((report): LedgerSearchResult[] => {
        const member = report.data.members.find((item) => item.userId === user.id);
        if (!member) return [];
        const currency =
          report.data.ledger.displayCurrency || report.data.ledger.baseCurrency;

        return report.data.entries
          .map((entry) => ({
            trip: report.trip,
            entry,
            currency,
            amount: memberShareForEntry(entry, member),
          }))
          .filter((item) => item.amount > 0)
          .filter((item) =>
            entryMatchesQuery(
              item.entry,
              query,
              t(categoryLabelKeys[item.entry.category]),
            ),
          );
      })
      .sort(
        (left, right) =>
          new Date(right.entry.expenseDate).getTime() -
            new Date(left.entry.expenseDate).getTime() ||
          right.amount - left.amount,
      )
      .slice(0, 30);
  }, [ledgerReports, ledgerSearchQuery, t, user.id]);

  const ledgerSearchSummary = useMemo(() => {
    const totals = new Map<string, { amount: number; count: number }>();
    ledgerSearchResults.forEach((result) => {
      const current = totals.get(result.currency) ?? { amount: 0, count: 0 };
      current.amount += result.amount;
      current.count += 1;
      totals.set(result.currency, current);
    });
    return [...totals.entries()].map(([currency, summary]) => ({
      currency,
      ...summary,
    }));
  }, [ledgerSearchResults]);

  const friends = useMemo(
    () => buildFriends(journeys, membersByTrip, user),
    [journeys, membersByTrip, user],
  );

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
        globalAka,
        avatarUrl: profile?.avatarUrl ?? null,
      });
      setProfile(updated);
      setDisplayName(updated.displayName);
      setGlobalAka(updated.globalAka ?? "");
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
              <img
                src={profile.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              profile?.displayName.slice(0, 1).toUpperCase() ?? "O"
            )}
          </div>
          <div>
            <p className="text-sm text-stone-500">Joined</p>
            <p className="font-semibold text-stone-950">
              {profile ? new Date(profile.createdAt).toLocaleDateString() : "..."}
            </p>
            <p className="mt-1 inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
              {accountRoleLabels[profile?.accountRole ?? "free_user"]}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Journeys", journeys.length],
            ["Memories", memoryCount],
            ["Photos", photoCount],
            ["Ratings", ratingCount],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-xl font-semibold text-stone-950">{value}</p>
              <p className="text-xs text-stone-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-xl font-semibold">Basic fields</h2>
          <p className="mt-1 text-sm text-stone-500">
            全局 AKA 会在创建新 Journey 时自动带入你的旅程成员昵称。
          </p>
        </div>
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
          value={globalAka}
          onChange={(event) => setGlobalAka(event.target.value)}
          placeholder="Global AKA, separated by spaces, commas, / or ;"
          className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
        />
        <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm font-bold text-stone-600">
          当前级别：{accountRoleLabels[profile?.accountRole ?? "free_user"]}
        </div>
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
        <div className="flex items-start justify-between gap-3">
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
          <button
            type="button"
            onClick={() => setLedgerUnlocked((current) => !current)}
            className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-700"
          >
            {ledgerUnlocked ? "锁定" : "解锁"}
          </button>
        </div>

        {!ledgerUnlocked ? (
          <div className="rounded-3xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-2xl font-black text-stone-400">锁定</p>
            <p className="mt-2 text-sm text-stone-500">
              点击解锁查看跨旅程账本汇总和费用搜索。
            </p>
          </div>
        ) : isLedgerLoading ? (
          <div className="rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-500">
            {t("profile.ledger.loading")}
          </div>
        ) : myLedgerReports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            {t("profile.ledger.empty")}
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-stone-50 p-2">
              <input
                value={ledgerSearchQuery}
                onChange={(event) => setLedgerSearchQuery(event.target.value)}
                placeholder="搜索所有旅程费用..."
                className="min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-300"
              />
            </div>

            {ledgerSearchQuery.trim() ? (
              <div className="space-y-2">
                {ledgerSearchResults.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
                    没有找到匹配的费用。
                  </p>
                ) : (
                  <>
                    <div className="rounded-2xl bg-emerald-50 p-3">
                      <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                        搜索合计
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ledgerSearchSummary.map((summary) => (
                          <span
                            key={summary.currency}
                            className="rounded-full bg-white px-3 py-1.5 text-sm font-black text-emerald-950"
                          >
                            {money(summary.amount, summary.currency, locale)} ·{" "}
                            {summary.count} 条
                          </span>
                        ))}
                      </div>
                    </div>
                    {ledgerSearchResults.map((result) => (
                      <Link
                        key={`${result.trip.id}-${result.entry.id}`}
                        href={`/trips/${result.trip.id}/ledger?view=expenses&q=${encodeURIComponent(
                          ledgerSearchQuery.trim(),
                        )}`}
                        className="block rounded-2xl border border-stone-200 p-3 hover:border-emerald-200 hover:bg-emerald-50/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-stone-950">
                              {result.entry.title}
                            </p>
                            <p className="mt-1 truncate text-xs text-stone-500">
                              {result.trip.name} ·{" "}
                              {t(categoryLabelKeys[result.entry.category])} ·{" "}
                              {result.entry.expenseDate}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-black text-emerald-900">
                            {money(result.amount, result.currency, locale)}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </>
                )}
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
                              {report.trip.destination ||
                                t("tripCard.destinationTbd")}
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
          </>
        )}
      </section>

      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-bold text-emerald-800">Friends</p>
          <h2 className="mt-1 text-xl font-semibold text-stone-950">
            我的朋友
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            按共同组队次数排序。只有填写了邮箱的旅程成员会合并为同一个朋友。
          </p>
        </div>
        {friends.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            还没有可统计的朋友。
          </p>
        ) : (
          <div className="space-y-2">
            {friends.slice(0, 20).map((friend) => (
              <article
                key={friend.email}
                className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-100 text-sm font-black text-emerald-800">
                    {friend.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={friend.avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      friend.displayName.slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-black text-stone-950">
                      {friend.displayName}
                    </h3>
                    <p className="truncate text-xs text-stone-500">
                      {friend.email}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-stone-400">
                      {friend.journeys.slice(0, 3).join(" · ")}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
                  {friend.journeyCount} 次
                </span>
              </article>
            ))}
          </div>
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
