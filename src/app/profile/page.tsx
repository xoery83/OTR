"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/AuthGate";
import { CurrencyCombobox } from "@/components/CurrencyCombobox";
import { useI18n } from "@/components/I18nProvider";
import { getErrorMessage } from "@/lib/errors";
import { getMemoryStats } from "@/lib/journeys/stats";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { getMediaAssetsByMemoryIds } from "@/lib/supabase/media-assets";
import { logout } from "@/lib/supabase/auth";
import { getMyItineraryRatingCount } from "@/lib/supabase/itinerary-ratings";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import {
  ensureJourneyExchangeRate,
  getLedgerData,
  type LedgerData,
} from "@/lib/supabase/ledger";
import {
  getSignedMemoryImageUrls,
  getTripMemories,
} from "@/lib/supabase/memories";
import { getProfile, updateProfile } from "@/lib/supabase/profiles";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type {
  JourneyMember,
  LedgerCategory,
  LedgerEntry,
  MemoryEntry,
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
  globalCurrency: string;
  conversionRateToGlobal: number;
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

type FavoriteMemorySummary = MemoryEntry & {
  tripName: string;
  tripDestination: string;
};

type ProfilePanel = "basic" | "ledger" | "favorites" | "friends" | "account";

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

function formatShortDate(value: string, locale: "en" | "zh-CN") {
  return new Date(value).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "numeric",
    day: "numeric",
  });
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
    categories[entry.category] += amount * report.conversionRateToGlobal;
    entries += 1;
  });

  const shared = (balance?.owedTotal ?? 0) * report.conversionRateToGlobal;
  const statsOnly =
    (balance?.statsOnlyTotal ?? 0) * report.conversionRateToGlobal;

  return {
    trip,
    currency: report.globalCurrency,
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
  const [favoriteMemories, setFavoriteMemories] = useState<
    FavoriteMemorySummary[]
  >([]);
  const [favoriteImageUrls, setFavoriteImageUrls] = useState<
    Record<string, string>
  >({});
  const [favoriteDriveUrls, setFavoriteDriveUrls] = useState<
    Record<string, string>
  >({});
  const [selectedFavorite, setSelectedFavorite] =
    useState<FavoriteMemorySummary | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [ledgerReports, setLedgerReports] = useState<ProfileLedgerReport[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [globalAka, setGlobalAka] = useState("");
  const [globalBaseCurrency, setGlobalBaseCurrency] = useState("NZD");
  const [isSaving, setIsSaving] = useState(false);
  const [isLedgerLoading, setIsLedgerLoading] = useState(true);
  const [ledgerUnlocked, setLedgerUnlocked] = useState(false);
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState("");
  const [isLedgerSearchActive, setIsLedgerSearchActive] = useState(false);
  const ledgerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [expandedPanels, setExpandedPanels] = useState<Record<ProfilePanel, boolean>>({
    basic: false,
    ledger: false,
    favorites: false,
    friends: false,
    account: false,
  });
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
            trips.map(async (trip) => {
              const data = await getLedgerData(trip.id);
              const globalCurrency = profileData.globalBaseCurrency || "NZD";
              const rate =
                data.ledger.baseCurrency === globalCurrency
                  ? { rateToBase: 1 }
                  : await ensureJourneyExchangeRate(
                      trip.id,
                      globalCurrency,
                      data.ledger.baseCurrency,
                    );
              return {
                trip,
                data,
                globalCurrency,
                conversionRateToGlobal: 1 / Number(rate.rateToBase || 1),
              };
            }),
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
        const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
        setProfile(profileData);
        setDisplayName(profileData.displayName);
        setGlobalAka(profileData.globalAka ?? "");
        setGlobalBaseCurrency(profileData.globalBaseCurrency || "NZD");
        setJourneys(trips);
        setMemoryCount(stats.total);
        setPhotoCount(stats.photos);
        const favorites = allMemories
          .filter((memory) => memory.isFavorited)
          .map((memory) => {
            const trip = tripsById.get(memory.tripId);
            return {
              ...memory,
              tripName: trip?.name ?? "Journey",
              tripDestination: trip?.destination ?? "",
            };
          })
          .sort(
            (left, right) =>
              new Date(right.capturedAt).getTime() -
                new Date(left.capturedAt).getTime() ||
              new Date(right.createdAt).getTime() -
                new Date(left.createdAt).getTime(),
          );
        setFavoriteMemories(favorites);
        getSignedMemoryImageUrls(favorites)
          .then((urls) => {
            if (isMounted) setFavoriteImageUrls(urls);
          })
          .catch(() => {
            if (isMounted) setFavoriteImageUrls({});
          });
        getMediaAssetsByMemoryIds(favorites.map((memory) => memory.id))
          .then((assets) => {
            if (!isMounted) return;
            setFavoriteDriveUrls(
              assets.reduce<Record<string, string>>((urls, asset) => {
                if (asset.memoryEntryId && asset.providerWebUrl) {
                  urls[asset.memoryEntryId] = asset.providerWebUrl;
                }
                return urls;
              }, {}),
            );
          })
          .catch(() => {
            if (isMounted) setFavoriteDriveUrls({});
          });
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
        const currency = report.globalCurrency;

        return report.data.entries
          .map((entry) => ({
            trip: report.trip,
            entry,
            currency,
            amount:
              memberShareForEntry(entry, member) *
              report.conversionRateToGlobal,
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

  useEffect(() => {
    if (!isLedgerSearchActive) return;

    document.body.classList.add("otr-mobile-search-active");

    return () => {
      document.body.classList.remove("otr-mobile-search-active");
    };
  }, [isLedgerSearchActive]);

  function openLedgerSearch() {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setIsLedgerSearchActive(true);
    }
  }

  function openLedgerSearchFromPointer(event: PointerEvent<HTMLInputElement>) {
    if (
      !window.matchMedia("(max-width: 767px)").matches ||
      isLedgerSearchActive
    ) {
      return;
    }
    event.preventDefault();
    flushSync(() => setIsLedgerSearchActive(true));
    ledgerSearchInputRef.current?.focus({ preventScroll: true });
  }

  function closeLedgerSearch() {
    setIsLedgerSearchActive(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function togglePanel(panel: ProfilePanel) {
    setExpandedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

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
        globalBaseCurrency,
        avatarUrl: profile?.avatarUrl ?? null,
      });
      setProfile(updated);
      setDisplayName(updated.displayName);
      setGlobalAka(updated.globalAka ?? "");
      setGlobalBaseCurrency(updated.globalBaseCurrency || "NZD");
      setNotice("Profile saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save profile."));
    } finally {
      setIsSaving(false);
    }
  }

  const basicOpen = expandedPanels.basic;
  const ledgerOpen = expandedPanels.ledger || isLedgerSearchActive;
  const favoritesOpen = expandedPanels.favorites;
  const friendsOpen = expandedPanels.friends;
  const accountOpen = expandedPanels.account;

  return (
    <div className={isLedgerSearchActive ? "space-y-0 md:space-y-6" : "space-y-6"}>
      <section className={isLedgerSearchActive ? "hidden md:block" : undefined}>
        <p className="text-sm font-semibold text-emerald-700">Profile</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {profile?.displayName ?? "Your profile"}
        </h1>
        <p className="mt-2 text-sm text-stone-500">{user.email}</p>
      </section>

      <section
        className={`rounded-3xl bg-white p-5 shadow-sm ${
          isLedgerSearchActive ? "hidden md:block" : ""
        }`}
      >
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

      <section
        className={`space-y-4 rounded-3xl bg-white p-5 shadow-sm ${
          isLedgerSearchActive ? "hidden md:block" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => togglePanel("basic")}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-xl font-semibold">Basic fields</span>
            <span className="mt-1 block text-sm text-stone-500">
              全局 AKA、基准货币和账户级别。
            </span>
          </span>
          <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-black text-stone-600">
            {basicOpen ? "收起" : "展开"}
          </span>
        </button>
        {basicOpen ? (
          <>
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
            <CurrencyCombobox
              value={globalBaseCurrency}
              onChange={setGlobalBaseCurrency}
              label="全局账本基准货币"
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
          </>
        ) : null}
      </section>

      <section
        className={
          isLedgerSearchActive
            ? "contents md:block md:space-y-4 md:rounded-3xl md:bg-white md:p-5 md:shadow-sm"
            : "space-y-4 rounded-3xl bg-white p-5 shadow-sm"
        }
      >
        <div
          className={`flex items-start justify-between gap-3 ${
            isLedgerSearchActive ? "hidden md:flex" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => togglePanel("ledger")}
            className="min-w-0 text-left"
          >
            <p className="text-sm font-bold text-emerald-800">
              {t("profile.ledger.eyebrow")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-stone-950">
              {t("profile.ledger.title")}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {t("profile.ledger.description")}
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!ledgerOpen) {
                togglePanel("ledger");
                return;
              }
              setLedgerUnlocked((current) => !current);
            }}
            className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-700"
          >
            {ledgerOpen ? (ledgerUnlocked ? "锁定" : "解锁") : "展开"}
          </button>
        </div>

        {ledgerOpen ? !ledgerUnlocked ? (
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
            <div
              className={`${
                isLedgerSearchActive
                  ? "fixed inset-x-0 top-0 z-[2147482600] flex items-center gap-2 border-b border-stone-200 bg-white p-3 shadow-lg md:static md:block md:rounded-2xl md:border-0 md:bg-stone-50 md:p-2 md:shadow-none"
                  : "rounded-2xl bg-stone-50 p-2"
              }`}
            >
              <input
                ref={ledgerSearchInputRef}
                type="search"
                enterKeyHint="search"
                inputMode="search"
                autoComplete="off"
                value={ledgerSearchQuery}
                onChange={(event) => setLedgerSearchQuery(event.target.value)}
                onPointerDown={openLedgerSearchFromPointer}
                onFocus={openLedgerSearch}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.currentTarget.blur();
                  }
                }}
                placeholder="搜索所有旅程费用..."
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-base font-semibold outline-none focus:border-emerald-300 md:min-h-10 md:w-full md:text-sm"
              />
              {ledgerSearchQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => setLedgerSearchQuery("")}
                  className="shrink-0 rounded-full bg-white px-3 py-2 text-xs font-bold text-stone-600 shadow-sm md:hidden"
                >
                  清空搜索
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeLedgerSearch}
                className="shrink-0 rounded-full px-3 py-2 text-sm font-black text-emerald-800 md:hidden"
              >
                {t("common.cancel")}
              </button>
            </div>

            {isLedgerSearchActive ? <div className="h-12 md:hidden" /> : null}

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
            ) : isLedgerSearchActive ? (
              <p className="rounded-2xl border border-dashed border-stone-200 bg-white p-4 text-sm text-stone-500">
                输入关键词搜索所有旅程里分摊到你身上的费用。
              </p>
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
        ) : null}
      </section>

      <section
        className={`space-y-4 rounded-3xl bg-white p-5 shadow-sm ${
          isLedgerSearchActive ? "hidden md:block" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => togglePanel("favorites")}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <span>
            <p className="text-sm font-bold text-emerald-800">Favorites</p>
            <h2 className="mt-1 text-xl font-semibold text-stone-950">
              我的收藏
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              跨旅程保存的照片和文字记忆。
            </p>
          </span>
          <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
            {favoritesOpen ? "收起" : `${favoriteMemories.length} 条`}
          </span>
        </button>
        {favoritesOpen ? (
          favoriteMemories.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
              还没有收藏的记忆。
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {favoriteMemories.map((memory) => (
                <button
                  key={memory.id}
                  type="button"
                  onClick={() => setSelectedFavorite(memory)}
                  className="group relative aspect-square overflow-hidden rounded-2xl border border-stone-100 bg-emerald-50 text-left shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                >
                  {memory.type === "photo" && memory.mediaUrl ? (
                    favoriteImageUrls[memory.mediaUrl] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={favoriteImageUrls[memory.mediaUrl]}
                        alt={memory.content || "Favorite memory"}
                        className="size-full object-cover transition duration-200 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="grid size-full place-items-center bg-stone-100 text-3xl">
                        IMG
                      </div>
                    )
                  ) : (
                    <div className="flex size-full flex-col justify-between p-3">
                      <p className="line-clamp-5 text-sm font-semibold leading-5 text-stone-800">
                        {memory.content || "Memory"}
                      </p>
                      <span className="text-xs font-black text-emerald-800">
                        TEXT
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-2 text-white">
                    <p className="truncate text-xs font-black">{memory.tripName}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-bold">
                      <span>
                        {formatShortDate(memory.capturedAt, locale)} ·{" "}
                        {memory.favoriteCount ?? 0} 收藏
                      </span>
                      <span>{memory.likeCount ?? 0} 赞</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : null}
      </section>

      {selectedFavorite ? (
        <div className="fixed inset-0 z-[1200] flex items-end bg-black/50 p-3 sm:items-center sm:justify-center">
          <div className="max-h-[88vh] w-full overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-w-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-emerald-800">
                  {selectedFavorite.tripName}
                </p>
                <h3 className="mt-1 truncate text-xl font-black text-stone-950">
                  {selectedFavorite.content ||
                    (selectedFavorite.type === "photo" ? "Photo memory" : "Memory")}
                </h3>
                <p className="mt-1 truncate text-xs font-semibold text-stone-500">
                  {new Date(selectedFavorite.capturedAt).toLocaleString(
                    locale === "zh-CN" ? "zh-CN" : "en",
                  )}
                  {selectedFavorite.locationName
                    ? ` · ${selectedFavorite.locationName}`
                    : selectedFavorite.tripDestination
                      ? ` · ${selectedFavorite.tripDestination}`
                      : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {selectedFavorite.type === "photo" &&
                (favoriteDriveUrls[selectedFavorite.id] ||
                  (selectedFavorite.mediaUrl
                    ? favoriteImageUrls[selectedFavorite.mediaUrl]
                    : "")) ? (
                  <a
                    href={
                      favoriteDriveUrls[selectedFavorite.id] ||
                      (selectedFavorite.mediaUrl
                        ? favoriteImageUrls[selectedFavorite.mediaUrl]
                        : "")
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
                  >
                    {favoriteDriveUrls[selectedFavorite.id]
                      ? "云盘下载"
                      : "下载图片"}
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedFavorite(null)}
                  className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-700"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4">
              {selectedFavorite.type === "photo" &&
              selectedFavorite.mediaUrl &&
              favoriteImageUrls[selectedFavorite.mediaUrl] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={favoriteImageUrls[selectedFavorite.mediaUrl]}
                  alt={selectedFavorite.content || "Favorite memory"}
                  className="max-h-[62vh] w-full rounded-2xl object-contain"
                />
              ) : null}
              {selectedFavorite.content ? (
                <p className="mt-4 whitespace-pre-wrap rounded-2xl bg-stone-50 p-4 text-base leading-7 text-stone-800 first:mt-0">
                  {selectedFavorite.content}
                </p>
              ) : selectedFavorite.type === "photo" ? (
                <p className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">
                  这是一条照片记忆。
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-black text-stone-600">
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">
                  {selectedFavorite.likeCount ?? 0} 赞
                </span>
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">
                  {selectedFavorite.favoriteCount ?? 0} 人收藏
                </span>
                {selectedFavorite.locationName ? (
                  <span className="max-w-full truncate rounded-full bg-stone-100 px-3 py-1.5">
                    {selectedFavorite.locationName}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section
        className={`space-y-4 rounded-3xl bg-white p-5 shadow-sm ${
          isLedgerSearchActive ? "hidden md:block" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => togglePanel("friends")}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <span>
            <p className="text-sm font-bold text-emerald-800">Friends</p>
            <h2 className="mt-1 text-xl font-semibold text-stone-950">
              我的朋友
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              按共同组队次数排序。
            </p>
          </span>
          <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
            {friendsOpen ? "收起" : `${friends.length} 位`}
          </span>
        </button>
        {friendsOpen ? (
          friends.length === 0 ? (
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
          )
        ) : null}
      </section>

      <section
        className={`space-y-4 rounded-3xl bg-white p-5 shadow-sm ${
          isLedgerSearchActive ? "hidden md:block" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => togglePanel("account")}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm font-bold text-emerald-800">
              Account
            </span>
            <span className="mt-1 block text-xl font-semibold text-stone-950">
              账户操作
            </span>
          </span>
          <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-black text-stone-600">
            {accountOpen ? "收起" : "展开"}
          </span>
        </button>
        {accountOpen ? (
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
          >
            Logout
          </button>
        ) : null}
      </section>
    </div>
  );
}

export default function ProfilePage() {
  return <AuthGate>{(user) => <ProfileContent user={user} />}</AuthGate>;
}
