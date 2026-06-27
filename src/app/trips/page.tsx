"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { TripCard } from "@/components/TripCard";
import { compareTripsByStartDateAsc, getJourneyStatus } from "@/lib/journeys/status";
import { getJourneyParticipantCount, getMemoryStats } from "@/lib/journeys/stats";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getTripMemories } from "@/lib/supabase/memories";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { MemoryEntry, Trip } from "@/types";

type JourneyItem = {
  trip: Trip;
  memories: MemoryEntry[];
  memberCount: number;
};

function TripsContent() {
  const { t } = useI18n();
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTrips() {
      try {
        const trips = await getTripsForCurrentUser();
        const loaded = await Promise.all(
          trips.map(async (trip) => {
            const [memories, members] = await Promise.all([
              getTripMemories(trip.id),
              getJourneyMembers(trip.id),
            ]);
            return {
              trip,
              memories,
              memberCount: getJourneyParticipantCount(members),
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
              const stats = getMemoryStats(item.memories);
              return (
                <TripCard
                  key={item.trip.id}
                  trip={item.trip}
                  memoryCount={stats.total}
                  photoCount={stats.photos}
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

      {!isLoading && !error ? (
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
