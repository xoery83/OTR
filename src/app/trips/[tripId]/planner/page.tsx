"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { PlannerDayCard } from "@/components/PlannerDayCard";
import {
  readTodayScopedValue,
  writeTodayScopedValue,
} from "@/lib/day-view-storage";
import { getErrorMessage } from "@/lib/errors";
import { getActiveJourneyMembers } from "@/lib/journeys/stats";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getLedgerData } from "@/lib/supabase/ledger";
import { getPlannerV2, type PlannerV2Data } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import type { JourneyMember, LedgerEntry, Trip } from "@/types";

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

function PlannerContent() {
  const params = useParams<{ tripId: string }>();
  const searchParams = useSearchParams();
  const tripId = params.tripId;
  const router = useRouter();
  const requestedDate = searchParams.get("date");
  const { locale, t } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerBaseCurrency, setLedgerBaseCurrency] = useState("NZD");
  const [planner, setPlanner] = useState<PlannerV2Data>({ days: [] });
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dateStripRef = useRef<HTMLDivElement | null>(null);

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
  const nextDay = planner.days[selectedIndex + 1] ?? null;
  const activeMembers = getActiveJourneyMembers(members);
  const selectedDayMapHref =
    selectedDay && selectedDay.day.dayDate !== "unscheduled"
      ? `/trips/${tripId}/map?date=${selectedDay.day.dayDate}`
      : `/trips/${tripId}/map`;

  function chooseDay(dayId: string) {
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

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white p-5">
        {t("planner.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
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
              onClick={() => router.push(`/trips/${tripId}/planner/import`)}
              className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm"
              title={t("planner.import")}
            >
              {t("planner.import")}
            </button>
          </div>
        </div>
      </section>

      {planner.days.length > 0 ? (
        <section className="sticky top-16 z-10 -mx-5 border-y border-stone-200 bg-[#f7f3ea]/95 px-5 py-1.5 backdrop-blur md:top-0">
          <div ref={dateStripRef} className="flex gap-2 overflow-x-auto">
            {planner.days.map((plannerDay) => {
              const selected = plannerDay.day.id === selectedDay?.day.id;
              const official = isOfficialTripDay(
                plannerDay.day.dayDate,
                trip,
              );
              return (
                <button
                  key={plannerDay.day.id}
                  data-day-id={plannerDay.day.id}
                  type="button"
                  onClick={() => chooseDay(plannerDay.day.id)}
                  className={`min-w-12 rounded-xl border px-2 py-1 text-center transition ${
                    selected
                      ? official
                        ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                        : "border-stone-500 bg-stone-700 text-white shadow-sm"
                      : official
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-dashed border-stone-200 bg-white/70 text-stone-400"
                  }`}
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

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {selectedDay ? (
        <section>
          <PlannerDayCard
            tripId={tripId}
            plannerDay={selectedDay}
            journeyMembers={activeMembers}
            ledgerEntries={ledgerEntries}
            ledgerBaseCurrency={ledgerBaseCurrency}
            preserveOriginalPhotos={trip?.photoStorageStatus === "connected"}
            onLedgerEntryCreated={async () => {
              const data = await getLedgerData(tripId);
              setLedgerEntries(data.entries);
              setLedgerBaseCurrency(data.ledger.baseCurrency);
            }}
            onPlannerChanged={refreshPlanner}
            nextDay={nextDay}
            mapHref={selectedDayMapHref}
          />
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-600">
          {t("planner.empty.days")}
        </div>
      )}
    </div>
  );
}

export default function PlannerPage() {
  return <AuthGate>{() => <PlannerContent />}</AuthGate>;
}
