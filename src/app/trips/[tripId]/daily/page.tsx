"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getTrip } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

function DailyPageContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTrip() {
      try {
        const tripData = await getTrip(tripId);

        if (isMounted) {
          setTrip(tripData);
        }
      } catch (dailyError) {
        if (isMounted) {
          setError(
            dailyError instanceof Error
              ? dailyError.message
              : "Could not load daily report page.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadTrip();

    return () => {
      isMounted = false;
    };
  }, [tripId]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading daily report...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name || "Trip"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Daily report
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Daily reports will use saved memories in a later AI phase.
        </p>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-stone-950">
          No generated report yet
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Capture text memories first. AI report generation is coming soon.
        </p>
        <button
          type="button"
          disabled
          className="mt-5 w-full rounded-2xl bg-stone-300 px-4 py-3 text-sm font-bold text-stone-500"
        >
          Generate AI Report
        </button>
      </section>
    </div>
  );
}

export default function DailyPage() {
  return <AuthGate>{() => <DailyPageContent />}</AuthGate>;
}
