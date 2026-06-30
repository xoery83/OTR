"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { TripCard } from "@/components/TripCard";
import { compareTripsByStartDateAsc, getJourneyStatus } from "@/lib/journeys/status";
import { getJourneyParticipantCount } from "@/lib/journeys/stats";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import {
  getTripMemorySummary,
  type TripMemorySummary,
} from "@/lib/supabase/memories";
import { getPlannerV2, type PlannerV2Data } from "@/lib/supabase/planner-v2";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { ItineraryEvent, ItineraryReservation, Trip } from "@/types";

type JourneyItem = {
  trip: Trip;
  memorySummary: TripMemorySummary;
  memberCount: number;
  planner: PlannerV2Data;
};

type SearchResult = {
  id: string;
  kind: "journey" | "itinerary";
  title: string;
  subtitle: string;
  meta: string;
  href: string;
  searchableText: string;
};

function normalizeSearchText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function dateLabel(value: string, locale: string) {
  if (value === "unscheduled") return locale === "zh-CN" ? "任意日期" : "Any date";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function timeLabel(value: string | null | undefined, locale: string) {
  if (!value) return locale === "zh-CN" ? "时间待定" : "Time TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === "zh-CN" ? "时间待定" : "Time TBD";
  return date.toLocaleTimeString(locale === "zh-CN" ? "zh-CN" : "en", {
    hour: "numeric",
    minute: "2-digit",
  });
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

function TripsContent() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTrips() {
      try {
        const trips = await getTripsForCurrentUser();
        const loaded = await Promise.all(
          trips.map(async (trip) => {
            const [memorySummary, members, planner] = await Promise.all([
              getTripMemorySummary(trip.id),
              getJourneyMembers(trip.id),
              getPlannerV2(trip, { includeMemories: false }).catch(() => ({ days: [] })),
            ]);
            return {
              trip,
              memorySummary,
              memberCount: getJourneyParticipantCount(members),
              planner,
            };
          }),
        );

        if (isMounted) {
          setItems(loaded);
        }
      } catch (tripsError) {
        if (isMounted) {
          setError(
            tripsError instanceof Error
              ? tripsError.message
              : t("trips.error.load"),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadTrips();

    return () => {
      isMounted = false;
    };
  }, [t]);

  const groups = useMemo(
    () => ({
      active: items
        .filter((item) => getJourneyStatus(item.trip) === "active")
        .sort((a, b) => compareTripsByStartDateAsc(a.trip, b.trip)),
      upcoming: items
        .filter((item) => getJourneyStatus(item.trip) === "upcoming")
        .sort((a, b) => compareTripsByStartDateAsc(a.trip, b.trip)),
      completed: items
        .filter((item) => getJourneyStatus(item.trip) === "completed")
        .sort((a, b) => compareTripsByStartDateAsc(a.trip, b.trip)),
    }),
    [items],
  );
  const trimmedSearchQuery = searchQuery.trim();
  const searchResults = useMemo(() => {
    const query = normalizeSearchText(trimmedSearchQuery);
    if (!query) return [];

    return items
      .flatMap((item) => {
        const journeyResult: SearchResult = {
          id: `journey-${item.trip.id}`,
          kind: "journey",
          title: item.trip.name,
          subtitle: item.trip.destination || t("tripCard.destinationTbd"),
          meta: t("trips.search.journey"),
          href: `/trips/${item.trip.id}`,
          searchableText: [
            item.trip.name,
            item.trip.destination,
            item.trip.startDate,
            item.trip.endDate,
          ].join(" "),
        };

        const itineraryResults = item.planner.days.flatMap((plannerDay) => {
          const dayTag =
            plannerDay.dayTag ??
            t("planner.day.short", { number: plannerDay.dayNumber });
          const dayDateLabel = dateLabel(plannerDay.day.dayDate, locale);
          const activityResults: SearchResult[] = plannerDay.activities
            .filter((activity) => activity.status !== "cancelled")
            .map((activity) => {
              const time = timeLabel(activity.plannedStart, locale);
              const itemId = `activity-${activity.id}`;
              return {
                id: `activity-${item.trip.id}-${activity.id}`,
                kind: "itinerary",
                title: activity.title,
                subtitle: activity.locationName || activity.description || item.trip.name,
                meta: `${item.trip.name} · ${dayTag} · ${dayDateLabel} · ${time}`,
                href: `/trips/${item.trip.id}/planner?date=${plannerDay.day.dayDate}&item=${itemId}`,
                searchableText: [
                  item.trip.name,
                  item.trip.destination,
                  dayTag,
                  dayDateLabel,
                  time,
                  eventSearchText(activity),
                ].join(" "),
              };
            });
          const reservationResults: SearchResult[] = plannerDay.reservations
            .filter((reservation) => reservation.status !== "cancelled")
            .map((reservation) => {
              const time = timeLabel(reservation.startsAt, locale);
              const itemId = `reservation-${reservation.id}`;
              return {
                id: `reservation-${item.trip.id}-${reservation.id}`,
                kind: "itinerary",
                title: reservation.title,
                subtitle:
                  reservation.locationName ||
                  reservation.provider ||
                  reservation.sourceText ||
                  item.trip.name,
                meta: `${item.trip.name} · ${dayTag} · ${dayDateLabel} · ${time}`,
                href: `/trips/${item.trip.id}/planner?date=${plannerDay.day.dayDate}&item=${itemId}`,
                searchableText: [
                  item.trip.name,
                  item.trip.destination,
                  dayTag,
                  dayDateLabel,
                  time,
                  reservationSearchText(reservation),
                ].join(" "),
              };
            });

          return [...activityResults, ...reservationResults];
        });

        return [journeyResult, ...itineraryResults];
      })
      .filter((result) => normalizeSearchText(result.searchableText).includes(query))
      .slice(0, 60);
  }, [items, locale, t, trimmedSearchQuery]);

  function renderGroup(label: string, group: JourneyItem[]) {
    return (
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-stone-950">{label}</h2>
        {group.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-600">
            {t("trips.emptyGroup")}
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {group.map((item) => {
              const status = getJourneyStatus(item.trip);
              return (
                <TripCard
                  key={item.trip.id}
                  trip={item.trip}
                  memoryCount={item.memorySummary.total}
                  photoCount={item.memorySummary.photos}
                  memberCount={item.memberCount}
                  status={status}
                  actionLabel={
                    status === "upcoming"
                      ? t("trips.action.viewPlan")
                      : status === "completed"
                        ? t("trips.action.viewMemories")
                        : t("trips.action.openJourney")
                  }
                  href={
                    status === "upcoming"
                      ? `/trips/${item.trip.id}/planner`
                      : status === "completed"
                        ? `/trips/${item.trip.id}/timeline`
                        : `/trips/${item.trip.id}`
                  }
                />
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <section className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700">{t("trips.eyebrow")}</p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-950">
            {t("trips.title")}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-stone-600">
            {t("trips.description")}
          </p>
        </div>
        <Link
          href="/trips/new"
          className="shrink-0 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
        >
          {t("trips.newJourney")}
        </Link>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("trips.search.placeholder")}
            className="min-h-11 flex-1 rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-2 text-sm font-semibold text-stone-950 outline-none placeholder:text-stone-400 focus:border-emerald-300"
          />
          {trimmedSearchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="rounded-full bg-stone-100 px-4 py-2 text-xs font-bold text-stone-600"
            >
              {t("trips.search.clear")}
            </button>
          ) : null}
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
          {t("trips.loading")}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && items.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-stone-950">
            {t("trips.empty.title")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {t("trips.empty.description")}
          </p>
          <Link
            href="/trips/new"
            className="mt-5 inline-flex rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
          >
            {t("trips.newJourney")}
          </Link>
        </section>
      ) : null}

      {!isLoading && !error && trimmedSearchQuery ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              {t("trips.search.resultsTitle")}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {t("trips.search.resultCount", { count: searchResults.length })}
            </p>
          </div>
          {searchResults.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-600">
              {t("trips.search.empty")}
            </div>
          ) : (
            <div className="space-y-2">
              {searchResults.map((result) => (
                <Link
                  key={result.id}
                  href={result.href}
                  className="block rounded-3xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-wide text-emerald-800">
                        {result.meta}
                      </p>
                      <h3 className="mt-1 line-clamp-2 font-semibold text-stone-950">
                        {result.title}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-sm text-stone-500">
                        {result.subtitle}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
                      {result.kind === "journey"
                        ? t("trips.search.journey")
                        : t("trips.search.itinerary")}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!isLoading && !error && !trimmedSearchQuery ? (
        <>
          {renderGroup(t("trips.group.active"), groups.active)}
          {renderGroup(t("trips.group.upcoming"), groups.upcoming)}
          {renderGroup(t("trips.group.completed"), groups.completed)}
        </>
      ) : null}
    </div>
  );
}

export default function TripsPage() {
  return <AuthGate>{() => <TripsContent />}</AuthGate>;
}
