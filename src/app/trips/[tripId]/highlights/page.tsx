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
import {
  getMediaAssetDisplayUrl,
  getMediaAssetLegacySignedUrlById,
  getMediaAssetPreviewUrl,
  getMediaAssetsByMemoryIds,
} from "@/lib/supabase/media-assets";
import { supabase } from "@/lib/supabase/client";
import type { MemoryShot } from "@/lib/memory-shots/types";
import type {
  ItineraryEventType,
  ItineraryItemRatingSummary,
  ItineraryReservationType,
  JourneyMember,
  LedgerCategory,
  LedgerEntry,
  LedgerMemberBalance,
  MemoryEntry,
  PhotoAssetWithMemory,
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

function memoryShotSections(memoryShot: MemoryShot) {
  const sections = memoryShot.content.sections;
  return Array.isArray(sections)
    ? sections.map((section) => String(section)).filter(Boolean).slice(0, 3)
    : [];
}

function memoryShotTemplateKey(memoryShot: MemoryShot) {
  const key = memoryShot.metadata.templateKey;
  return typeof key === "string" ? key : null;
}

function memoryShotErrorSummary(memoryShot: MemoryShot) {
  return memoryShot.errorMessage || "Generation failed. Please try again.";
}

function memoryShotPreviewSources(memoryShot: MemoryShot) {
  return [memoryShot.thumbnailUrl, memoryShot.previewUrl].filter(
    (value): value is string => Boolean(value),
  );
}

function sortMemoryShots(memoryShots: MemoryShot[]) {
  return [...memoryShots].sort((first, second) => {
    const firstTime = first.generatedAt ?? first.createdAt;
    const secondTime = second.generatedAt ?? second.createdAt;
    return new Date(secondTime).getTime() - new Date(firstTime).getTime();
  });
}

async function memoryShotAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("You must be logged in.");
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

function memoryShotApiError(
  payload: { error?: string; aiJobId?: string | null },
  fallback: string,
) {
  const message = payload.error || fallback;
  return payload.aiJobId ? `${message} AI job: ${payload.aiJobId}` : message;
}

const emptyPlanner: PlannerV2Data = { days: [] };
const emptyLedgerEntries: LedgerEntry[] = [];
const emptyLedgerBalances: LedgerMemberBalance[] = [];
const emptyMembers: JourneyMember[] = [];
const emptyCounts: Record<string, number> = {};
const emptyMemories: MemoryEntry[] = [];

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
  const [memoryImageUrls, setMemoryImageUrls] = useState<Record<string, string>>({});
  const [memoryImageUrlCandidates, setMemoryImageUrlCandidates] = useState<
    Record<string, string[]>
  >({});
  const [selectedMemory, setSelectedMemory] = useState<MemoryEntry | null>(null);
  const [memoryShots, setMemoryShots] = useState<MemoryShot[]>([]);
  const [isGeneratingMemoryShot, setIsGeneratingMemoryShot] = useState(false);
  const [memoryShotError, setMemoryShotError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HighlightTab>("spending");

  const highlightsResource = useJourneyCachedResource({
    cacheKey: journeyResourceKey.highlights(tripId),
    loader: () => loadJourneyHighlightsResource(tripId),
    ttl: 2 * 60_000,
    staleTime: 30_000,
    keepPreviousData: true,
    backgroundRefresh: true,
  });
  const highlightsData = highlightsResource.data;
  const trip: Trip | null = highlightsData?.tripData ?? null;
  const planner = highlightsData?.plannerData ?? emptyPlanner;
  const ledgerEntries = highlightsData?.ledgerData.entries ?? emptyLedgerEntries;
  const ledgerBalances =
    highlightsData?.ledgerData.summary.balances ?? emptyLedgerBalances;
  const ledgerCurrency = highlightsData?.ledgerData.ledger.baseCurrency ?? "NZD";
  const members = highlightsData?.journeyMembers ?? emptyMembers;
  const imageUploadCounts = highlightsData?.imageCounts ?? emptyCounts;
  const faceTagCounts = highlightsData?.faceCounts ?? emptyCounts;
  const ratingCounts = highlightsData?.ratingCountsByUser ?? emptyCounts;
  const memories = highlightsData?.memoryData ?? emptyMemories;
  const isLoading = !highlightsData && !highlightsResource.error;
  const error =
    !highlightsData && highlightsResource.error
      ? getErrorMessage(highlightsResource.error, "Could not load highlights.")
      : null;

  useEffect(() => {
    const data = highlightsData;
    if (!data) return;

    let cancelled = false;
    const photoMemories = data.memoryData.filter(
      (memory) => memory.type === "photo",
    );
    const photoMemoryIds = photoMemories.map((memory) => memory.id);

    Promise.all([
      getSignedMemoryImageUrls(data.memoryData),
      getMediaAssetsByMemoryIds(photoMemoryIds)
        .then(async (assets) => {
          const legacyUrlsByAssetId = await getMediaAssetLegacySignedUrlById(assets);
          return assets.reduce<Record<string, PhotoAssetWithMemory>>(
            (groups, asset) => {
              if (!asset.memoryEntryId) return groups;
              groups[asset.memoryEntryId] = {
                ...asset,
                memory:
                  photoMemories.find(
                    (memory) => memory.id === asset.memoryEntryId,
                  ) ?? null,
                displayUrl: getMediaAssetDisplayUrl(asset),
                displayPreviewUrl: getMediaAssetPreviewUrl(asset),
                displayFallbackUrl: legacyUrlsByAssetId[asset.id],
              };
              return groups;
            },
            {},
          );
        })
        .catch(() => ({}) as Record<string, PhotoAssetWithMemory>),
    ])
      .then(([signedImageUrls, assetsByMemoryId]) => {
        if (cancelled) return;
        setMemoryImageUrls(signedImageUrls);
        setMemoryImageUrlCandidates(
          photoMemories.reduce<Record<string, string[]>>((urls, memory) => {
            const asset = assetsByMemoryId[memory.id];
            const candidates = [
              asset?.displayPreviewUrl,
              asset?.displayUrl,
              memory.mediaUrl ? signedImageUrls[memory.mediaUrl] : null,
              asset?.displayFallbackUrl,
              asset ? `/api/media/assets/${asset.id}/thumbnail` : null,
              asset ? `/api/media/assets/${asset.id}/preview` : null,
            ].filter((value): value is string => Boolean(value));

            urls[memory.id] = [...new Set(candidates)];
            return urls;
          }, {}),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setMemoryImageUrls({});
          setMemoryImageUrlCandidates({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [highlightsData]);

  useEffect(() => {
    let cancelled = false;

    async function loadMemoryShots() {
      try {
        const response = await fetch(`/api/journeys/${tripId}/memory-shots`, {
          headers: await memoryShotAuthHeaders(),
        });
        const payload = (await response.json()) as {
          memoryShots?: MemoryShot[];
          error?: string;
        };
        if (!response.ok || !payload.memoryShots) {
          throw new Error(payload.error || "Could not load Memory Shots.");
        }
        if (!cancelled) {
          setMemoryShots(sortMemoryShots(payload.memoryShots));
          setMemoryShotError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setMemoryShotError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load Memory Shots.",
          );
        }
      }
    }

    loadMemoryShots();

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function generateDailyBestMoments() {
    if (isGeneratingMemoryShot || hasGeneratingDailyBestMoments) return;

    setIsGeneratingMemoryShot(true);
    setMemoryShotError(null);
    try {
      const response = await fetch(
        `/api/journeys/${tripId}/memory-shots/generate`,
        {
          method: "POST",
          headers: await memoryShotAuthHeaders(),
          body: JSON.stringify({
            templateKey: "memory_shot_daily_best_moments",
            language: locale,
          }),
        },
      );
      const payload = (await response.json()) as {
        memoryShot?: MemoryShot;
        error?: string;
        aiJobId?: string | null;
      };
      if (!response.ok || !payload.memoryShot) {
        throw new Error(
          memoryShotApiError(payload, "Could not generate Memory Shot."),
        );
      }
      setMemoryShots((current) =>
        sortMemoryShots([
          payload.memoryShot as MemoryShot,
          ...current.filter((item) => item.id !== payload.memoryShot?.id),
        ]),
      );
    } catch (generateError) {
      setMemoryShotError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate Memory Shot.",
      );
    } finally {
      setIsGeneratingMemoryShot(false);
    }
  }

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
  const imageCandidatesForMemory = (memory: MemoryEntry) => {
    const candidates = [
      ...(memoryImageUrlCandidates[memory.id] ?? []),
      memory.mediaUrl ? memoryImageUrls[memory.mediaUrl] : null,
    ].filter((value): value is string => Boolean(value));

    return [...new Set(candidates)];
  };
  const highlightTabs = [
    {
      value: "journey",
      label: t("highlights.tab.journey"),
      count: bestItems.length,
    },
    {
      value: "spending",
      label: t("highlights.tab.spending"),
      count: spendingRankCount,
    },
    {
      value: "likes",
      label: t("highlights.tab.likes"),
      count: likedMemories.length,
    },
    {
      value: "favorites",
      label: t("highlights.tab.favorites"),
      count: favoritedMemories.length,
    },
    {
      value: "contribution",
      label: t("highlights.tab.contribution"),
      count: contributionItems.length,
    },
  ] as const;
  const selectedMemoryImageCandidates = selectedMemory
    ? imageCandidatesForMemory(selectedMemory)
    : [];
  const dailyBestMomentsShots = memoryShots.filter(
    (memoryShot) =>
      memoryShotTemplateKey(memoryShot) === "memory_shot_daily_best_moments",
  );
  const hasGeneratingDailyBestMoments = dailyBestMomentsShots.some(
    (memoryShot) => memoryShot.status === "generating",
  );
  const hasReadyDailyBestMoments = dailyBestMomentsShots.some(
    (memoryShot) => memoryShot.status === "ready",
  );
  const isGenerateDisabled =
    isGeneratingMemoryShot || hasGeneratingDailyBestMoments;
  const generateLabel =
    isGeneratingMemoryShot || hasGeneratingDailyBestMoments
      ? "Generating..."
      : hasReadyDailyBestMoments
        ? "Regenerate"
        : "Generate";

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black text-emerald-800">
              Memory Shots
            </p>
            <h2 className="text-xl font-semibold text-stone-950">
              Daily Best Moments
            </h2>
          </div>
          <button
            type="button"
            onClick={generateDailyBestMoments}
            disabled={isGenerateDisabled}
            className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {generateLabel}
          </button>
        </div>

        {memoryShotError ? (
          <p className="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-700">
            {memoryShotError}
          </p>
        ) : null}

        {memoryShots.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            No Memory Shots yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {memoryShots.map((memoryShot) => {
              const sections = memoryShotSections(memoryShot);
              const previewSources = memoryShotPreviewSources(memoryShot);
              return (
                <article
                  key={memoryShot.id}
                  className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-4"
                >
                  {previewSources.length > 0 ? (
                    <div className="mb-4 overflow-hidden rounded-2xl border border-stone-200 bg-stone-100">
                      <FallbackImage
                        sources={previewSources}
                        alt={memoryShot.title || "Memory Shot preview"}
                        className="h-auto w-full object-cover"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-wide text-emerald-800">
                        {memoryShot.status}
                        {memoryShot.renderStatus === "rendering"
                          ? " · rendering"
                          : ""}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-stone-950">
                        {memoryShot.title || "Daily Best Moments"}
                      </h3>
                      {memoryShot.subtitle ? (
                        <p className="mt-1 text-sm leading-6 text-stone-600">
                          {memoryShot.subtitle}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                      {memoryShot.visibility}
                    </span>
                  </div>
                  {sections.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm leading-6 text-stone-700">
                      {sections.map((section) => (
                        <li key={section}>- {section}</li>
                      ))}
                    </ul>
                  ) : null}
                  {memoryShot.status === "generating" ? (
                    <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                      Generating Memory Shot...
                    </p>
                  ) : null}
                  {memoryShot.status === "failed" ? (
                    <p className="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-700">
                      {memoryShotErrorSummary(memoryShot)}
                    </p>
                  ) : null}
                  {memoryShot.renderStatus === "failed" ? (
                    <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                      {memoryShot.renderError ||
                        "Preview render failed. Text fallback is still available."}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <p className="text-sm font-black text-emerald-800">
              {t("highlights.eyebrow")}
            </p>
            <h2 className="text-xl font-semibold text-stone-950">
              {t("highlights.rankings")}
            </h2>
          </div>
          <div className="-mx-1 flex min-w-0 max-w-full gap-2 overflow-x-auto px-1 pb-1 text-xs font-black text-stone-600">
            {highlightTabs.map(({ value, label, count }) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value)}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3 py-2 transition ${
                  activeTab === value
                    ? "border-emerald-200 bg-emerald-700 text-white shadow-sm"
                    : "border-stone-200 bg-stone-50 text-stone-600"
                }`}
              >
                <span className="whitespace-nowrap">{label}</span>
                <span
                  className={`grid min-w-6 place-items-center rounded-full px-1.5 py-0.5 text-[11px] ${
                    activeTab === value
                      ? "bg-white/20 text-white"
                      : "bg-white text-stone-700"
                  }`}
                >
                  {count}
                </span>
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
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {activeMemoryRank.map((memory) => {
              const imageCandidates = imageCandidatesForMemory(memory);

              return (
                <button
                  type="button"
                  key={memory.id}
                  onClick={() => setSelectedMemory(memory)}
                  className="group relative aspect-square overflow-hidden rounded-xl bg-stone-100 text-left shadow-sm transition hover:opacity-95"
                >
                  {memory.type === "photo" && imageCandidates.length > 0 ? (
                    <FallbackImage
                      sources={imageCandidates}
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
                  <span className="absolute bottom-2 right-2 inline-flex items-center gap-2 rounded-full bg-stone-950/20 px-2 py-1 text-[11px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] backdrop-blur-[2px]">
                    <span className="inline-flex items-center gap-0.5">
                      <span aria-hidden="true">♡</span>
                      <span>{memory.likeCount ?? 0}</span>
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <span aria-hidden="true">☆</span>
                      <span>{memory.favoriteCount ?? 0}</span>
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
              selectedMemoryImageCandidates.length > 0 ? (
                <div className="grid h-full w-full min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="grid min-h-0 place-items-center bg-black">
                    <FallbackImage
                      sources={selectedMemoryImageCandidates}
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

function FallbackImage({
  sources,
  alt,
  className,
}: {
  sources: string[];
  alt: string;
  className: string;
}) {
  const firstSource = sources[0];
  if (!firstSource) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={sources.join("|")}
      src={firstSource}
      alt={alt}
      className={className}
      onError={(event) => {
        const nextIndex = Number(event.currentTarget.dataset.nextIndex ?? "1");
        const nextSource = sources[nextIndex];
        if (nextSource) {
          event.currentTarget.dataset.nextIndex = String(nextIndex + 1);
          event.currentTarget.src = nextSource;
          return;
        }

        event.currentTarget.style.display = "none";
      }}
    />
  );
}

export default function HighlightsPage() {
  return <AuthGate>{() => <HighlightsContent />}</AuthGate>;
}
