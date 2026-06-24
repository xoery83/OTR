"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { TripCard } from "@/components/TripCard";
import { getTripMemories } from "@/lib/supabase/memories";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

type TripWithMemoryCount = {
  trip: Trip;
  memoryCount: number;
};

function TripsContent() {
  const [items, setItems] = useState<TripWithMemoryCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTrips() {
      try {
        const trips = await getTripsForCurrentUser();
        const withCounts = await Promise.all(
          trips.map(async (trip) => ({
            trip,
            memoryCount: (await getTripMemories(trip.id)).length,
          })),
        );

        if (isMounted) {
          setItems(withCounts);
        }
      } catch (tripsError) {
        if (isMounted) {
          setError(
            tripsError instanceof Error
              ? tripsError.message
              : "Could not load trips.",
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
  }, []);

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Trips</p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-950">
            Your journeys
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-stone-600">
            Trips shown here come from Supabase and are scoped by your
            membership.
          </p>
        </div>
        <Link
          href="/trips/new"
          className="shrink-0 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
        >
          Create Trip
        </Link>
      </section>

      {isLoading ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
          Loading trips...
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
            No trips yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Create your first group trip to start capturing memories.
          </p>
          <Link
            href="/trips/new"
            className="mt-5 inline-flex rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
          >
            Create Trip
          </Link>
        </section>
      ) : null}

      <section className="grid gap-5 sm:grid-cols-2">
        {items.map(({ trip, memoryCount }) => (
          <TripCard key={trip.id} trip={trip} memoryCount={memoryCount} />
        ))}
      </section>
    </div>
  );
}

export default function TripsPage() {
  return <AuthGate>{() => <TripsContent />}</AuthGate>;
}
