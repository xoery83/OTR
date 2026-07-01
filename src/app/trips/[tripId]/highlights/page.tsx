"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
import type {
  MemoryShot,
  MemoryShotRecommendation,
} from "@/lib/memory-shots/types";
import type { StoryDayAssessment } from "@/lib/story-recommendations/types";
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

type StoryCopy = ReturnType<typeof storyCopy>;

function storyCopy(locale: string) {
  const isZh = locale === "zh-CN";
  return {
    pageTitle: isZh ? "故事" : "Stories",
    pageDescription: isZh
      ? "把照片、路线和共同记忆，变成可以回看的故事。"
      : "Turn photos, routes, and shared memories into stories worth revisiting.",
    myStories: isZh ? "我的故事" : "My Stories",
    latestStories: isZh ? "最新故事" : "Latest Stories",
    storyIdeas: isZh ? "值得创作" : "Worth Creating",
    create: isZh ? "创作" : "Create",
    checkMaterials: isZh ? "检查素材" : "Check material",
    checkingMaterials: isZh ? "检查中" : "Checking...",
    chooseStoryDate: isZh ? "选择日期" : "Choose date",
    materialReady: isZh ? "这一天可以创作" : "This day can be created",
    materialNotReady: isZh ? "素材还不够" : "Not enough material yet",
    selectDateFirst: isZh ? "先选择一天，系统会检查这天是否有足够素材。" : "Choose a day and OTR will check whether it has enough material.",
    refreshIdeas: isZh ? "刷新建议" : "Refresh ideas",
    refreshingIdeas: isZh ? "刷新中" : "Refreshing...",
    close: isZh ? "关闭" : "Close",
    creating: isZh ? "创作中" : "Creating...",
    recreate: isZh ? "重新创作" : "Recreate",
    openStory: isZh ? "打开故事" : "Open Story",
    share: isZh ? "分享" : "Share",
    save: isZh ? "收藏" : "Favorite",
    visibility: isZh ? "可见范围" : "Visibility",
    download: isZh ? "下载" : "Download",
    future: isZh ? "稍后支持" : "Soon",
    debugDetails: isZh ? "调试详情" : "Debug details",
    noStories: isZh ? "还没有故事。" : "No stories yet.",
    noPreview: isZh ? "暂无预览图" : "No preview yet",
    poster: isZh ? "海报" : "Poster",
    motion: isZh ? "动态故事" : "Motion",
    generatedBy: isZh ? "创作者" : "Author",
    date: isZh ? "时间" : "Date",
    statusReady: isZh ? "已完成" : "Ready",
    statusGenerating: isZh ? "创作中" : "Creating",
    statusFailed: isZh ? "失败" : "Failed",
    statusDraft: isZh ? "草稿" : "Draft",
    statusArchived: isZh ? "已归档" : "Archived",
    publicVisibility: isZh ? "公开" : "Public",
    journeyVisibility: isZh ? "旅程成员" : "Journey members",
    privateVisibility: isZh ? "仅自己" : "Private",
    unlistedVisibility: isZh ? "非公开链接" : "Unlisted",
    createFailed: isZh ? "故事创作失败。" : "Could not create story.",
    renderFallback: isZh
      ? "预览使用了备用存储。"
      : "Preview used fallback storage.",
    renderFailed: isZh
      ? "故事预览生成失败，文字内容仍可查看。"
      : "Story preview failed. Text fallback is available.",
    details: isZh ? "查看内容" : "View details",
    latestEmpty: isZh ? "暂无其他成员的新故事。" : "No new stories from other members yet.",
    mineEmpty: isZh ? "你还没有创作故事。" : "You have not created stories yet.",
    ideasEmpty: isZh ? "暂时没有新的创作建议。" : "No story ideas yet.",
    ideasEmptyOwner: isZh
      ? "暂时没有新的创作建议，可以手动刷新一次。"
      : "No story ideas yet. You can refresh suggestions manually.",
    noCreatableIdeas: isZh
      ? "当前还没有可直接创作的故事，先看看系统发现了哪些线索。"
      : "No directly creatable stories yet. Here are the clues the system found.",
    dailyBestTitle: isZh ? "今日最佳瞬间" : "Daily Best Moments",
    dailyBestReason: isZh
      ? "从照片、行程、地点和成员互动里整理今天最值得回看的片段。"
      : "Create a story from today's photos, itinerary, places, and shared moments.",
    dailyBestTypes: isZh ? "photos / people / route / ledger" : "photos / people / route / ledger",
    comingSoon: isZh ? "即将支持" : "Coming soon",
  };
}

function todayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

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

function storySafeError(message: string | null, copy: StoryCopy) {
  if (!message) return copy.createFailed;
  return message
    .replace(/Memory Shot/g, "story")
    .replace(/Memory Shots/g, "stories")
    .replace(/memory shot/g, "story")
    .replace(/memory shots/g, "stories");
}

function memoryShotPreviewSources(memoryShot: MemoryShot) {
  return [memoryShot.previewUrl, memoryShot.thumbnailUrl].filter(
    (value): value is string => Boolean(value),
  );
}

function memoryShotMotionStoryUrl(memoryShot: MemoryShot) {
  const motionStory = memoryShot.metadata.motionStory;
  if (!motionStory || typeof motionStory !== "object") return null;
  const url = (motionStory as Record<string, unknown>).url;
  return typeof url === "string" && url ? url : null;
}

function storyStatusLabel(memoryShot: MemoryShot, copy: StoryCopy) {
  if (memoryShot.status === "ready") return copy.statusReady;
  if (memoryShot.status === "generating") return copy.statusGenerating;
  if (memoryShot.status === "failed") return copy.statusFailed;
  if (memoryShot.status === "archived") return copy.statusArchived;
  return copy.statusDraft;
}

function storyVisibilityLabel(memoryShot: MemoryShot, copy: StoryCopy) {
  if (memoryShot.visibility === "private") return copy.privateVisibility;
  if (memoryShot.visibility === "public_discover") return copy.publicVisibility;
  if (memoryShot.visibility === "public_unlisted") return copy.unlistedVisibility;
  return copy.journeyVisibility;
}

function storyTitle(memoryShot: MemoryShot, copy: StoryCopy) {
  return memoryShot.title || String(memoryShot.content.title || copy.dailyBestTitle);
}

function storySubtitle(memoryShot: MemoryShot, locale: string) {
  return (
    memoryShot.subtitle ||
    String(memoryShot.content.subtitle || dateTimeLabel(memoryShot.createdAt, locale))
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

function recommendationTemplateKey(recommendation: MemoryShotRecommendation) {
  const key = recommendation.payload.templateKey;
  return typeof key === "string" ? key : null;
}

function recommendationDate(recommendation: MemoryShotRecommendation) {
  const date = recommendation.payload.date;
  return typeof date === "string" ? date : null;
}

function storyDayResourceTags(assessment: StoryDayAssessment | null, locale: string) {
  if (!assessment) return [];
  const summary = assessment.resourceSummary;
  const isZh = locale === "zh-CN";
  return [
    summary.photosCount > 0
      ? isZh
        ? `照片 ${summary.photosCount}`
        : `Photos ${summary.photosCount}`
      : null,
    summary.memoriesCount > 0
      ? isZh
        ? `记忆 ${summary.memoriesCount}`
        : `Memories ${summary.memoriesCount}`
      : null,
    summary.plannerItemsCount > 0
      ? isZh
        ? `行程 ${summary.plannerItemsCount}`
        : `Planner ${summary.plannerItemsCount}`
      : null,
    summary.locationsCount > 0
      ? isZh
        ? `地点 ${summary.locationsCount}`
        : `Places ${summary.locationsCount}`
      : null,
    summary.expensesCount > 0
      ? isZh
        ? `账本 ${summary.expensesCount}`
        : `Ledger ${summary.expensesCount}`
      : null,
  ].filter((value): value is string => Boolean(value));
}

function recommendationIntentKey(recommendation: MemoryShotRecommendation) {
  const intentKey = recommendation.metadata.intentKey;
  if (typeof intentKey === "string") return intentKey;
  return recommendation.recommendationKey.split(":")[0] || null;
}

function contentTypeLabel(value: string, locale: string) {
  const normalized = value.trim().toLowerCase();
  const isZh = locale === "zh-CN";
  const zhLabels: Record<string, string> = {
    photo: "照片",
    photos: "照片",
    people: "成员",
    person: "成员",
    route: "路线",
    routes: "路线",
    ledger: "账本",
    expense: "账本",
    expenses: "账本",
    planner: "行程",
    planner_item: "行程",
    planner_items: "行程",
    memories: "记忆",
    memory: "记忆",
    locations: "地点",
    location: "地点",
  };
  const enLabels: Record<string, string> = {
    photo: "Photos",
    photos: "Photos",
    people: "People",
    person: "People",
    route: "Route",
    routes: "Route",
    ledger: "Ledger",
    expense: "Ledger",
    expenses: "Ledger",
    planner: "Planner",
    planner_item: "Planner",
    planner_items: "Planner",
    memories: "Memories",
    memory: "Memories",
    locations: "Places",
    location: "Places",
  };

  return (isZh ? zhLabels : enLabels)[normalized] ?? value;
}

function recommendationContentTags(
  recommendation: MemoryShotRecommendation,
  locale: string,
) {
  const contentTypes = recommendation.payload.contentTypes;
  if (!Array.isArray(contentTypes)) return [];
  const tags = contentTypes
    .map((value) => (typeof value === "string" ? value : null))
    .filter((value): value is string => Boolean(value))
    .map((value) => contentTypeLabel(value, locale));
  return [...new Set(tags)];
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
  const [selectedStory, setSelectedStory] = useState<MemoryShot | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [memoryShots, setMemoryShots] = useState<MemoryShot[]>([]);
  const [storyRecommendations, setStoryRecommendations] = useState<
    MemoryShotRecommendation[]
  >([]);
  const [canRefreshStoryRecommendations, setCanRefreshStoryRecommendations] =
    useState(false);
  const [isRefreshingStoryRecommendations, setIsRefreshingStoryRecommendations] =
    useState(false);
  const [storyRecommendationError, setStoryRecommendationError] =
    useState<string | null>(null);
  const [isGeneratingMemoryShot, setIsGeneratingMemoryShot] = useState(false);
  const [memoryShotError, setMemoryShotError] = useState<string | null>(null);
  const [storyCreationDate, setStoryCreationDate] = useState(todayInputDate);
  const [storyDayAssessment, setStoryDayAssessment] =
    useState<StoryDayAssessment | null>(null);
  const [storyDayAssessmentError, setStoryDayAssessmentError] =
    useState<string | null>(null);
  const [isAssessingStoryDate, setIsAssessingStoryDate] = useState(false);
  const [activeTab, setActiveTab] = useState<HighlightTab>("spending");
  const copy = storyCopy(locale);
  const showLegacyRankings = false;

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
        const { data: userData } = await supabase.auth.getUser();
        if (!cancelled) setCurrentUserId(userData.user?.id ?? null);
        const headers = await memoryShotAuthHeaders();
        const response = await fetch(`/api/journeys/${tripId}/memory-shots`, {
          headers,
        });
        const payload = (await response.json()) as {
          memoryShots?: MemoryShot[];
          error?: string;
        };
        if (!response.ok || !payload.memoryShots) {
          throw new Error(payload.error || "Could not load stories.");
        }
        if (!cancelled) {
          setMemoryShots(sortMemoryShots(payload.memoryShots));
          setMemoryShotError(null);
        }
        try {
          const recommendationResponse = await fetch(
            `/api/journeys/${tripId}/story-recommendations`,
            { headers },
          );
          const recommendationPayload = (await recommendationResponse.json()) as {
            recommendations?: MemoryShotRecommendation[];
            canRefresh?: boolean;
            error?: string;
          };
          if (!recommendationResponse.ok) {
            throw new Error(
              recommendationPayload.error || "Could not load story recommendations.",
            );
          }
          if (!cancelled) {
            setStoryRecommendations(recommendationPayload.recommendations ?? []);
            setCanRefreshStoryRecommendations(
              Boolean(recommendationPayload.canRefresh),
            );
            setStoryRecommendationError(null);
          }
        } catch (recommendationError) {
          if (!cancelled) {
            setStoryRecommendationError(
              recommendationError instanceof Error
                ? recommendationError.message
                : "Could not load story recommendations.",
            );
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setMemoryShotError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load stories.",
          );
        }
      }
    }

    loadMemoryShots();

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function generateDailyBestMoments(date?: string | null) {
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
            date: date ?? undefined,
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
          memoryShotApiError(payload, copy.createFailed),
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
          : copy.createFailed,
      );
    } finally {
      setIsGeneratingMemoryShot(false);
    }
  }

  async function assessStoryCreationDate(date: string) {
    if (!date || isAssessingStoryDate) return;

    setIsAssessingStoryDate(true);
    setStoryDayAssessmentError(null);
    try {
      const headers = await memoryShotAuthHeaders();
      const response = await fetch(
        `/api/journeys/${tripId}/story-recommendations/day?date=${encodeURIComponent(
          date,
        )}&language=${encodeURIComponent(locale)}`,
        { headers },
      );
      const payload = (await response.json()) as {
        assessment?: StoryDayAssessment;
        error?: string;
      };
      if (!response.ok || !payload.assessment) {
        throw new Error(payload.error || "Could not check this story day.");
      }
      setStoryDayAssessment(payload.assessment);
    } catch (assessmentError) {
      setStoryDayAssessment(null);
      setStoryDayAssessmentError(
        assessmentError instanceof Error
          ? assessmentError.message
          : "Could not check this story day.",
      );
    } finally {
      setIsAssessingStoryDate(false);
    }
  }

  async function refreshStoryRecommendations() {
    if (isRefreshingStoryRecommendations || !canRefreshStoryRecommendations) return;

    setIsRefreshingStoryRecommendations(true);
    setStoryRecommendationError(null);
    try {
      const response = await fetch(
        `/api/journeys/${tripId}/story-recommendations/refresh`,
        {
          method: "POST",
          headers: await memoryShotAuthHeaders(),
          body: JSON.stringify({
            mode: "manual",
            limit: 5,
            language: locale,
          }),
        },
      );
      const payload = (await response.json()) as {
        recommendations?: MemoryShotRecommendation[];
        error?: string;
      };
      if (!response.ok || !payload.recommendations) {
        throw new Error(payload.error || "Could not refresh story recommendations.");
      }
      setStoryRecommendations(payload.recommendations);
    } catch (refreshError) {
      setStoryRecommendationError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not refresh story recommendations.",
      );
    } finally {
      setIsRefreshingStoryRecommendations(false);
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
  const membersByUserId = useMemo(
    () =>
      new Map(
        members
          .filter((member) => Boolean(member.userId))
          .map((member) => [member.userId as string, member]),
      ),
    [members],
  );
  const myStories = useMemo(
    () =>
      currentUserId
        ? memoryShots.filter((memoryShot) => memoryShot.authorUserId === currentUserId)
        : memoryShots,
    [currentUserId, memoryShots],
  );
  const latestStories = currentUserId
    ? memoryShots.filter((memoryShot) => memoryShot.authorUserId !== currentUserId)
    : [];
  const dailyBestMomentsShots = memoryShots.filter(
    (memoryShot) =>
      memoryShotTemplateKey(memoryShot) === "memory_shot_daily_best_moments",
  );
  const hasGeneratingDailyBestMoments = dailyBestMomentsShots.some(
    (memoryShot) => memoryShot.status === "generating",
  );
  const isGenerateDisabled =
    isGeneratingMemoryShot || hasGeneratingDailyBestMoments;
  const storyIdeaGenerateLabel = isGenerateDisabled ? copy.creating : copy.create;
  const selectedDayAssessment =
    storyDayAssessment?.date === storyCreationDate ? storyDayAssessment : null;
  const selectedDayTags = storyDayResourceTags(selectedDayAssessment, locale);
  const storyIdeas = [...storyRecommendations]
    .sort((left, right) => {
      const leftIsDaily =
        recommendationIntentKey(left) === "daily_best_moments" ||
        recommendationTemplateKey(left) === "memory_shot_daily_best_moments";
      const rightIsDaily =
        recommendationIntentKey(right) === "daily_best_moments" ||
        recommendationTemplateKey(right) === "memory_shot_daily_best_moments";
      if (leftIsDaily !== rightIsDaily) return leftIsDaily ? -1 : 1;
      return right.score - left.score;
    })
    .map((recommendation) => {
      const templateKey = recommendationTemplateKey(recommendation);
      const isDailyBestMoments =
        templateKey === "memory_shot_daily_best_moments";
      return {
        id: recommendation.id,
        title: recommendation.title,
        reason: recommendation.reason || copy.dailyBestReason,
        contentTags: recommendationContentTags(recommendation, locale),
        isCreatable: isDailyBestMoments,
        disabled:
          !isDailyBestMoments ||
          isGenerateDisabled ||
          !selectedDayAssessment?.canCreate,
        label: isDailyBestMoments ? storyIdeaGenerateLabel : copy.comingSoon,
        isDailyBestMoments,
        date: isDailyBestMoments ? storyCreationDate : recommendationDate(recommendation),
        onCreate: () =>
          isDailyBestMoments ? generateDailyBestMoments(storyCreationDate) : undefined,
      };
    });
  const hasCreatableStoryIdea = storyIdeas.some((idea) => idea.isCreatable);

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
          {copy.pageTitle}
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          {copy.pageDescription}
        </p>
      </section>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <section className="space-y-5 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        {memoryShotError ? (
          <p className="rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-700">
            {storySafeError(memoryShotError, copy)}
          </p>
        ) : null}

        <StoryRail title={copy.myStories} emptyLabel={copy.mineEmpty}>
          {myStories.map((memoryShot) => (
            <StoryPosterCard
              key={memoryShot.id}
              memoryShot={memoryShot}
              copy={copy}
              locale={locale}
              authorName={memberLabel(
                membersByUserId.get(memoryShot.authorUserId ?? ""),
              )}
              onOpen={() => setSelectedStory(memoryShot)}
            />
          ))}
        </StoryRail>

        <StoryRail title={copy.latestStories} emptyLabel={copy.latestEmpty}>
          {latestStories.map((memoryShot) => (
            <StoryPosterCard
              key={memoryShot.id}
              memoryShot={memoryShot}
              copy={copy}
              locale={locale}
              authorName={memberLabel(
                membersByUserId.get(memoryShot.authorUserId ?? ""),
              )}
              onOpen={() => setSelectedStory(memoryShot)}
            />
          ))}
        </StoryRail>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-stone-950">
              {copy.storyIdeas}
            </h2>
            {canRefreshStoryRecommendations ? (
              <button
                type="button"
                onClick={refreshStoryRecommendations}
                disabled={isRefreshingStoryRecommendations}
                className="min-h-9 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-black text-stone-700 transition hover:border-emerald-200 hover:text-emerald-800 disabled:cursor-not-allowed disabled:text-stone-400"
              >
                {isRefreshingStoryRecommendations
                  ? copy.refreshingIdeas
                  : copy.refreshIdeas}
              </button>
            ) : null}
          </div>
          {storyRecommendationError ? (
            <p className="mb-3 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
              {storyRecommendationError}
            </p>
          ) : null}
          {storyIdeas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
              {canRefreshStoryRecommendations ? copy.ideasEmptyOwner : copy.ideasEmpty}
            </div>
          ) : (
            <>
              {!hasCreatableStoryIdea ? (
                <p className="mb-3 rounded-2xl bg-stone-50 p-3 text-sm font-semibold text-stone-600">
                  {copy.noCreatableIdeas}
                </p>
              ) : null}
              <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                {storyIdeas.map((idea) => (
                  <article
                    key={idea.id}
                    className="flex min-h-56 w-[min(22rem,calc(100vw-3.5rem))] shrink-0 snap-start flex-col justify-between rounded-2xl border border-stone-200 bg-[#fffdf8] p-5"
                  >
                    <div>
                      <h3 className="text-lg font-semibold leading-6 text-stone-950">
                        {idea.title}
                      </h3>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-600">
                        {idea.reason}
                      </p>
                      {idea.contentTags.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {idea.contentTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-800"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {idea.isDailyBestMoments ? (
                        <div className="mt-4 space-y-3 rounded-2xl border border-stone-200 bg-white p-3">
                          <label className="block text-[11px] font-black uppercase tracking-wide text-stone-500">
                            {copy.chooseStoryDate}
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="date"
                              value={storyCreationDate}
                              onChange={(event) => {
                                const nextDate = event.currentTarget.value;
                                setStoryCreationDate(nextDate);
                                setStoryDayAssessment(null);
                                setStoryDayAssessmentError(null);
                              }}
                              className="min-h-10 min-w-0 flex-1 rounded-full border border-stone-200 bg-stone-50 px-3 text-sm font-bold text-stone-800"
                            />
                            <button
                              type="button"
                              onClick={() => assessStoryCreationDate(storyCreationDate)}
                              disabled={isAssessingStoryDate || !storyCreationDate}
                              className="min-h-10 shrink-0 rounded-full border border-stone-200 bg-white px-3 text-xs font-black text-stone-700 disabled:cursor-not-allowed disabled:text-stone-400"
                            >
                              {isAssessingStoryDate
                                ? copy.checkingMaterials
                                : copy.checkMaterials}
                            </button>
                          </div>
                          {selectedDayAssessment ? (
                            <div
                              className={`rounded-2xl p-3 text-xs font-bold ${
                                selectedDayAssessment.canCreate
                                  ? "bg-emerald-50 text-emerald-900"
                                  : "bg-amber-50 text-amber-900"
                              }`}
                            >
                              <p className="font-black">
                                {selectedDayAssessment.canCreate
                                  ? copy.materialReady
                                  : copy.materialNotReady}
                              </p>
                              <p className="mt-1 leading-5">
                                {selectedDayAssessment.reason}
                              </p>
                              {selectedDayTags.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {selectedDayTags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-full bg-white/75 px-2 py-0.5 text-[10px] font-black"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-xs font-semibold leading-5 text-stone-500">
                              {storyDayAssessmentError || copy.selectDateFirst}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={idea.onCreate}
                      disabled={idea.disabled}
                      className={`mt-5 min-h-11 rounded-full px-4 py-2 text-sm font-black transition ${
                        idea.isCreatable
                          ? "bg-stone-950 text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                          : "border border-stone-200 bg-stone-50 text-stone-500 disabled:cursor-default"
                      }`}
                    >
                      {idea.label}
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {showLegacyRankings ? (
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
      ) : null}

      {selectedStory ? (
        <StoryDetailModal
          memoryShot={selectedStory}
          copy={copy}
          locale={locale}
          authorName={memberLabel(
            membersByUserId.get(selectedStory.authorUserId ?? ""),
          )}
          onClose={() => setSelectedStory(null)}
        />
      ) : null}

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

function StoryRail({
  title,
  emptyLabel,
  children,
}: {
  title: string;
  emptyLabel: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      </div>
      {isEmpty ? (
        <div className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}

function StoryPosterCard({
  memoryShot,
  copy,
  locale,
  authorName,
  onOpen,
}: {
  memoryShot: MemoryShot;
  copy: StoryCopy;
  locale: string;
  authorName: string;
  onOpen: () => void;
}) {
  const previewSources = memoryShotPreviewSources(memoryShot);
  const sections = memoryShotSections(memoryShot);
  const hasPoster = previewSources.length > 0 || memoryShot.renderStatus === "ready";
  const hasMotion = Boolean(memoryShotMotionStoryUrl(memoryShot));

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-40 shrink-0 snap-start text-left sm:w-44"
    >
      <span className="relative block aspect-[9/14] overflow-hidden rounded-2xl border border-stone-200 bg-[#f7f1e7] shadow-sm transition group-hover:border-emerald-200 group-hover:shadow-md">
        {previewSources.length > 0 ? (
          <FallbackImage
            sources={previewSources}
            alt={storyTitle(memoryShot, copy)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full flex-col justify-between bg-[#fffdf8] p-4">
            <span>
              <span className="text-[11px] font-black uppercase tracking-wide text-emerald-800">
                {copy.noPreview}
              </span>
              <span className="mt-3 line-clamp-5 block text-lg font-semibold leading-6 text-stone-950">
                {storyTitle(memoryShot, copy)}
              </span>
            </span>
            {sections[0] ? (
              <span className="line-clamp-3 text-xs leading-5 text-stone-600">
                {sections[0]}
              </span>
            ) : null}
          </span>
        )}
        <span className="absolute left-2 top-2 flex gap-1">
          {hasPoster ? (
            <span className="grid size-7 place-items-center rounded-full bg-white/90 text-[10px] font-black text-stone-950 shadow-sm">
              P
            </span>
          ) : null}
          {hasMotion ? (
            <span className="grid size-7 place-items-center rounded-full bg-emerald-700 text-[10px] font-black text-white shadow-sm">
              M
            </span>
          ) : null}
        </span>
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950/80 to-transparent p-3 pt-10 text-white">
          <span className="block text-[11px] font-black uppercase tracking-wide text-white/80">
            {storyStatusLabel(memoryShot, copy)}
          </span>
          <span className="mt-1 line-clamp-2 block text-sm font-semibold leading-5">
            {storyTitle(memoryShot, copy)}
          </span>
        </span>
      </span>
      <span className="mt-2 block min-w-0">
        <span className="block truncate text-xs font-semibold text-stone-600">
          {storySubtitle(memoryShot, locale)}
        </span>
        <span className="mt-1 flex flex-wrap gap-1 text-[10px] font-black text-stone-500">
          <span className="rounded-full bg-stone-100 px-2 py-0.5">
            {authorName || copy.generatedBy}
          </span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">
            {storyVisibilityLabel(memoryShot, copy)}
          </span>
        </span>
      </span>
    </button>
  );
}

function StoryDetailModal({
  memoryShot,
  copy,
  locale,
  authorName,
  onClose,
}: {
  memoryShot: MemoryShot;
  copy: StoryCopy;
  locale: string;
  authorName: string;
  onClose: () => void;
}) {
  const previewSources = memoryShotPreviewSources(memoryShot);
  const sections = memoryShotSections(memoryShot);
  const motionStoryUrl = memoryShotMotionStoryUrl(memoryShot);

  return (
    <div
      className="fixed inset-0 z-[2147482400] bg-stone-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full max-w-5xl flex-col gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <p className="truncate text-sm font-black">
              {storyTitle(memoryShot, copy)}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-white/65">
              {copy.generatedBy}: {authorName || "Traveler"} ·{" "}
              {dateTimeLabel(memoryShot.createdAt, locale)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/15 px-3 py-2 text-xs font-black text-white"
          >
            {copy.close ?? "Close"}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl bg-white">
          <div className="grid min-h-[320px] place-items-center bg-[#f7f1e7] p-3 sm:min-h-[420px]">
            {previewSources.length > 0 ? (
              <FallbackImage
                sources={previewSources}
                alt={storyTitle(memoryShot, copy)}
                className="max-h-[62svh] max-w-full rounded-2xl object-contain shadow-sm"
              />
            ) : (
              <article className="max-w-md rounded-2xl border border-stone-200 bg-[#fffdf8] p-6">
                <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                  {copy.noPreview}
                </p>
                <h3 className="mt-3 text-2xl font-semibold text-stone-950">
                  {storyTitle(memoryShot, copy)}
                </h3>
                {sections.length > 0 ? (
                  <ul className="mt-4 space-y-2 text-sm leading-6 text-stone-700">
                    {sections.map((section) => (
                      <li key={section}>- {section}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            )}
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                  {storyStatusLabel(memoryShot, copy)}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-stone-950">
                  {storyTitle(memoryShot, copy)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  {storySubtitle(memoryShot, locale)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 text-xs font-black text-stone-600">
                <span className="rounded-full bg-stone-100 px-3 py-1">
                  {copy.generatedBy}: {authorName || "Traveler"}
                </span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
                  {storyVisibilityLabel(memoryShot, copy)}
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-[1.1fr_1fr]">
              {motionStoryUrl ? (
                <a
                  href={motionStoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-stone-950 px-4 py-2 text-sm font-black text-white transition hover:bg-emerald-800"
                >
                  {copy.openStory}
                </a>
              ) : null}
              <div
                className={`grid grid-cols-2 gap-2 ${
                  motionStoryUrl ? "" : "sm:col-span-2"
                }`}
              >
                <button
                  type="button"
                  className="min-h-10 rounded-full border border-stone-200 px-3 py-2 text-xs font-black text-stone-700"
                >
                  {copy.share}
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-full border border-stone-200 px-3 py-2 text-xs font-black text-stone-700"
                >
                  {copy.save}
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-full border border-stone-200 px-3 py-2 text-xs font-black text-stone-700"
                >
                  {copy.visibility}
                </button>
                <button
                  type="button"
                  disabled
                  className="min-h-10 rounded-full border border-stone-200 px-3 py-2 text-xs font-black text-stone-400"
                >
                  {copy.download} · {copy.future}
                </button>
              </div>
            </div>

            {sections.length > 0 ? (
              <details className="mt-5 text-sm text-stone-700">
                <summary className="cursor-pointer text-xs font-black text-emerald-800">
                  {copy.details}
                </summary>
                <ul className="mt-2 space-y-1 leading-6">
                  {sections.map((section) => (
                    <li key={section}>- {section}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {(memoryShot.status === "failed" ||
              memoryShot.renderWarning ||
              memoryShot.renderError) ? (
              <details className="mt-5 rounded-2xl bg-stone-50 p-3 text-xs text-stone-600">
                <summary className="cursor-pointer font-black text-stone-800">
                  {copy.debugDetails}
                </summary>
                {memoryShot.status === "failed" ? (
                  <p className="mt-2 text-red-700">
                    {storySafeError(memoryShotErrorSummary(memoryShot), copy)}
                  </p>
                ) : null}
                {memoryShot.renderWarning ? (
                  <p className="mt-2 text-amber-800">
                    {copy.renderFallback} {memoryShot.renderWarning}
                  </p>
                ) : null}
                {memoryShot.renderError ? (
                  <p className="mt-2 text-amber-800">
                    {copy.renderFailed} {memoryShot.renderError}
                  </p>
                ) : null}
              </details>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HighlightsPage() {
  return <AuthGate>{() => <HighlightsContent />}</AuthGate>;
}
