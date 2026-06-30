"use client";

import Link from "next/link";
import {
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { TripCard } from "@/components/TripCard";
import { useJourneyCachedResource } from "@/hooks/useJourneyCachedResource";
import {
  journeyResourceKey,
  loadJourneyListResource,
  type JourneyListItem,
} from "@/lib/journey-resources";
import { compareTripsByStartDateAsc, getJourneyStatus } from "@/lib/journeys/status";
import type { ItineraryEvent, ItineraryReservation } from "@/types";

type SearchResult = {
  id: string;
  kind: "journey" | "itinerary";
  title: string;
  subtitle: string;
  meta: string;
  href: string;
  searchableText: string;
};

function uniqueSearchResults(results: SearchResult[]) {
  const seenIds = new Set<string>();
  const uniqueResults: SearchResult[] = [];

  for (const result of results) {
    if (seenIds.has(result.id)) continue;
    seenIds.add(result.id);
    uniqueResults.push(result);
  }

  return uniqueResults;
}

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

function dateKeyFromDateTime(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}

function dateRangeLabel(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  fallbackDate: string,
  locale: string,
) {
  const startDate = dateKeyFromDateTime(startValue) ?? fallbackDate;
  const endDate = dateKeyFromDateTime(endValue) ?? startDate;
  if (startDate === endDate) return dateLabel(startDate, locale);
  return `${dateLabel(startDate, locale)} - ${dateLabel(endDate, locale)}`;
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
  const [items, setItems] = useState<JourneyListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileSearchActive, setIsMobileSearchActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tripsResource = useJourneyCachedResource({
    cacheKey: journeyResourceKey.trips(),
    loader: loadJourneyListResource,
    ttl: 2 * 60_000,
    staleTime: 30_000,
    keepPreviousData: true,
    backgroundRefresh: true,
  });

  useEffect(() => {
    if (!tripsResource.data) return;
    setItems(tripsResource.data);
    setError(null);
  }, [tripsResource.data]);

  useEffect(() => {
    if (!tripsResource.error || tripsResource.data) return;
    setError(
      tripsResource.error instanceof Error
        ? tripsResource.error.message
        : t("trips.error.load"),
    );
  }, [tripsResource.data, tripsResource.error, t]);

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

    const results = items
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
              const range = dateRangeLabel(
                activity.plannedStart,
                activity.plannedEnd,
                plannerDay.day.dayDate,
                locale,
              );
              return {
                id: `activity-${item.trip.id}-${activity.id}`,
                kind: "itinerary",
                title: activity.title,
                subtitle: activity.locationName || activity.description || item.trip.name,
                meta: `${item.trip.name} · ${range} · ${time}`,
                href: `/trips/${item.trip.id}/planner?date=${plannerDay.day.dayDate}&item=${itemId}`,
                searchableText: [
                  item.trip.name,
                  item.trip.destination,
                  dayTag,
                  dayDateLabel,
                  range,
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
              const range = dateRangeLabel(
                reservation.startsAt,
                reservation.endsAt,
                plannerDay.day.dayDate,
                locale,
              );
              return {
                id: `reservation-${item.trip.id}-${reservation.id}`,
                kind: "itinerary",
                title: reservation.title,
                subtitle:
                  reservation.locationName ||
                  reservation.provider ||
                  reservation.sourceText ||
                  item.trip.name,
                meta: `${item.trip.name} · ${range} · ${time}`,
                href: `/trips/${item.trip.id}/planner?date=${plannerDay.day.dayDate}&item=${itemId}`,
                searchableText: [
                  item.trip.name,
                  item.trip.destination,
                  dayTag,
                  dayDateLabel,
                  range,
                  time,
                  reservationSearchText(reservation),
                ].join(" "),
              };
            });

          return [...activityResults, ...reservationResults];
        });

        return [journeyResult, ...itineraryResults];
      })
      .filter((result) => normalizeSearchText(result.searchableText).includes(query));

    return uniqueSearchResults(results).slice(0, 60);
  }, [items, locale, t, trimmedSearchQuery]);

  useEffect(() => {
    if (!isMobileSearchActive) return;

    document.body.classList.add("otr-mobile-search-active");

    return () => {
      document.body.classList.remove("otr-mobile-search-active");
    };
  }, [isMobileSearchActive]);

  function isMobileViewport() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function openMobileSearchFromPointer(event: PointerEvent<HTMLInputElement>) {
    if (!isMobileViewport() || isMobileSearchActive) return;
    event.preventDefault();
    flushSync(() => setIsMobileSearchActive(true));
    searchInputRef.current?.focus({ preventScroll: true });
  }

  function openMobileSearchFromFocus() {
    if (isMobileViewport()) {
      setIsMobileSearchActive(true);
    }
  }

  function closeMobileSearch() {
    setSearchQuery("");
    setIsMobileSearchActive(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function renderGroup(label: string, group: JourneyListItem[]) {
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
    <div className={isMobileSearchActive ? "space-y-0 md:space-y-8" : "space-y-8"}>
      <section
        className={`flex items-start justify-between gap-4 ${
          isMobileSearchActive ? "hidden md:flex" : ""
        }`}
      >
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

      <section
        className={
          isMobileSearchActive
            ? "contents md:block md:rounded-3xl md:border md:border-stone-200 md:bg-white md:p-3 md:shadow-sm"
            : "rounded-3xl border border-stone-200 bg-white p-3 shadow-sm"
        }
      >
        <div
          className={`flex items-center gap-2 ${
            isMobileSearchActive
              ? "fixed inset-x-0 top-0 z-[2147482600] border-b border-stone-200 bg-white p-3 shadow-lg md:static md:rounded-2xl md:border-0 md:bg-stone-50 md:p-2 md:shadow-none"
              : "rounded-2xl bg-stone-50 p-2"
          }`}
        >
          <input
            ref={searchInputRef}
            type="search"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onPointerDown={openMobileSearchFromPointer}
            onFocus={openMobileSearchFromFocus}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.currentTarget.blur();
              }
            }}
            placeholder={t("trips.search.placeholder")}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-base font-semibold text-stone-950 outline-none placeholder:text-stone-400 focus:border-emerald-300 md:text-sm"
          />
          {trimmedSearchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="shrink-0 rounded-full bg-white px-3 py-2 text-xs font-bold text-stone-600 shadow-sm"
            >
              {t("trips.search.clear")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={closeMobileSearch}
            className={`shrink-0 rounded-full px-3 py-2 text-sm font-black text-emerald-800 md:hidden ${
              isMobileSearchActive ? "inline-flex" : "hidden"
            }`}
          >
            {t("common.cancel")}
          </button>
        </div>
      </section>

      {isMobileSearchActive ? <div className="h-[4.5rem] md:hidden" /> : null}

      {!tripsResource.data && tripsResource.isLoading ? (
        <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="h-5 w-32 animate-pulse rounded bg-stone-200" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-40 animate-pulse rounded-3xl bg-stone-100" />
            <div className="h-40 animate-pulse rounded-3xl bg-stone-100" />
          </div>
        </div>
      ) : null}

      {tripsResource.error && tripsResource.data ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-800">
          {t("trips.error.load")}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {tripsResource.data && !error && items.length === 0 && !isMobileSearchActive ? (
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

      {tripsResource.data &&
      !error &&
      (trimmedSearchQuery || isMobileSearchActive) ? (
        <section
          className={`border-stone-200 bg-white shadow-sm ${
            isMobileSearchActive
              ? "rounded-none border-0 p-3 md:rounded-3xl md:border"
              : "space-y-3 rounded-3xl border p-3"
          }`}
        >
          <div className="px-1">
            <h2 className="text-sm font-black text-stone-950 md:text-xl md:font-semibold">
              {t("trips.search.resultsTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-stone-500 md:mt-1 md:text-sm">
              {t("trips.search.resultCount", { count: searchResults.length })}
            </p>
          </div>
          {searchResults.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
              {t("trips.search.empty")}
            </div>
          ) : (
            <div
              className={`mt-3 space-y-2 overflow-y-auto pr-1 ${
                isMobileSearchActive
                  ? "max-h-[calc(100dvh-9rem)] md:max-h-none"
                  : ""
              }`}
            >
              {searchResults.map((result, index) => (
                <Link
                  key={`${result.id}-${index}`}
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

      {tripsResource.data && !error && !trimmedSearchQuery && !isMobileSearchActive ? (
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
