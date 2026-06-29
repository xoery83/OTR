"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { MemoryCard } from "@/components/MemoryCard";
import { formatDayLabel } from "@/lib/format";
import {
  getSignedMemoryImageUrls,
  getTripMemoriesForDate,
} from "@/lib/supabase/memories";
import { getTrip } from "@/lib/supabase/trips";
import type { MemoryEntry, Trip } from "@/types";

function getStats(memories: MemoryEntry[]) {
  return {
    total: memories.length,
    photos: memories.filter((memory) => memory.type === "photo").length,
    text: memories.filter((memory) => memory.type === "text").length,
    contributors: new Set(memories.map((memory) => memory.userId).filter(Boolean))
      .size,
  };
}

function DayContent() {
  const params = useParams<{ tripId: string; date: string }>();
  const { tripId, date } = params;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDay() {
      try {
        const [tripData, memoryData] = await Promise.all([
          getTrip(tripId),
          getTripMemoriesForDate(tripId, date),
        ]);
        const signedUrls = await getSignedMemoryImageUrls(memoryData);

        if (isMounted) {
          setTrip(tripData);
          setMemories(memoryData);
          setImageUrls(signedUrls);
        }
      } catch (dayError) {
        if (isMounted) {
          setError(
            dayError instanceof Error ? dayError.message : "Could not load day.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDay();

    return () => {
      isMounted = false;
    };
  }, [tripId, date]);

  const stats = getStats(memories);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading day...
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
          {formatDayLabel(date)}
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          {stats.total} memories · {stats.photos} photos · {stats.text} text
          notes · {stats.contributors} contributors
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/trips/${tripId}/capture?date=${date}`}
          className="rounded-2xl bg-emerald-700 px-4 py-3 text-center text-sm font-bold text-white"
        >
          Add memory to this day
        </Link>
        <Link
          href={`/trips/${tripId}/timeline`}
          className="rounded-2xl bg-emerald-100 px-4 py-3 text-center text-sm font-bold text-emerald-900"
        >
          Back to album
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {!error && memories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          No memories for this day yet.
        </div>
      ) : null}

      <section className="space-y-4">
        {memories.map((memory) => (
          <MemoryCard
            key={memory.id}
            memory={memory}
            displayUrl={memory.mediaUrl ? imageUrls[memory.mediaUrl] : undefined}
          />
        ))}
      </section>
    </div>
  );
}

export default function DayPage() {
  return <AuthGate>{() => <DayContent />}</AuthGate>;
}
