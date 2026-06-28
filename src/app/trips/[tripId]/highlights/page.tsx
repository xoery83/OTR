"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { getPlannerV2, type PlannerV2Data } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import type {
  ItineraryEventType,
  ItineraryItemRatingSummary,
  ItineraryReservationType,
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

function dateLabel(value: string, locale: string) {
  if (value === "unscheduled") return locale === "zh-CN" ? "未安排" : "Unscheduled";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
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

function HighlightsContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const { locale } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [planner, setPlanner] = useState<PlannerV2Data>({ days: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadHighlights() {
      try {
        const tripData = await getTrip(tripId);
        const plannerData = await getPlannerV2(tripData);
        if (!isMounted) return;
        setTrip(tripData);
        setPlanner(plannerData);
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
          根据大家对行程和预订的点评，自动生成 Best 排行榜。
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
            <p className="text-sm font-black text-emerald-800">Best</p>
            <h2 className="text-xl font-semibold text-stone-950">行程排行榜</h2>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">
            {bestItems.length} 项
          </span>
        </div>

        {bestItems.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
            还没有行程点评。打开任意行程卡片，点小星星就可以开始打分。
          </div>
        ) : (
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
        )}
      </section>
    </div>
  );
}

export default function HighlightsPage() {
  return <AuthGate>{() => <HighlightsContent />}</AuthGate>;
}
