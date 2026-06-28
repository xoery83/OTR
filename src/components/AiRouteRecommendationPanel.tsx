"use client";

import { useEffect, useMemo, useState } from "react";
import { createItineraryEvent } from "@/lib/supabase/itinerary";
import type { PlannerV2Day } from "@/lib/supabase/planner-v2";
import { getErrorMessage } from "@/lib/errors";
import type { ItineraryEventType } from "@/types";

type RouteSegment = {
  startTime: string;
  endTime: string;
  name: string;
  location: string;
  distanceKm: number | null;
  playMinutes: number;
  transport: string;
  estimatedCost: string;
  highlights: string[];
  description: string;
  photoUrl: string;
};

type DayRouteRecommendation = {
  title: string;
  summary: string;
  heroImageUrl: string;
  segments: RouteSegment[];
};

const styleTags = [
  "休闲",
  "走马观花",
  "徒步",
  "购物",
  "大吃大喝",
  "跑步",
  "网红打卡",
];

function dateOnly(value: string | null | undefined) {
  return value?.slice(0, 10) ?? null;
}

function timeToIso(dayDate: string, time: string) {
  const match = time.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return `${dayDate}T09:00:00`;
  const hour = match[1].padStart(2, "0");
  const minute = match[2].padStart(2, "0");
  return `${dayDate}T${hour}:${minute}:00`;
}

function segmentType(segment: RouteSegment): ItineraryEventType {
  const text = `${segment.name} ${segment.description}`.toLowerCase();
  if (/午餐|晚餐|早餐|餐|food|restaurant/.test(text)) return "meal";
  if (/出发|返回|前往|车|drive|transfer|交通/.test(text)) return "transport";
  if (/购物|超市|shop|market/.test(text)) return "shopping";
  return "activity";
}

function segmentDescription(segment: RouteSegment) {
  return [
    segment.description.trim(),
    `距离：${segment.distanceKm ?? "待估"} km`,
    `停留：约 ${segment.playMinutes} 分钟`,
    `交通：${segment.transport}`,
    `预计费用：${segment.estimatedCost}`,
    stringArrayValue(segment.highlights).length > 0
      ? `特色：${stringArrayValue(segment.highlights).join("、")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function hotelAddress(
  reservation: PlannerV2Day["reservations"][number] | undefined,
) {
  return reservation?.locationName || reservation?.title || "";
}

function hotelReservations(plannerDay: PlannerV2Day | null | undefined) {
  return (plannerDay?.reservations ?? []).filter(
    (reservation) => reservation.reservationType === "hotel",
  );
}

function lodgingForNight(plannerDay: PlannerV2Day | null | undefined) {
  const dayDate = plannerDay?.day.dayDate;
  const hotels = hotelReservations(plannerDay);

  if (!dayDate || dayDate === "unscheduled") {
    return hotelAddress(hotels[0]);
  }

  const tonightHotel =
    hotels.find((reservation) => {
      const startDate = dateOnly(reservation.startsAt);
      const endDate = dateOnly(reservation.endsAt) ?? startDate;
      return Boolean(startDate && endDate && startDate <= dayDate && endDate > dayDate);
    }) ??
    hotels.find((reservation) => dateOnly(reservation.startsAt) === dayDate) ??
    hotels[0];

  return hotelAddress(tonightHotel);
}

function lodgingStartLocation(
  plannerDay: PlannerV2Day,
  previousPlannerDay?: PlannerV2Day | null,
) {
  const previousNightLocation = lodgingForNight(previousPlannerDay);
  if (previousNightLocation) return previousNightLocation;

  const dayDate = plannerDay.day.dayDate;
  const hotels = hotelReservations(plannerDay);

  if (dayDate === "unscheduled") {
    return hotelAddress(hotels[0]);
  }

  const previousNightHotel =
    hotels.find((reservation) => {
      const startDate = dateOnly(reservation.startsAt);
      const endDate = dateOnly(reservation.endsAt) ?? startDate;
      return Boolean(startDate && endDate && startDate < dayDate && endDate >= dayDate);
    }) ??
    hotels.find((reservation) => dateOnly(reservation.endsAt) === dayDate) ??
    hotels[0];

  return hotelAddress(previousNightHotel);
}

function lodgingEndLocation(plannerDay: PlannerV2Day) {
  return lodgingForNight(plannerDay);
}

function hasCarReservation(plannerDay: PlannerV2Day) {
  return plannerDay.reservations.some(
    (reservation) => reservation.reservationType === "car",
  );
}

function dayDateLabel(dayDate: string) {
  if (dayDate === "unscheduled") return "未安排日期";
  return dayDate;
}

function stringValue(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback: number | null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function stringArrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item).trim())
      .filter(Boolean);
  }
  const text = stringValue(value).trim();
  if (!text) return [];
  return text
    .split(/[、,，/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRecommendation(
  recommendation: DayRouteRecommendation,
): DayRouteRecommendation {
  const segments = Array.isArray(recommendation.segments)
    ? recommendation.segments
    : [];

  return {
    title: stringValue(recommendation.title, "最佳行程推荐"),
    summary: stringValue(recommendation.summary, ""),
    heroImageUrl: stringValue(recommendation.heroImageUrl, ""),
    segments: segments.map((segment, index) => ({
      startTime: stringValue(segment.startTime, index === 0 ? "09:00" : ""),
      endTime: stringValue(segment.endTime, ""),
      name: stringValue(segment.name, `推荐地点 ${index + 1}`),
      location: stringValue(segment.location, ""),
      distanceKm: numberValue(segment.distanceKm, null),
      playMinutes: numberValue(segment.playMinutes, 60) ?? 60,
      transport: stringValue(segment.transport, "待确认"),
      estimatedCost: stringValue(segment.estimatedCost, "待估"),
      highlights: stringArrayValue(segment.highlights),
      description: stringValue(segment.description, ""),
      photoUrl: stringValue(segment.photoUrl, ""),
    })),
  };
}

export function AiRouteRecommendationPanel({
  tripId,
  journeyName,
  destination,
  plannerDay,
  previousPlannerDay,
  onSaved,
  compact = false,
}: {
  tripId: string;
  journeyName: string;
  destination: string;
  plannerDay: PlannerV2Day;
  previousPlannerDay?: PlannerV2Day | null;
  onSaved?: () => void;
  compact?: boolean;
}) {
  const dayDate = plannerDay.day.dayDate;
  const defaultStartLocation = lodgingStartLocation(plannerDay, previousPlannerDay);
  const defaultEndLocation = lodgingEndLocation(plannerDay);
  const [isOpen, setIsOpen] = useState(false);
  const [startLocation, setStartLocation] = useState(defaultStartLocation);
  const [startTime, setStartTime] = useState("09:00");
  const [endLocation, setEndLocation] = useState(defaultEndLocation);
  const [endTime, setEndTime] = useState("18:00");
  const [driving, setDriving] = useState(hasCarReservation(plannerDay));
  const [selectedTags, setSelectedTags] = useState<string[]>(["休闲"]);
  const [notes, setNotes] = useState("");
  const [recommendation, setRecommendation] =
    useState<DayRouteRecommendation | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStartLocation(defaultStartLocation);
    setEndLocation(defaultEndLocation);
    setDriving(hasCarReservation(plannerDay));
    setRecommendation(null);
    setMessage(null);
    setError(null);
  }, [defaultEndLocation, defaultStartLocation, plannerDay]);

  const canGenerate =
    dayDate !== "unscheduled" &&
    startLocation.trim().length > 0 &&
    startTime.trim().length > 0 &&
    endLocation.trim().length > 0 &&
    endTime.trim().length > 0;

  const sourceLabel = useMemo(
    () =>
      [
        "AI_ROUTE_RECOMMENDATION",
        `date=${dayDate}`,
        `start=${startLocation}`,
        `end=${endLocation}`,
        `tags=${selectedTags.join(",")}`,
        notes.trim() ? `notes=${notes.trim()}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    [dayDate, endLocation, notes, selectedTags, startLocation],
  );

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((value) => value !== tag)
        : [...current, tag],
    );
  }

  async function generateRecommendation() {
    if (!canGenerate) return;
    setIsGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ai/recommend-day-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journeyName,
          destination,
          date: dayDate,
          startLocation,
          startTime,
          endLocation,
          endTime,
          driving,
          tags: selectedTags,
          notes,
        }),
      });
      const payload = (await response.json()) as {
        recommendation?: DayRouteRecommendation;
        error?: string;
      };
      if (!response.ok || !payload.recommendation) {
        throw new Error(payload.error || "无法生成推荐行程。");
      }
      setRecommendation(normalizeRecommendation(payload.recommendation));
    } catch (routeError) {
      setError(getErrorMessage(routeError, "无法生成推荐行程。"));
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveRecommendation() {
    if (!recommendation || dayDate === "unscheduled") return;
    setIsSaving(true);
    setError(null);
    try {
      await Promise.all(
        recommendation.segments.map((segment) =>
          createItineraryEvent({
            tripId,
            tripDayId: plannerDay.day.id.startsWith("synthetic-")
              ? null
              : plannerDay.day.id,
            title: segment.name,
            description: segmentDescription(segment),
            eventType: segmentType(segment),
            locationName: segment.location,
            plannedStart: timeToIso(dayDate, segment.startTime),
            plannedEnd: timeToIso(dayDate, segment.endTime),
            bookingReference: "",
            url: "",
            sourceText: `${sourceLabel}\nsegment=${segment.name}`,
            confidence: 0.82,
            needsReview: true,
            isEstimatedTime: true,
            dateConfidence: 0.95,
            timeConfidence: 0.7,
            locationConfidence: 0.75,
          }),
        ),
      );
      setMessage(`已加入 ${recommendation.segments.length} 条 AI 推荐行程。`);
      onSaved?.();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "无法保存推荐行程。"));
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <section
        className={`rounded-3xl border border-emerald-100 bg-emerald-50 p-4 ${
          compact ? "" : "shadow-sm"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
              AI 建议行程
            </p>
            <h3 className="mt-1 text-lg font-black text-stone-950">
              最佳行程推荐
            </h3>
            <p className="mt-1 text-sm font-semibold text-stone-600">
              单日版本 · {dayDateLabel(dayDate)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-black text-white shadow-sm"
          >
            生成推荐
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
            AI 建议行程
          </p>
          <h3 className="mt-1 text-xl font-black text-stone-950">
            最佳行程推荐
          </h3>
          <p className="mt-1 text-sm font-semibold text-stone-500">
            单日｜{dayDateLabel(dayDate)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
        >
          收起
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">
            当日出发地址
          </span>
          <input
            value={startLocation}
            onChange={(event) => setStartLocation(event.target.value)}
            placeholder="例如：今晚住宿 / 酒店地址"
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm font-semibold text-stone-950 outline-none focus:border-emerald-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">
            想几点左右出发
          </span>
          <input
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            type="time"
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm font-semibold text-stone-950 outline-none focus:border-emerald-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">
            当日终点地址
          </span>
          <input
            value={endLocation}
            onChange={(event) => setEndLocation(event.target.value)}
            placeholder="例如：当晚住宿 / 终点"
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm font-semibold text-stone-950 outline-none focus:border-emerald-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-bold text-stone-600">
            最晚几点到达
          </span>
          <input
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            type="time"
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm font-semibold text-stone-950 outline-none focus:border-emerald-300"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-bold text-stone-600">补充要求</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="例如：某个地方今天必须去；下午 2 点要回家做饭；其他时间帮我安排。"
          rows={3}
          className="w-full resize-none rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm font-semibold leading-6 text-stone-950 outline-none focus:border-emerald-300"
        />
      </label>

      <div className="rounded-2xl bg-emerald-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-black text-emerald-900">当天是否自驾？</p>
          <button
            type="button"
            onClick={() => setDriving((current) => !current)}
            className={`rounded-full px-4 py-2 text-xs font-black ${
              driving
                ? "bg-emerald-700 text-white"
                : "bg-white text-stone-600"
            }`}
          >
            {driving ? "自驾" : "不自驾"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {styleTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full px-3 py-2 text-xs font-black ${
                selectedTags.includes(tag)
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-stone-600"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void generateRecommendation()}
        disabled={!canGenerate || isGenerating}
        className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
      >
        {isGenerating ? "正在生成推荐..." : "生成 1 套单日方案"}
      </button>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          {message}
        </p>
      ) : null}

      {recommendation ? (
        <div className="space-y-4">
          <div
            className="overflow-hidden rounded-3xl border border-stone-200 bg-stone-950 text-white shadow-sm"
            style={{
              backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.78)), url("${recommendation.heroImageUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="min-h-[360px] p-5">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100">
                OTR 推荐长图
              </p>
              <h4 className="mt-2 text-2xl font-black">
                {recommendation.title}
              </h4>
              <p className="mt-2 max-w-lg text-sm font-semibold leading-6 text-white/90">
                {recommendation.summary}
              </p>
              <div className="mt-5 space-y-3">
                {recommendation.segments.map((segment, index) => (
                  <div
                    key={`${segment.name}-${index}`}
                    className="rounded-2xl bg-white/90 p-3 text-stone-950 backdrop-blur"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black text-emerald-700">
                          {segment.startTime} - {segment.endTime}
                        </p>
                        <h5 className="mt-1 text-base font-black">
                          {segment.name}
                        </h5>
                        <p className="text-xs font-semibold text-stone-500">
                          {segment.location}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800">
                        {segment.distanceKm ?? "?"} km
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-stone-700">
                      {segment.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700">
                        玩 {segment.playMinutes} 分钟
                      </span>
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700">
                        {segment.transport}
                      </span>
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700">
                        {segment.estimatedCost}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void saveRecommendation()}
            disabled={isSaving}
            className="w-full rounded-2xl bg-stone-950 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
          >
            {isSaving
              ? "正在加入当天卡片..."
              : `使用推荐并加入当天卡片（${recommendation.segments.length} 条）`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
