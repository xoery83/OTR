"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { MemoryCard } from "@/components/MemoryCard";
import { formatDate } from "@/lib/format";
import { getTripMemories } from "@/lib/supabase/memories";
import { getTrip } from "@/lib/supabase/trips";
import type { MemoryEntry, Trip } from "@/types";

function groupMemoriesByDate(entries: MemoryEntry[]) {
  return entries.reduce<Record<string, MemoryEntry[]>>((groups, entry) => {
    const date = entry.capturedAt.slice(0, 10);
    groups[date] = [...(groups[date] ?? []), entry];
    return groups;
  }, {});
}

function TimelineContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTimeline() {
      try {
        const [tripData, memoryData] = await Promise.all([
          getTrip(tripId),
          getTripMemories(tripId),
        ]);

        if (isMounted) {
          setTrip(tripData);
          setMemories(memoryData);
        }
      } catch (timelineError) {
        if (isMounted) {
          setError(
            timelineError instanceof Error
              ? timelineError.message
              : "Could not load timeline.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadTimeline();

    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const groups = useMemo(() => groupMemoriesByDate(memories), [memories]);
  const dates = Object.keys(groups).sort().reverse();

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading timeline...
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
          Daily timeline
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Memory entries grouped by captured date from Supabase.
        </p>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {!error && dates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          No memories yet. Capture a text note and it will appear here.
        </div>
      ) : null}

      <section className="space-y-6">
        {dates.map((date) => (
          <div key={date} className="space-y-3">
            <div className="sticky top-16 z-10 -mx-5 border-y border-stone-200 bg-stone-50 px-5 py-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-stone-600">
                {formatDate(date)}
              </h2>
            </div>
            <div className="space-y-4">
              {groups[date].map((memory) => (
                <MemoryCard key={memory.id} memory={memory} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function TimelinePage() {
  return <AuthGate>{() => <TimelineContent />}</AuthGate>;
}
