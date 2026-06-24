"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ItineraryEventCard } from "@/components/ItineraryEventCard";
import { MemoryCard } from "@/components/MemoryCard";
import { formatDayLabel } from "@/lib/format";
import { getItineraryEvents } from "@/lib/supabase/itinerary";
import {
  getSignedMemoryImageUrls,
  getTripMemories,
} from "@/lib/supabase/memories";
import { getTrip } from "@/lib/supabase/trips";
import type { ItineraryEvent, MemoryEntry, Trip } from "@/types";

type SortOrder = "oldest" | "newest";

function getLocalDateKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupMemoriesByDate(entries: MemoryEntry[]) {
  return entries.reduce<Record<string, MemoryEntry[]>>((groups, entry) => {
    const date = getLocalDateKey(entry.capturedAt);
    groups[date] = [...(groups[date] ?? []), entry];
    return groups;
  }, {});
}

function groupEventsByDate(entries: ItineraryEvent[]) {
  return entries.reduce<Record<string, ItineraryEvent[]>>((groups, entry) => {
    const date = entry.plannedStart?.slice(0, 10) ?? "unscheduled";
    groups[date] = [...(groups[date] ?? []), entry];
    return groups;
  }, {});
}

function getDayStats(memories: MemoryEntry[]) {
  return {
    total: memories.length,
    photos: memories.filter((memory) => memory.type === "photo").length,
    text: memories.filter((memory) => memory.type === "text").length,
    contributors: new Set(memories.map((memory) => memory.userId).filter(Boolean))
      .size,
  };
}

function TimelineContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [events, setEvents] = useState<ItineraryEvent[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [sortOrder, setSortOrder] = useState<SortOrder>("oldest");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTimeline() {
      try {
        const [tripData, memoryData, eventData] = await Promise.all([
          getTrip(tripId),
          getTripMemories(tripId),
          getItineraryEvents(tripId),
        ]);
        const signedUrls = await getSignedMemoryImageUrls(memoryData);

        if (isMounted) {
          setTrip(tripData);
          setMemories(memoryData);
          setEvents(eventData);
          setImageUrls(signedUrls);
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
  const eventGroups = useMemo(() => groupEventsByDate(events), [events]);
  const dates = [...new Set([...Object.keys(groups), ...Object.keys(eventGroups)])]
    .filter((date) => date !== "unscheduled")
    .sort()
    .reverse();

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
          Memories grouped by travel day, with contributors, places, and photos.
        </p>
      </section>

      <div className="grid grid-cols-2 rounded-2xl border border-stone-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setSortOrder("oldest")}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${
            sortOrder === "oldest"
              ? "bg-emerald-700 text-white"
              : "text-stone-600"
          }`}
        >
          Oldest first
        </button>
        <button
          type="button"
          onClick={() => setSortOrder("newest")}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${
            sortOrder === "newest"
              ? "bg-emerald-700 text-white"
              : "text-stone-600"
          }`}
        >
          Newest first
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {!error && dates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          No memories yet. Capture a text note or photo and it will appear here.
        </div>
      ) : null}

      <section className="space-y-6">
        {dates.map((date) => {
          const dayMemories = [...groups[date]].sort((a, b) => {
            const delta =
              new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime();
            return sortOrder === "oldest" ? delta : -delta;
          });
          const dayEvents = eventGroups[date] ?? [];
          const stats = getDayStats(dayMemories);
          const photos = dayMemories
            .filter((memory) => memory.type === "photo" && memory.mediaUrl)
            .slice(0, 6);

          return (
            <div key={date} className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <Link href={`/trips/${tripId}/days/${date}`}>
                  <h2 className="text-xl font-semibold text-stone-950">
                    {formatDayLabel(date)}
                  </h2>
                  <p className="mt-1 text-sm text-stone-500">
                    {stats.total} memories · {stats.photos} photos · {stats.text}{" "}
                    text notes · {stats.contributors} contributors ·{" "}
                    {dayEvents.length} planned
                  </p>
                </Link>
                <Link
                  href={`/trips/${tripId}/capture?date=${date}`}
                  className="shrink-0 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"
                >
                  Add memory
                </Link>
              </div>

              {photos.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((memory) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={memory.id}
                      src={imageUrls[memory.mediaUrl!] ?? memory.mediaUrl!}
                      alt={memory.content || "Photo memory"}
                      className="h-20 w-20 shrink-0 rounded-xl object-cover"
                    />
                  ))}
                </div>
              ) : null}

              <div className="space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-emerald-700">
                  Plan
                </h3>
                {dayEvents.length === 0 ? (
                  <p className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">
                    No plan items for this day.
                  </p>
                ) : (
                  dayEvents.map((event) => (
                    <ItineraryEventCard key={event.id} event={event} />
                  ))
                )}
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-stone-500">
                  Memories
                </h3>
                {dayMemories.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    displayUrl={
                      memory.mediaUrl ? imageUrls[memory.mediaUrl] : undefined
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

export default function TimelinePage() {
  return <AuthGate>{() => <TimelineContent />}</AuthGate>;
}
