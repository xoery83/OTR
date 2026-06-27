"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getJourneyStatus } from "@/lib/journeys/status";
import { compareTripsByStartDateAsc } from "@/lib/journeys/status";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

function CaptureContent() {
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadJourneys() {
      try {
        const journeyData = await getTripsForCurrentUser();

        if (isMounted) {
          setTrips(journeyData);
          setSelectedTripId(journeyData[0]?.id ?? "");
        }
      } catch (captureError) {
        if (isMounted) {
          setError(
            captureError instanceof Error
              ? captureError.message
              : "Could not load journeys.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadJourneys();

    return () => {
      isMounted = false;
    };
  }, []);

  const groupedTrips = useMemo(
    () => ({
      active: trips
        .filter((trip) => getJourneyStatus(trip) === "active")
        .sort(compareTripsByStartDateAsc),
      upcoming: trips
        .filter((trip) => getJourneyStatus(trip) === "upcoming")
        .sort(compareTripsByStartDateAsc),
      completed: trips
        .filter((trip) => getJourneyStatus(trip) === "completed")
        .sort(compareTripsByStartDateAsc),
    }),
    [trips],
  );

  function openCapture() {
    if (!selectedTripId) {
      return;
    }

    router.push(`/trips/${selectedTripId}/capture`);
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Capture</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Choose a journey
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-stone-600">
          Every note and photo must be saved into a journey.
        </p>
      </section>

      {isLoading ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
          Loading journeys...
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && trips.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-stone-950">
            Create a journey first
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Capture is enabled after at least one journey exists.
          </p>
          <button
            type="button"
            onClick={() => router.push("/trips/new")}
            className="mt-5 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
          >
            New Journey
          </button>
        </section>
      ) : null}

      {!isLoading && !error && trips.length > 0 ? (
        <section className="space-y-5 rounded-3xl bg-white p-5 shadow-sm">
          <label
            htmlFor="capture-journey"
            className="text-sm font-bold text-stone-800"
          >
            Journey
          </label>
          <select
            id="capture-journey"
            value={selectedTripId}
            onChange={(event) => setSelectedTripId(event.target.value)}
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          >
            {Object.entries(groupedTrips).map(([status, group]) =>
              group.length > 0 ? (
                <optgroup key={status} label={status}>
                  {group.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.name}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
          <button
            type="button"
            onClick={openCapture}
            disabled={!selectedTripId}
            className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Continue to Capture
          </button>
        </section>
      ) : null}
    </div>
  );
}

export default function CapturePage() {
  return <AuthGate>{() => <CaptureContent />}</AuthGate>;
}
