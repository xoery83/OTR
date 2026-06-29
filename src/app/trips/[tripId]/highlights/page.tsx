"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { getPlannerV2, type PlannerV2Data } from "@/lib/supabase/planner-v2";
import { getLedgerData } from "@/lib/supabase/ledger";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getItineraryRatingCountsByUser } from "@/lib/supabase/itinerary-ratings";
import {
  getTripFaceTagCountsByMember,
  getTripImageUploadCountsByUser,
} from "@/lib/supabase/media-assets";
import { getTrip } from "@/lib/supabase/trips";
import type {
  ItineraryEventType,
  ItineraryItemRatingSummary,
  ItineraryReservationType,
  JourneyMember,
  LedgerCategory,
  LedgerEntry,
  LedgerMemberBalance,
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

type HighlightTab = "spending" | "journey" | "contribution";

type ContributionRankItem = {
  id: string;
  label: string;
  title: string;
  subtitle: string;
  count: number;
  href: string;
};

const typeLabels: Record<string, string> = {
  flight: "航班",
  hotel: "住宿",
  car: "租车",
  activity: "活动",
  shopping: "购物",
  meal: "餐饮",
  transport: "交通",
  note: "备注",
  ferry: "渡轮",
  tour: "游览",
  restaurant: "餐厅",
  other: "其他",
};

const ledgerCategoryLabels: Record<LedgerCategory, string> = {
  flight: "机票",
  hotel: "酒店",
  car: "租车",
  fuel: "油费",
  food: "餐饮",
  ticket: "门票",
  shopping: "购物",
  transport: "交通",
  insurance: "保险",
  other: "其他",
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

function HighlightsContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const { locale } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [planner, setPlanner] = useState<PlannerV2Data>({ days: [] });
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerBalances, setLedgerBalances] = useState<LedgerMemberBalance[]>([]);
  const [ledgerCurrency, setLedgerCurrency] = useState("NZD");
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [imageUploadCounts, setImageUploadCounts] = useState<Record<string, number>>({});
  const [faceTagCounts, setFaceTagCounts] = useState<Record<string, number>>({});
  const [ratingCounts, setRatingCounts] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<HighlightTab>("spending");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadHighlights() {
      try {
        const tripData = await getTrip(tripId);
        const [
          plannerData,
          ledgerData,
          journeyMembers,
          imageCounts,
          faceCounts,
          ratingCountsByUser,
        ] = await Promise.all([
          getPlannerV2(tripData),
          getLedgerData(tripData.id),
          getJourneyMembers(tripData.id),
          getTripImageUploadCountsByUser(tripData.id),
          getTripFaceTagCountsByMember(tripData.id),
          getItineraryRatingCountsByUser(tripData.id),
        ]);
        if (!isMounted) return;
        setTrip(tripData);
        setPlanner(plannerData);
        setLedgerEntries(ledgerData.entries);
        setLedgerBalances(ledgerData.summary.balances);
        setLedgerCurrency(ledgerData.ledger.baseCurrency);
        setMembers(journeyMembers);
        setImageUploadCounts(imageCounts);
        setFaceTagCounts(faceCounts);
        setRatingCounts(ratingCountsByUser);
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError, "Could not load highlights."));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadHighlights();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const bestItems = useMemo(() => ratedItems(planner), [planner]);
  const bestByType = useMemo(() => {
    const grouped = new Map<string, BestItem[]>();
    bestItems.forEach((item) => {
      grouped.set(item.type, [...(grouped.get(item.type) ?? []), item]);
    });
    return [...grouped.entries()].sort(([left], [right]) =>
      (typeLabels[left] ?? left).localeCompare(typeLabels[right] ?? right),
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
            label: "添加行程最多",
            title: memberLabel(membersByUserId.get(topItineraryCreator.value.userId ?? "")),
            subtitle: "创建活动和预订",
            count: topItineraryCreator.count,
            href: `/trips/${tripId}/planner`,
          }
        : null,
      topMemoryUploader
        ? {
            id: "memory-uploaded",
            label: "上传记忆最多",
            title: memberLabel(membersByUserId.get(topMemoryUploader.value.userId ?? "")),
            subtitle: "文字、照片和语音记忆",
            count: topMemoryUploader.count,
            href: `/trips/${tripId}/timeline`,
          }
        : null,
      topImageUploader
        ? {
            id: "image-uploaded",
            label: "上传图片最多",
            title: memberLabel(membersByUserId.get(topImageUploader.value.userId ?? "")),
            subtitle: "图片媒体上传",
            count: topImageUploader.count,
            href: `/trips/${tripId}/timeline`,
          }
        : null,
      topFaceTagged
        ? {
            id: "face-tagged",
            label: "最多脸被标记",
            title: memberLabel(membersById.get(topFaceTagged.value.id)),
            subtitle: "照片中被识别或确认",
            count: topFaceTagged.count,
            href: `/trips/${tripId}/people`,
          }
        : null,
      topRater
        ? {
            id: "rating-created",
            label: "最多点评贡献",
            title: memberLabel(membersByUserId.get(topRater.value.userId ?? "")),
            subtitle: "行程与预订评分",
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
    tripId,
  ]);

  if (isLoading) {
    return <div className="rounded-2xl bg-white p-5">加载精选中...</div>;
  }

  return (
    <div className="space-y-5">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name ?? "Journey"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Journey Highlights
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          汇总行程点评和账本消费，自动生成旅途里的排行榜。
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
            <p className="text-sm font-black text-emerald-800">Highlights</p>
            <h2 className="text-xl font-semibold text-stone-950">排行榜</h2>
          </div>
          <div className="grid grid-cols-3 rounded-full bg-stone-100 p-1 text-xs font-black text-stone-600">
            {(
              [
                ["spending", `消费 ${spendingRankCount}`],
                ["contribution", `贡献 ${contributionItems.length}`],
                ["journey", `行程 ${bestItems.length}`],
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
            还没有消费记录。添加酒店、机票或餐饮支出后，这里会自动生成各分类最高消费。
          </div>
        ) : null}

        {activeTab === "spending" && spendingRankCount > 0 ? (
          <div className="mt-4 space-y-2">
            {[
              topConsumer
                ? {
                    id: "top-consumer",
                    label: "消费最多的人",
                    title: topConsumer.balance.member.displayName,
                    subtitle: `共享 ${money(
                      topConsumer.balance.owedTotal,
                      ledgerCurrency,
                      locale,
                    )} · 个人 ${money(
                      topConsumer.balance.statsOnlyTotal,
                      ledgerCurrency,
                      locale,
                    )}`,
                    amount: topConsumer.amount,
                    href: `/trips/${tripId}/ledger?view=people`,
                  }
                : null,
              topPayer
                ? {
                    id: "top-payer",
                    label: "付钱最多的人",
                    title: topPayer.balance.member.displayName,
                    subtitle: `共享支出付款 ${money(
                      topPayer.balance.paidTotal,
                      ledgerCurrency,
                      locale,
                    )}`,
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
                    最贵{ledgerCategoryLabels[category]} ·{" "}
                    {dateLabel(entry.expenseDate, locale)}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold text-stone-950">
                    {entry.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-stone-500">
                    原始金额 {money(entry.originalAmount, entry.originalCurrency, locale)}
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
            还没有足够的互动记录。添加行程、上传记忆、标记照片或点评后，这里会生成贡献榜。
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
                  {item.count} 次
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {activeTab === "journey" && bestItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            还没有行程点评。打开任意行程卡片，点小星星就可以开始打分。
          </div>
        ) : null}

        {activeTab === "journey" && bestItems.length > 0 ? (
          <div className="mt-4 space-y-5">
            {bestByType.map(([type, items]) => (
              <div key={type}>
                <h3 className="text-sm font-black text-stone-900">
                  Best {typeLabels[type] ?? type}
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
                          {typeLabels[item.type] ?? item.type}
                        </span>
                        <span className="mt-0.5 block truncate text-sm font-semibold text-stone-950">
                          {item.title}
                        </span>
                        {item.subtitle ? (
                          <span className="mt-0.5 block truncate text-xs text-stone-500">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      <span className="self-center rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">
                        {item.rating.averageRating?.toFixed(1) ?? "0.0"} ·{" "}
                        {item.rating.ratingCount}人
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function HighlightsPage() {
  return <AuthGate>{() => <HighlightsContent />}</AuthGate>;
}
