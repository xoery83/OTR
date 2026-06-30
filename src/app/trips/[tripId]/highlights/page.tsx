"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { TranslatedText } from "@/components/TranslatedText";
import { useJourneyCachedResource } from "@/hooks/useJourneyCachedResource";
import {
  journeyResourceKey,
  loadJourneyHighlightsResource,
} from "@/lib/journey-resources";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { PlannerV2Data } from "@/lib/supabase/planner-v2";
import {
  getSignedMemoryImageUrls,
} from "@/lib/supabase/memories";
import type {
  ItineraryEventType,
  ItineraryItemRatingSummary,
  ItineraryReservationType,
  JourneyMember,
  LedgerCategory,
  LedgerEntry,
  LedgerMemberBalance,
  MemoryEntry,
  Trip,
} from "@/types";
import { getErrorMessage } from "@/lib/errors";

type BestItem = {
  id: string;
  itemId: string;
  date: string;
  title: string;
  subtitle: string;
  type: ItineraryEventType | ItineraryReservationType;
  sourceKind: "event" | "reservation";
  rating: ItineraryItemRatingSummary;
};

type HighlightTab =
  | "spending"
  | "contribution"
  | "likes"
  | "favorites"
  | "journey";

type ContributionRankItem = {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  count: number;
  href: string;
};

const typeLabelKeys: Record<string, TranslationKey> = {
  flight: "highlights.type.flight",
  hotel: "highlights.type.hotel",
  car: "highlights.type.car",
  activity: "highlights.type.activity",
  shopping: "highlights.type.shopping",
  meal: "highlights.type.meal",
  transport: "highlights.type.transport",
  note: "highlights.type.note",
  ferry: "highlights.type.ferry",
  tour: "highlights.type.tour",
  restaurant: "highlights.type.restaurant",
  other: "highlights.type.other",
};

const ledgerCategoryLabelKeys: Record<LedgerCategory, TranslationKey> = {
  flight: "highlights.ledgerCategory.flight",
  hotel: "highlights.ledgerCategory.hotel",
  car: "highlights.ledgerCategory.car",
  fuel: "highlights.ledgerCategory.fuel",
  food: "highlights.ledgerCategory.food",
  ticket: "highlights.ledgerCategory.ticket",
  shopping: "highlights.ledgerCategory.shopping",
  transport: "highlights.ledgerCategory.transport",
  insurance: "highlights.ledgerCategory.insurance",
  other: "highlights.ledgerCategory.other",
};

const ledgerCategoryOrder: LedgerCategory[] = [
  "hotel",
  "flight",
  "car",
  "transport",
  "fuel",
  "food",
  "ticket",
  "shopping",
  "insurance",
  "other",
];

function dateLabel(value: string, locale: string) {
  if (value === "unscheduled") return locale === "zh-CN" ? "未安排" : "Unscheduled";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function money(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function dateTimeLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ratedItems(planner: PlannerV2Data): BestItem[] {
  const byId = new Map<string, BestItem>();

  planner.days.forEach((day) => {
    day.activities.forEach((item) => {
      const rating = item.ratingSummary;
      if (!rating?.ratingCount) return;
      const key = `event:${item.id}`;
      if (byId.has(key)) return;
      byId.set(key, {
        id: key,
        itemId: `activity-${item.id}`,
        date: day.day.dayDate,
        title: item.title,
        subtitle: item.locationName || item.description || "",
        type: item.eventType,
        sourceKind: "event",
        rating,
      });
    });

    day.reservations.forEach((item) => {
      const rating = item.ratingSummary;
      if (!rating?.ratingCount) return;
      const key = `reservation:${item.id}`;
      if (byId.has(key)) return;
      byId.set(key, {
        id: key,
        itemId: `reservation-${item.id}`,
        date: day.day.dayDate,
        title: item.title,
        subtitle: item.locationName || item.provider || item.sourceText || "",
        type: item.reservationType,
        sourceKind: "reservation",
        rating,
      });
    });
  });

  return [...byId.values()].sort((first, second) => {
    const ratingOrder =
      (second.rating.averageRating ?? 0) - (first.rating.averageRating ?? 0);
    if (ratingOrder) return ratingOrder;
    const countOrder = second.rating.ratingCount - first.rating.ratingCount;
    if (countOrder) return countOrder;
    return first.date.localeCompare(second.date);
  });
}

function mostExpensiveEntriesByCategory(entries: LedgerEntry[]) {
  const byCategory = new Map<LedgerCategory, LedgerEntry>();

  entries.forEach((entry) => {
    const current = byCategory.get(entry.category);
    if (!current || entry.baseAmount > current.baseAmount) {
      byCategory.set(entry.category, entry);
    }
  });

  return ledgerCategoryOrder
    .map((category) => ({
      category,
      entry: byCategory.get(category) ?? null,
    }))
    .filter((item): item is { category: LedgerCategory; entry: LedgerEntry } =>
      Boolean(item.entry),
    );
}

function topBalanceBy(
  balances: LedgerMemberBalance[],
  getAmount: (balance: LedgerMemberBalance) => number,
) {
  return balances
    .map((balance) => ({
      balance,
      amount: getAmount(balance),
    }))
    .filter((item) => item.amount > 0)
    .sort((first, second) => second.amount - first.amount)[0] ?? null;
}

function topCount<T>(
  values: T[],
  getCount: (value: T) => number,
) {
  return values
    .map((value) => ({
      value,
      count: getCount(value),
    }))
    .filter((item) => item.count > 0)
    .sort((first, second) => second.count - first.count)[0] ?? null;
}

function memberLabel(member: JourneyMember | null | undefined) {
  return member?.displayName || "Traveler";
}

function rankedMemoriesBy(
  memories: MemoryEntry[],
  getCount: (memory: MemoryEntry) => number,
) {
  return [...memories]
    .filter((memory) => getCount(memory) > 0)
    .sort((first, second) => {
      const countOrder = getCount(second) - getCount(first);
      if (countOrder) return countOrder;
      return (
        new Date(second.capturedAt).getTime() -
        new Date(first.capturedAt).getTime()
      );
    });
}

function HighlightsContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const { locale, t } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [planner, setPlanner] = useState<PlannerV2Data>({ days: [] });
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerBalances, setLedgerBalances] = useState<LedgerMemberBalance[]>([]);
  const [ledgerCurrency, setLedgerCurrency] = useState("NZD");
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [imageUploadCounts, setImageUploadCounts] = useState<Record<string, number>>({});
  const [faceTagCounts, setFaceTagCounts] = useState<Record<string, number>>({});
  const [ratingCounts, setRatingCounts] = useState<Record<string, number>>({});
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoryImageUrls, setMemoryImageUrls] = useState<Record<string, string>>({});
  const [selectedMemory, setSelectedMemory] = useState<MemoryEntry | null>(null);
  const [activeTab, setActiveTab] = useState<HighlightTab>("spending");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const highlightsResource = useJourneyCachedResource({
    cacheKey: journeyResourceKey.highlights(tripId),
    loader: () => loadJourneyHighlightsResource(tripId),
    ttl: 2 * 60_000,
    staleTime: 30_000,
    keepPreviousData: true,
    backgroundRefresh: true,
  });

  useEffect(() => {
    const data = highlightsResource.data;
    if (!data) return;
    setTrip(data.tripData);
    setPlanner(data.plannerData);
    setLedgerEntries(data.ledgerData.entries);
    setLedgerBalances(data.ledgerData.summary.balances);
    setLedgerCurrency(data.ledgerData.ledger.baseCurrency);
    setMembers(data.journeyMembers);
    setImageUploadCounts(data.imageCounts);
    setFaceTagCounts(data.faceCounts);
    setRatingCounts(data.ratingCountsByUser);
    setMemories(data.memoryData);
    setIsLoading(false);
    setError(null);

    let cancelled = false;
    getSignedMemoryImageUrls(data.memoryData)
      .then((signedImageUrls) => {
        if (!cancelled) setMemoryImageUrls(signedImageUrls);
      })
      .catch(() => {
        if (!cancelled) setMemoryImageUrls({});
      });
    return () => {
      cancelled = true;
    };
  }, [highlightsResource.data]);

  useEffect(() => {
    if (!highlightsResource.error || highlightsResource.data) return;
    setError(getErrorMessage(highlightsResource.error, "Could not load highlights."));
    setIsLoading(false);
  }, [highlightsResource.data, highlightsResource.error]);

  const bestItems = useMemo(() => ratedItems(planner), [planner]);
  const bestByType = useMemo(() => {
    const grouped = new Map<string, BestItem[]>();
    bestItems.forEach((item) => {
      grouped.set(item.type, [...(grouped.get(item.type) ?? []), item]);
    });
    return [...grouped.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [bestItems]);
  const expensiveByCategory = useMemo(
    () => mostExpensiveEntriesByCategory(ledgerEntries),
    [ledgerEntries],
  );
  const topConsumer = useMemo(
    () =>
      topBalanceBy(
        ledgerBalances,
        (balance) => balance.owedTotal + balance.statsOnlyTotal,
      ),
    [ledgerBalances],
  );
  const topPayer = useMemo(
    () => topBalanceBy(ledgerBalances, (balance) => balance.paidTotal),
    [ledgerBalances],
  );
  const spendingRankCount =
    expensiveByCategory.length + (topConsumer ? 1 : 0) + (topPayer ? 1 : 0);
  const contributionItems = useMemo<ContributionRankItem[]>(() => {
    const membersByUserId = new Map(
      members
        .filter((member) => Boolean(member.userId))
        .map((member) => [member.userId as string, member]),
    );
    const membersById = new Map(members.map((member) => [member.id, member]));

    const itineraryCreatedCounts: Record<string, number> = {};
    planner.days.forEach((day) => {
      [...day.activities, ...day.reservations].forEach((item) => {
        if (item.createdBy) {
          itineraryCreatedCounts[item.createdBy] =
            (itineraryCreatedCounts[item.createdBy] ?? 0) + 1;
        }
      });
    });

    const memoryCounts: Record<string, number> = {};
    const seenMemories = new Set<string>();
    planner.days.forEach((day) => {
      day.memories.forEach((memory) => {
        if (!memory.userId || seenMemories.has(memory.id)) return;
        seenMemories.add(memory.id);
        memoryCounts[memory.userId] = (memoryCounts[memory.userId] ?? 0) + 1;
      });
    });

    const topItineraryCreator = topCount(members, (member) =>
      member.userId ? itineraryCreatedCounts[member.userId] ?? 0 : 0,
    );
    const topMemoryUploader = topCount(members, (member) =>
      member.userId ? memoryCounts[member.userId] ?? 0 : 0,
    );
    const topImageUploader = topCount(members, (member) =>
      member.userId ? imageUploadCounts[member.userId] ?? 0 : 0,
    );
    const topFaceTagged = topCount(members, (member) => faceTagCounts[member.id] ?? 0);
    const topRater = topCount(members, (member) =>
      member.userId ? ratingCounts[member.userId] ?? 0 : 0,
    );

    return [
      topItineraryCreator
        ? {
            id: "itinerary-created",
            label: t("highlights.contribution.itinerary"),
            title: memberLabel(membersByUserId.get(topItineraryCreator.value.userId ?? "")),
            subtitle: t("highlights.contribution.itinerarySubtitle"),
            count: topItineraryCreator.count,
            href: `/trips/${tripId}/planner`,
          }
        : null,
      topMemoryUploader
        ? {
            id: "memory-uploaded",
            label: t("highlights.contribution.memory"),
            title: memberLabel(membersByUserId.get(topMemoryUploader.value.userId ?? "")),
            subtitle: t("highlights.contribution.memorySubtitle"),
            count: topMemoryUploader.count,
            href: `/trips/${tripId}/timeline`,
          }
        : null,
      topImageUploader
        ? {
            id: "image-uploaded",
            label: t("highlights.contribution.image"),
            title: memberLabel(membersByUserId.get(topImageUploader.value.userId ?? "")),
            subtitle: t("highlights.contribution.imageSubtitle"),
            count: topImageUploader.count,
            href: `/trips/${tripId}/timeline`,
          }
        : null,
      topFaceTagged
        ? {
            id: "face-tagged",
            label: t("highlights.contribution.face"),
            title: memberLabel(membersById.get(topFaceTagged.value.id)),
            subtitle: t("highlights.contribution.faceSubtitle"),
            count: topFaceTagged.count,
            href: `/trips/${tripId}/people`,
          }
        : null,
      topRater
        ? {
            id: "rating-created",
            label: t("highlights.contribution.rating"),
            title: memberLabel(membersByUserId.get(topRater.value.userId ?? "")),
            subtitle: t("highlights.contribution.ratingSubtitle"),
            count: topRater.count,
            href: `/trips/${tripId}/highlights`,
          }
        : null,
    ].filter((item): item is ContributionRankItem => Boolean(item));
  }, [
    faceTagCounts,
    imageUploadCounts,
    members,
    planner.days,
    ratingCounts,
    t,
    tripId,
  ]);
  const likedMemories = useMemo(
    () => rankedMemoriesBy(memories, (memory) => memory.likeCount ?? 0),
    [memories],
  );
  const favoritedMemories = useMemo(
    () => rankedMemoriesBy(memories, (memory) => memory.favoriteCount ?? 0),
    [memories],
  );
  const activeMemoryRank =
    activeTab === "likes"
      ? likedMemories
      : activeTab === "favorites"
        ? favoritedMemories
        : [];
  const activeMemoryRankLabel =
    activeTab === "likes" ? t("highlights.tab.likes") : t("highlights.tab.favorites");

  if (isLoading && !highlightsResource.data) {
    return (
      <div className="space-y-3 rounded-2xl bg-white p-5">
        <div className="h-5 w-32 animate-pulse rounded bg-stone-200" />
        <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
        <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {highlightsResource.error && highlightsResource.data ? (
        <p className="rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
          {t("highlights.refreshFailed")}
        </p>
      ) : null}
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name ? (
            <TranslatedText
              as="span"
              showToggle={false}
              sourceField="name"
              sourceId={trip.id}
              sourceType="trip"
              text={trip.name}
            />
          ) : (
            t("common.journey")
          )}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {t("highlights.title")}
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          {t("highlights.description")}
        </p>
      </section>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-emerald-800">
              {t("highlights.eyebrow")}
            </p>
            <h2 className="text-xl font-semibold text-stone-950">
              {t("highlights.rankings")}
            </h2>
          </div>
          <div className="grid grid-cols-5 rounded-full bg-stone-100 p-1 text-xs font-black text-stone-600">
            {(
              [
                ["spending", t("highlights.tabWithCount", { label: t("highlights.tab.spending"), count: spendingRankCount })],
                ["contribution", t("highlights.tabWithCount", { label: t("highlights.tab.contribution"), count: contributionItems.length })],
                ["likes", t("highlights.tabWithCount", { label: t("highlights.tab.likes"), count: likedMemories.length })],
                ["favorites", t("highlights.tabWithCount", { label: t("highlights.tab.favorites"), count: favoritedMemories.length })],
                ["journey", t("highlights.tabWithCount", { label: t("highlights.tab.journey"), count: bestItems.length })],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value)}
                className={`rounded-full px-3 py-1.5 transition ${
                  activeTab === value
                    ? "bg-white text-emerald-900 shadow-sm"
                    : "text-stone-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "spending" && spendingRankCount === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            {t("highlights.empty.spending")}
          </div>
        ) : null}

        {activeTab === "spending" && spendingRankCount > 0 ? (
          <div className="mt-4 space-y-2">
            {[
              topConsumer
                ? {
                    id: "top-consumer",
                    label: t("highlights.label.topConsumer"),
                    title: topConsumer.balance.member.displayName,
                    subtitle: t("highlights.subtitle.topConsumer", {
                      shared: money(
                      topConsumer.balance.owedTotal,
                      ledgerCurrency,
                      locale,
                      ),
                      personal: money(
                      topConsumer.balance.statsOnlyTotal,
                      ledgerCurrency,
                      locale,
                      ),
                    }),
                    amount: topConsumer.amount,
                    href: `/trips/${tripId}/ledger?view=people`,
                  }
                : null,
              topPayer
                ? {
                    id: "top-payer",
                    label: t("highlights.label.topPayer"),
                    title: topPayer.balance.member.displayName,
                    subtitle: t("highlights.subtitle.topPayer", {
                      amount: money(topPayer.balance.paidTotal, ledgerCurrency, locale),
                    }),
                    amount: topPayer.amount,
                    href: `/trips/${tripId}/ledger?view=people`,
                  }
                : null,
            ]
              .filter(
                (item): item is {
                  id: string;
                  label: string;
                  title: string;
                  subtitle: string;
                  amount: number;
                  href: string;
                } => Boolean(item),
              )
              .map((item, index) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-stone-200 bg-[#fffdf8] p-3 transition hover:border-emerald-200 hover:bg-emerald-50/40"
                >
                  <span className="grid size-8 place-items-center rounded-full bg-stone-100 text-sm font-black text-stone-700">
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-black uppercase tracking-wide text-emerald-800">
                      {item.label}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-semibold text-stone-950">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-stone-500">
                      {item.subtitle}
                    </span>
                  </span>
                  <span className="self-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                    {money(item.amount, ledgerCurrency, locale)}
                  </span>
                </Link>
              ))}
            {expensiveByCategory.map(({ category, entry }, index) => (
              <Link
                key={category}
                href={`/trips/${tripId}/ledger?view=expenses&q=${encodeURIComponent(
                  entry.title,
                )}`}
                className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-stone-200 bg-[#fffdf8] p-3 transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <span className="grid size-8 place-items-center rounded-full bg-stone-100 text-sm font-black text-stone-700">
                  {index + 1 + (topConsumer ? 1 : 0) + (topPayer ? 1 : 0)}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-black uppercase tracking-wide text-emerald-800">
                    {t("highlights.label.mostExpensiveCategory", {
                      category: t(ledgerCategoryLabelKeys[category]),
                    })} ·{" "}
                    {dateLabel(entry.expenseDate, locale)}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold text-stone-950">
                    <TranslatedText
                      as="span"
                      className="block truncate"
                      protectedEntities={[entry.originalCurrency, ledgerCurrency]}
                      showToggle={false}
                      sourceField="title"
                      sourceId={entry.id}
                      sourceType="expense"
                      text={entry.title}
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-stone-500">
                    {t("highlights.originalAmount", {
                      amount: money(entry.originalAmount, entry.originalCurrency, locale),
                    })}
                  </span>
                </span>
                <span className="self-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                  {money(entry.baseAmount, ledgerCurrency, locale)}
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {activeTab === "contribution" && contributionItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            {t("highlights.empty.contribution")}
          </div>
        ) : null}

        {activeTab === "contribution" && contributionItems.length > 0 ? (
          <div className="mt-4 space-y-2">
            {contributionItems.map((item, index) => (
              <Link
                key={item.id}
                href={item.href}
                className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-stone-200 bg-[#fffdf8] p-3 transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <span className="grid size-8 place-items-center rounded-full bg-stone-100 text-sm font-black text-stone-700">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-black uppercase tracking-wide text-emerald-800">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold text-stone-950">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-stone-500">
                    {item.subtitle}
                  </span>
                </span>
                <span className="self-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                  {t("highlights.countTimes", { count: item.count })}
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {(activeTab === "likes" || activeTab === "favorites") &&
        activeMemoryRank.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            {t("highlights.empty.memoryRank", { label: activeMemoryRankLabel })}
          </div>
        ) : null}

        {(activeTab === "likes" || activeTab === "favorites") &&
        activeMemoryRank.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
            {activeMemoryRank.map((memory, index) => {
              const imageUrl = memory.mediaUrl ? memoryImageUrls[memory.mediaUrl] : null;
              const count =
                activeTab === "likes"
                  ? memory.likeCount ?? 0
                  : memory.favoriteCount ?? 0;

              return (
                <button
                  type="button"
                  key={memory.id}
                  onClick={() => setSelectedMemory(memory)}
                  className="group relative aspect-square overflow-hidden bg-stone-100 text-left"
                >
                  {memory.type === "photo" && imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={memory.content || "Memory"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full flex-col justify-between bg-[#fffdf8] p-3">
                      <span className="line-clamp-5 text-sm font-semibold leading-5 text-stone-950">
                        {memory.content ? (
                          <TranslatedText
                            as="span"
                            showToggle={false}
                            sourceField="content"
                            sourceId={memory.id}
                            sourceType="memory"
                            text={memory.content}
                          />
                        ) : memory.locationName ? (
                          <TranslatedText
                            as="span"
                            showToggle={false}
                            sourceField="location_name"
                            sourceId={memory.id}
                            sourceType="memory"
                            text={memory.locationName}
                          />
                        ) : (
                          t("highlights.memory")
                        )}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wide text-emerald-800">
                        {t("highlights.text")}
                      </span>
                    </span>
                  )}
                  <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-white/90 text-xs font-black text-stone-800 shadow-sm">
                    {index + 1}
                  </span>
                  <span className="absolute right-2 top-2 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-950 shadow-sm">
                    {count}
                  </span>
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950/80 to-transparent p-2 text-white opacity-0 transition group-hover:opacity-100">
                    <span className="line-clamp-2 text-xs font-bold">
                      {memory.content ? (
                        <TranslatedText
                          as="span"
                          showToggle={false}
                          sourceField="content"
                          sourceId={memory.id}
                          sourceType="memory"
                          text={memory.content}
                        />
                      ) : memory.locationName ? (
                        <TranslatedText
                          as="span"
                          showToggle={false}
                          sourceField="location_name"
                          sourceId={memory.id}
                          sourceType="memory"
                          text={memory.locationName}
                        />
                      ) : (
                        dateTimeLabel(memory.capturedAt, locale)
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {activeTab === "journey" && bestItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            {t("highlights.empty.journey")}
          </div>
        ) : null}

        {activeTab === "journey" && bestItems.length > 0 ? (
          <div className="mt-4 space-y-5">
            {bestByType.map(([type, items]) => (
              <div key={type}>
                <h3 className="text-sm font-black text-stone-900">
                  {t("highlights.bestType", {
                    type: typeLabelKeys[type] ? t(typeLabelKeys[type]) : type,
                  })}
                </h3>
                <div className="mt-2 space-y-2">
                  {items.slice(0, 5).map((item, index) => (
                    <Link
                      key={item.id}
                      href={`/trips/${tripId}/planner?date=${item.date}&item=${item.itemId}`}
                      className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border border-stone-200 bg-[#fffdf8] p-3 transition hover:border-emerald-200 hover:bg-emerald-50/40"
                    >
                      <span className="grid size-8 place-items-center rounded-full bg-stone-100 text-sm font-black text-stone-700">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-black uppercase tracking-wide text-emerald-800">
                          {dateLabel(item.date, locale)} ·{" "}
                          {typeLabelKeys[item.type]
                            ? t(typeLabelKeys[item.type])
                            : item.type}
                        </span>
                        <span className="mt-0.5 block truncate text-sm font-semibold text-stone-950">
                          <TranslatedText
                            as="span"
                            className="block truncate"
                            showToggle={false}
                            sourceField="title"
                            sourceId={item.itemId}
                            sourceType="plan_item"
                            text={item.title}
                          />
                        </span>
                        {item.subtitle ? (
                          <span className="mt-0.5 block truncate text-xs text-stone-500">
                            <TranslatedText
                              as="span"
                              className="block truncate"
                              showToggle={false}
                              sourceField="subtitle"
                              sourceId={item.itemId}
                              sourceType="plan_item"
                              text={item.subtitle}
                            />
                          </span>
                        ) : null}
                      </span>
                      <span className="self-center rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">
                        {item.rating.averageRating?.toFixed(1) ?? "0.0"} ·{" "}
                        {t("highlights.peopleCount", {
                          count: item.rating.ratingCount,
                        })}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {selectedMemory ? (
        <div
          className="fixed inset-0 z-[2147482400] bg-stone-950/80 p-4 backdrop-blur-sm"
          onClick={() => setSelectedMemory(null)}
        >
          <div
            className="mx-auto flex h-full max-w-5xl flex-col gap-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-black">
                  {selectedMemory.contributorName || "Traveler"}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-white/65">
                  {dateTimeLabel(selectedMemory.capturedAt, locale)}
                  {selectedMemory.locationName ? (
                    <>
                      {" · "}
                      <TranslatedText
                        as="span"
                        showToggle={false}
                        sourceField="location_name"
                        sourceId={selectedMemory.id}
                        sourceType="memory"
                        text={selectedMemory.locationName}
                      />
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMemory(null)}
                className="rounded-full bg-white/15 px-3 py-2 text-xs font-black text-white"
              >
                {t("common.close")}
              </button>
            </div>

            <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-3xl bg-white">
              {selectedMemory.type === "photo" &&
              selectedMemory.mediaUrl &&
              memoryImageUrls[selectedMemory.mediaUrl] ? (
                <div className="grid h-full w-full min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="grid min-h-0 place-items-center bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={memoryImageUrls[selectedMemory.mediaUrl]}
                      alt={selectedMemory.content || "Memory"}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <aside className="min-h-0 overflow-y-auto p-4">
                  <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                    {t("highlights.photoMemory")}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                    {selectedMemory.content ? (
                      <TranslatedText
                        as="span"
                        showToggle={false}
                        sourceField="content"
                        sourceId={selectedMemory.id}
                        sourceType="memory"
                        text={selectedMemory.content}
                      />
                    ) : (
                      t("highlights.noCaption")
                    )}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-black text-stone-600">
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      {t("highlights.likeCount", {
                        count: selectedMemory.likeCount ?? 0,
                      })}
                    </span>
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      {t("highlights.favoriteCount", {
                        count: selectedMemory.favoriteCount ?? 0,
                      })}
                    </span>
                  </div>
                  </aside>
                </div>
              ) : (
                <article className="max-h-full w-full overflow-y-auto p-6">
                  <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                    {t("highlights.textMemory")}
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold text-stone-950">
                    {selectedMemory.locationName ? (
                      <TranslatedText
                        as="span"
                        showToggle={false}
                        sourceField="location_name"
                        sourceId={selectedMemory.id}
                        sourceType="memory"
                        text={selectedMemory.locationName}
                      />
                    ) : (
                      t("highlights.fullText")
                    )}
                  </h3>
                  <p className="mt-4 whitespace-pre-wrap text-base leading-8 text-stone-700">
                    {selectedMemory.content ? (
                      <TranslatedText
                        as="span"
                        showToggle={false}
                        sourceField="content"
                        sourceId={selectedMemory.id}
                        sourceType="memory"
                        text={selectedMemory.content}
                      />
                    ) : (
                      t("highlights.noText")
                    )}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2 text-xs font-black text-stone-600">
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      {t("highlights.likeCount", {
                        count: selectedMemory.likeCount ?? 0,
                      })}
                    </span>
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      {t("highlights.favoriteCount", {
                        count: selectedMemory.favoriteCount ?? 0,
                      })}
                    </span>
                  </div>
                </article>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function HighlightsPage() {
  return <AuthGate>{() => <HighlightsContent />}</AuthGate>;
}
