"use client";

import Link from "next/link";
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { PlannerDayCard } from "@/components/PlannerDayCard";
import {
  readTodayScopedValue,
  writeTodayScopedValue,
} from "@/lib/day-view-storage";
import { getErrorMessage } from "@/lib/errors";
import { formatJourneyTime } from "@/lib/format";
import { getActiveJourneyMembers } from "@/lib/journeys/stats";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getLedgerData } from "@/lib/supabase/ledger";
import { getPlannerV2, type PlannerV2Data } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import type {
  ItineraryEvent,
  ItineraryReservation,
  JourneyMember,
  LedgerEntry,
  Trip,
} from "@/types";

async function loadPlannerData(tripId: string) {
  const [tripData, members] = await Promise.all([
    getTrip(tripId),
    getJourneyMembers(tripId),
  ]);
  const [plannerData, ledgerData] = await Promise.all([
    getPlannerV2(tripData),
    getLedgerData(tripId).catch(() => null),
  ]);
  return {
    tripData,
    plannerData,
    members,
    ledgerEntries: ledgerData?.entries ?? [],
    ledgerBaseCurrency: ledgerData?.ledger.baseCurrency ?? "NZD",
  };
}

function compactDate(value: string, locale: string) {
  if (value === "unscheduled") return locale === "zh-CN" ? "任意" : "Any";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function longDateLabel(value: string, locale: string) {
  if (value === "unscheduled") return locale === "zh-CN" ? "任意日期" : "Any date";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function timeLabel(value: string | null | undefined, locale: string) {
  if (!value) return locale === "zh-CN" ? "时间待定" : "Time TBD";
  return formatJourneyTime(value, locale) || (locale === "zh-CN" ? "时间待定" : "Time TBD");
}

function isOfficialTripDay(value: string, trip: Trip | null) {
  if (value === "unscheduled" || !trip?.startDate || !trip.endDate) {
    return false;
  }
  return value >= trip.startDate && value <= trip.endDate;
}

function memberInitial(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

function getDefaultDayId(days: PlannerV2Data["days"]) {
  if (days.length === 0) return null;

  const today = todayKey();
  const exact = days.find((day) => day.day.dayDate === today);
  if (exact) return exact.day.id;

  const datedDays = days.filter((day) => day.day.dayDate !== "unscheduled");
  if (datedDays.length === 0) return days[0]?.day.id ?? null;

  const todayTime = new Date(`${today}T00:00:00`).getTime();
  const closest = datedDays.reduce((best, day) => {
    const bestDistance = Math.abs(
      new Date(`${best.day.dayDate}T00:00:00`).getTime() - todayTime,
    );
    const dayDistance = Math.abs(
      new Date(`${day.day.dayDate}T00:00:00`).getTime() - todayTime,
    );

    return dayDistance < bestDistance ? day : best;
  });

  return closest.day.id;
}

function getStoredDayId(tripId: string, days: PlannerV2Data["days"]) {
  const storedDate = readTodayScopedValue(`otr:planner-day:${tripId}`);
  if (!storedDate) return null;
  return days.find((day) => day.day.dayDate === storedDate)?.day.id ?? null;
}

function getQueryDayId(date: string | null, days: PlannerV2Data["days"]) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return days.find((day) => day.day.dayDate === date)?.day.id ?? null;
}

type PlannerSearchResult = {
  id: string;
  itemId: string;
  dayId: string;
  dayDate: string;
  dayTag: string;
  timeText: string;
  title: string;
  subtitle: string;
  typeLabel: string;
  searchableText: string;
};

function normalizeSearchText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function eventSearchText(event: ItineraryEvent) {
  return [
    event.title,
    event.description,
    event.eventType,
    event.locationName,
    event.bookingReference,
    event.sourceText,
    ...event.participants.map((participant) => participant.name),
  ].join(" ");
}

function reservationSearchText(reservation: ItineraryReservation) {
  return [
    reservation.title,
    reservation.provider,
    reservation.reservationType,
    reservation.locationName,
    reservation.confirmationCode,
    reservation.sourceText,
    ...reservation.participants.map((participant) => participant.name),
  ].join(" ");
}

function PlannerContent() {
  const params = useParams<{ tripId: string }>();
  const searchParams = useSearchParams();
  const tripId = params.tripId;
  const router = useRouter();
  const requestedDate = searchParams.get("date");
  const requestedItemId = searchParams.get("item");
  const { locale, t } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerBaseCurrency, setLedgerBaseCurrency] = useState("NZD");
  const [planner, setPlanner] = useState<PlannerV2Data>({ days: [] });
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [manualFocusedPlannerItemId, setManualFocusedPlannerItemId] = useState<
    string | null
  >(null);
  const [plannerSearchQuery, setPlannerSearchQuery] = useState("");
  const [isMobilePlannerSearchActive, setIsMobilePlannerSearchActive] =
    useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const plannerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const dateStripRef = useRef<HTMLDivElement | null>(null);
  const selectedDayCardRef = useRef<HTMLElement | null>(null);
  const pendingDayScrollResetRef = useRef(false);
  const suppressPlannerNavRestoreUntilRef = useRef(0);
  const keepPlannerImmersiveDuringResetRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    async function loadPlanner() {
      try {
        const {
          tripData,
          plannerData,
          members: memberData,
          ledgerEntries: entryData,
          ledgerBaseCurrency: baseCurrency,
        } =
          await loadPlannerData(tripId);
        if (isMounted) {
          setTrip(tripData);
          setPlanner(plannerData);
          setMembers(memberData);
          setLedgerEntries(entryData);
          setLedgerBaseCurrency(baseCurrency);
          setSelectedDayId(
            getQueryDayId(requestedDate, plannerData.days) ??
              getStoredDayId(tripId, plannerData.days) ??
              getDefaultDayId(plannerData.days),
          );
        }
      } catch (plannerError) {
        if (isMounted) {
          setError(getErrorMessage(plannerError, t("planner.error.load")));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadPlanner();
    return () => {
      isMounted = false;
    };
  }, [requestedDate, tripId, t]);

  const selectedIndex = useMemo(() => {
    const index = planner.days.findIndex((day) => day.day.id === selectedDayId);
    return index >= 0 ? index : 0;
  }, [planner.days, selectedDayId]);
  const selectedDay = planner.days[selectedIndex] ?? null;
  const previousSelectedDay =
    selectedIndex > 0 ? planner.days[selectedIndex - 1] ?? null : null;
  const activeMembers = getActiveJourneyMembers(members);
  const focusedPlannerItemId = manualFocusedPlannerItemId ?? requestedItemId;
  const trimmedPlannerSearchQuery = plannerSearchQuery.trim();
  const plannerSearchResults = useMemo(() => {
    const query = normalizeSearchText(trimmedPlannerSearchQuery);
    if (!query) return [];

    return planner.days
      .flatMap((plannerDay) => {
        const dayTag =
          plannerDay.dayTag ??
          t("planner.day.short", { number: plannerDay.dayNumber });
        const dateText = longDateLabel(plannerDay.day.dayDate, locale);
        const activities: PlannerSearchResult[] = plannerDay.activities
          .filter((activity) => activity.status !== "cancelled")
          .map((activity) => {
            const timeText = timeLabel(activity.plannedStart, locale);
            return {
              id: `event-${plannerDay.day.id}-${activity.id}`,
              itemId: `activity-${activity.id}`,
              dayId: plannerDay.day.id,
              dayDate: plannerDay.day.dayDate,
              dayTag,
              timeText,
              title: activity.title,
              subtitle: activity.locationName || activity.description || "",
              typeLabel: t("planner.search.activity"),
              searchableText: [
                dayTag,
                dateText,
                timeText,
                eventSearchText(activity),
              ].join(" "),
            };
          });
        const reservations: PlannerSearchResult[] = plannerDay.reservations
          .filter((reservation) => reservation.status !== "cancelled")
          .map((reservation) => {
            const timeText = timeLabel(reservation.startsAt, locale);
            return {
              id: `reservation-${plannerDay.day.id}-${reservation.id}`,
              itemId: `reservation-${reservation.id}`,
              dayId: plannerDay.day.id,
              dayDate: plannerDay.day.dayDate,
              dayTag,
              timeText,
              title: reservation.title,
              subtitle:
                reservation.locationName || reservation.provider || reservation.sourceText || "",
              typeLabel: t("planner.search.reservation"),
              searchableText: [
                dayTag,
                dateText,
                timeText,
                reservationSearchText(reservation),
              ].join(" "),
            };
          });

        return [...activities, ...reservations];
      })
      .filter((result) => normalizeSearchText(result.searchableText).includes(query))
      .sort((left, right) => {
        const dateOrder = left.dayDate.localeCompare(right.dayDate);
        if (dateOrder) return dateOrder;
        return left.timeText.localeCompare(right.timeText);
      })
      .slice(0, 40);
  }, [locale, planner.days, t, trimmedPlannerSearchQuery]);
  const selectedDayMapHref =
    selectedDay && selectedDay.day.dayDate !== "unscheduled"
      ? `/trips/${tripId}/map?date=${selectedDay.day.dayDate}`
      : `/trips/${tripId}/map`;

  function scrollSelectedDayToTop() {
    const keepImmersive = keepPlannerImmersiveDuringResetRef.current;
    if (keepImmersive) {
      suppressPlannerNavRestoreUntilRef.current = Date.now() + 700;
      document.body.classList.add("otr-planner-immersive");
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = selectedDayCardRef.current;
        if (!target) return;

        const dateStripSection = dateStripRef.current?.closest("section");
        const dateStripRect = dateStripSection?.getBoundingClientRect();
        const topOffset = keepImmersive
          ? (dateStripRect?.height ?? 0)
          : Math.max(0, dateStripRect?.bottom ?? 0);
        const targetTop = target.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
          top: Math.max(0, targetTop - topOffset - 12),
          behavior: "instant",
        });
      });
    });
  }

  function chooseDay(dayId: string, options?: { resetScroll?: boolean }) {
    if (options?.resetScroll) {
      const keepImmersive =
        document.body.classList.contains("otr-planner-immersive");
      pendingDayScrollResetRef.current = true;
      keepPlannerImmersiveDuringResetRef.current = keepImmersive;
      if (keepImmersive) {
        suppressPlannerNavRestoreUntilRef.current = Date.now() + 700;
        document.body.classList.add("otr-planner-immersive");
      }
    }
    setSelectedDayId(dayId);
    const day = planner.days.find((plannerDay) => plannerDay.day.id === dayId);
    if (day) {
      writeTodayScopedValue(`otr:planner-day:${tripId}`, day.day.dayDate);
      window.dispatchEvent(
        new CustomEvent("journey:workspace-day-change", {
          detail: { tripId, day: day.day.dayDate },
        }),
      );
    }
  }

  useEffect(() => {
    if (!isMobilePlannerSearchActive) return;

    document.body.classList.add("otr-mobile-search-active");
    document.body.classList.remove("otr-planner-immersive");

    return () => {
      document.body.classList.remove("otr-mobile-search-active");
    };
  }, [isMobilePlannerSearchActive]);

  function isMobileViewport() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function openMobilePlannerSearchFromPointer(
    event: PointerEvent<HTMLInputElement>,
  ) {
    if (!isMobileViewport() || isMobilePlannerSearchActive) return;
    event.preventDefault();
    flushSync(() => setIsMobilePlannerSearchActive(true));
    plannerSearchInputRef.current?.focus({ preventScroll: true });
  }

  function openMobilePlannerSearchFromFocus() {
    if (isMobileViewport()) {
      setIsMobilePlannerSearchActive(true);
    }
  }

  function closeMobilePlannerSearch() {
    setPlannerSearchQuery("");
    setIsMobilePlannerSearchActive(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function jumpToSearchResult(result: PlannerSearchResult) {
    setManualFocusedPlannerItemId(result.itemId);
    chooseDay(result.dayId);
    if (isMobilePlannerSearchActive) {
      setPlannerSearchQuery("");
      setIsMobilePlannerSearchActive(false);
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.requestAnimationFrame(() => {
      selectedDayCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  const refreshPlanner = useCallback(async () => {
    const {
      tripData,
      plannerData,
      members: memberData,
      ledgerEntries: entryData,
      ledgerBaseCurrency: baseCurrency,
    } = await loadPlannerData(tripId);
    setTrip(tripData);
    setPlanner(plannerData);
    setMembers(memberData);
    setLedgerEntries(entryData);
    setLedgerBaseCurrency(baseCurrency);
  }, [tripId]);

  useEffect(() => {
    function refreshAfterCapture() {
      void refreshPlanner();
    }

    window.addEventListener("otr:capture-completed", refreshAfterCapture);
    return () => {
      window.removeEventListener("otr:capture-completed", refreshAfterCapture);
    };
  }, [refreshPlanner]);

  useEffect(() => {
    if (!selectedDayId) return;
    const selectedButton = dateStripRef.current?.querySelector(
      `[data-day-id="${selectedDayId}"]`,
    );
    selectedButton?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedDayId]);

  useEffect(() => {
    if (!selectedDayId || !pendingDayScrollResetRef.current) return;
    pendingDayScrollResetRef.current = false;
    scrollSelectedDayToTop();
  }, [selectedDayId]);

  useEffect(() => {
    document.body.classList.remove("otr-planner-immersive");
    if (isMobilePlannerSearchActive) {
      return;
    }

    let previousY = window.scrollY;
    let isImmersive = false;
    let scrollIntent = 0;

    const setImmersive = (enabled: boolean) => {
      if (isImmersive === enabled) return;
      isImmersive = enabled;
      document.body.classList.toggle("otr-planner-immersive", enabled);
    };

    const handleScroll = () => {
      if (window.innerWidth >= 768) {
        setImmersive(false);
        previousY = window.scrollY;
        return;
      }

      const currentY = window.scrollY;
      const delta = currentY - previousY;
      if (Math.abs(delta) < 3) return;

      if (
        keepPlannerImmersiveDuringResetRef.current &&
        Date.now() < suppressPlannerNavRestoreUntilRef.current
      ) {
        setImmersive(true);
        previousY = currentY;
        return;
      }

      if (currentY < 80) {
        setImmersive(false);
        scrollIntent = 0;
      } else if (delta > 0) {
        scrollIntent = Math.min(80, Math.max(0, scrollIntent) + delta);
        if (scrollIntent > 28) {
          setImmersive(true);
        }
      } else {
        scrollIntent = Math.max(-80, Math.min(0, scrollIntent) + delta);
        if (scrollIntent < -42) {
          setImmersive(false);
        }
      }

      previousY = currentY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      document.body.classList.remove("otr-planner-immersive");
    };
  }, [isMobilePlannerSearchActive]);

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white p-5">
        {t("planner.loading")}
      </div>
    );
  }

  return (
    <div
      className={
        isMobilePlannerSearchActive ? "space-y-0 md:space-y-4" : "space-y-4"
      }
    >
      <section
        className={
          isMobilePlannerSearchActive
            ? "contents md:block md:rounded-3xl md:border md:border-stone-200 md:bg-white md:px-4 md:py-3 md:shadow-sm"
            : "rounded-3xl border border-stone-200 bg-white px-4 py-3 shadow-sm"
        }
      >
        <div
          className={`flex items-center justify-between gap-3 ${
            isMobilePlannerSearchActive ? "hidden md:flex" : ""
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex max-w-48 items-center -space-x-2 overflow-hidden sm:max-w-64">
              {activeMembers.slice(0, 6).map((member) => (
                <Link
                  key={member.id}
                  href={
                    member.userId
                      ? `/people/${member.userId}`
                      : `/trips/${tripId}/people`
                  }
                  className={`grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold ring-2 ring-white ${
                    member.userId
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-stone-200 text-stone-500"
                  }`}
                  title={
                    member.userId
                      ? member.displayName
                      : t("planner.member.notLinked", {
                          name: member.displayName,
                        })
                  }
                >
                  {member.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    memberInitial(member.displayName)
                  )}
                </Link>
              ))}
              {activeMembers.length > 6 ? (
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-100 text-xs font-bold text-stone-500 ring-2 ring-white">
                  +{activeMembers.length - 6}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const dayDate = selectedDay?.day.dayDate;
                const importHref =
                  dayDate && dayDate !== "unscheduled"
                    ? `/trips/${tripId}/planner/import?date=${dayDate}`
                    : `/trips/${tripId}/planner/import`;
                router.push(importHref);
              }}
              className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm"
              title={t("planner.import")}
            >
              {t("planner.import")}
            </button>
          </div>
        </div>
        <div
          className={`flex items-center gap-2 ${
            isMobilePlannerSearchActive
              ? "fixed inset-x-0 top-0 z-[2147482600] border-b border-stone-200 bg-white p-3 shadow-lg md:static md:mt-3 md:rounded-2xl md:border-0 md:bg-stone-50 md:p-2 md:shadow-none"
              : "mt-3 rounded-2xl bg-stone-50 p-2"
          }`}
        >
          <input
            ref={plannerSearchInputRef}
            type="search"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            value={plannerSearchQuery}
            onChange={(event) => setPlannerSearchQuery(event.target.value)}
            onPointerDown={openMobilePlannerSearchFromPointer}
            onFocus={openMobilePlannerSearchFromFocus}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.currentTarget.blur();
              }
            }}
            placeholder={t("planner.search.placeholder")}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-base font-semibold text-stone-950 outline-none placeholder:text-stone-400 focus:border-emerald-300 md:min-h-10 md:text-sm"
          />
          {trimmedPlannerSearchQuery ? (
            <button
              type="button"
              onClick={() => setPlannerSearchQuery("")}
              className="shrink-0 rounded-full bg-white px-3 py-2 text-xs font-bold text-stone-600 shadow-sm"
            >
              {t("planner.search.clear")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={closeMobilePlannerSearch}
            className={`shrink-0 rounded-full px-3 py-2 text-sm font-black text-emerald-800 md:hidden ${
              isMobilePlannerSearchActive ? "inline-flex" : "hidden"
            }`}
          >
            {t("common.cancel")}
          </button>
        </div>
      </section>

      {isMobilePlannerSearchActive ? <div className="h-[4.5rem] md:hidden" /> : null}

      {trimmedPlannerSearchQuery || isMobilePlannerSearchActive ? (
        <section
          className={`border-stone-200 bg-white shadow-sm ${
            isMobilePlannerSearchActive
              ? "rounded-none border-0 p-3 md:rounded-3xl md:border"
              : "rounded-3xl border p-3"
          }`}
        >
          <div className="flex items-center justify-between gap-3 px-1">
            <div>
              <h2 className="text-sm font-black text-stone-950">
                {t("planner.search.resultsTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-stone-500">
                {t("planner.search.resultCount", {
                  count: plannerSearchResults.length,
                })}
              </p>
            </div>
          </div>
          {plannerSearchResults.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
              {t("planner.search.empty")}
            </div>
          ) : (
            <div
              className={`mt-3 space-y-2 overflow-y-auto pr-1 ${
                isMobilePlannerSearchActive
                  ? "max-h-[calc(100dvh-9rem)] md:max-h-80"
                  : "max-h-80"
              }`}
            >
              {plannerSearchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => jumpToSearchResult(result)}
                  className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                    selectedDayId === result.dayId
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-stone-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-wide text-emerald-800">
                        {result.dayTag} · {longDateLabel(result.dayDate, locale)} ·{" "}
                        {result.timeText}
                      </p>
                      <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-stone-950">
                        {result.title}
                      </h3>
                      {result.subtitle ? (
                        <p className="mt-1 line-clamp-1 text-xs text-stone-500">
                          {result.subtitle}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-[11px] font-bold text-stone-600">
                      {result.typeLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-bold text-emerald-700">
                    {t("planner.search.openAndExpand")}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {planner.days.length > 0 && !isMobilePlannerSearchActive ? (
        <section className="otr-planner-date-strip sticky top-16 z-10 border-y border-stone-200 bg-[#f7f3ea]/95 py-1.5 backdrop-blur md:top-0">
          <div ref={dateStripRef} className="flex gap-2 overflow-x-auto">
            {planner.days.map((plannerDay) => {
              const selected = plannerDay.day.id === selectedDay?.day.id;
              const isToday = plannerDay.day.dayDate === todayKey();
              const official = isOfficialTripDay(
                plannerDay.day.dayDate,
                trip,
              );
              return (
                <button
                  key={plannerDay.day.id}
                  data-day-id={plannerDay.day.id}
                  type="button"
                  onClick={() =>
                    chooseDay(plannerDay.day.id, { resetScroll: true })
                  }
                  className={`min-w-12 rounded-xl border px-2 py-1 text-center transition ${
                    selected
                      ? official
                        ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                        : "border-stone-500 bg-stone-700 text-white shadow-sm"
                      : isToday
                        ? "border-amber-300 bg-amber-50 text-amber-900 ring-2 ring-amber-200"
                      : official
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-dashed border-stone-200 bg-white/70 text-stone-400"
                  } ${selected && isToday ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-[#f7f3ea]" : ""}`}
                  title={
                    official
                      ? t("planner.day.official")
                      : t("planner.day.buffer")
                  }
                >
                  <p className="text-xs font-bold">
                    {plannerDay.dayTag ??
                      t("planner.day.short", { number: plannerDay.dayNumber })}
                  </p>
                  <p className="text-[11px] leading-tight opacity-80">
                    {compactDate(plannerDay.day.dayDate, locale)}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {error && !isMobilePlannerSearchActive ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {!isMobilePlannerSearchActive ? (
        selectedDay ? (
          <section ref={selectedDayCardRef}>
            <PlannerDayCard
              tripId={tripId}
              plannerDay={selectedDay}
              journeyMembers={activeMembers}
              ledgerEntries={ledgerEntries}
              ledgerBaseCurrency={ledgerBaseCurrency}
              journeyName={trip?.name ?? ""}
              journeyDestination={trip?.destination ?? ""}
              previousPlannerDay={previousSelectedDay}
              preserveOriginalPhotos={trip?.photoStorageStatus === "connected"}
              onLedgerEntryCreated={async () => {
                const data = await getLedgerData(tripId);
                setLedgerEntries(data.entries);
                setLedgerBaseCurrency(data.ledger.baseCurrency);
              }}
              onPlannerChanged={refreshPlanner}
              mapHref={selectedDayMapHref}
              focusedItemId={focusedPlannerItemId}
            />
          </section>
        ) : (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-600">
            {t("planner.empty.days")}
          </div>
        )
      ) : null}
    </div>
  );
}

export default function PlannerPage() {
  return <AuthGate>{() => <PlannerContent />}</AuthGate>;
}
