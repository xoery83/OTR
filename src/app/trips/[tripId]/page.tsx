"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { MemoryCard } from "@/components/MemoryCard";
import { formatDateRange } from "@/lib/format";
import { getJourneyDayNumber, getJourneyStatus, getDaysUntilJourney } from "@/lib/journeys/status";
import {
  getActiveJourneyMembers,
  getJourneyParticipantCount,
  getMemoryStats,
  getTodayMemoryStats,
} from "@/lib/journeys/stats";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getItineraryEvents } from "@/lib/supabase/itinerary";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import {
  getSignedMemoryImageUrls,
  getTripMemories,
} from "@/lib/supabase/memories";
import { deleteTrip, getTrip } from "@/lib/supabase/trips";
import type { ItineraryEvent, JourneyMember, MemoryEntry, Trip } from "@/types";

function memberInitial(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function TripDashboardContent() {
  const params = useParams<{ tripId: string }>();
  const router = useRouter();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [events, setEvents] = useState<ItineraryEvent[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        const [tripData, memberData, memoryData, user] = await Promise.all([
          getTrip(tripId),
          getJourneyMembers(tripId),
          getTripMemories(tripId),
          getCurrentUser(),
        ]);
        const eventData = await getItineraryEvents(tripId);
        const signedUrls = await getSignedMemoryImageUrls(memoryData);

        if (isMounted) {
          setTrip(tripData);
          setMembers(memberData);
          setMemories(memoryData);
          setEvents(eventData);
          setImageUrls(signedUrls);
          setCurrentUserId(user?.id ?? null);
        }
      } catch (dashboardError) {
        if (isMounted) {
          setError(
            dashboardError instanceof Error
              ? dashboardError.message
              : "Could not load trip.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [tripId]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading trip...
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
        {error || "Trip not found."}
      </div>
    );
  }

  const coverImageUrl =
    trip.coverImageUrl ||
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80";
  const today = new Date().toISOString().slice(0, 10);
  const todayMemories = memories.filter((memory) => memory.capturedAt.startsWith(today));
  const todayEvents = events.filter((event) => event.plannedStart?.startsWith(today));
  const status = getJourneyStatus(trip);
  const dayNumber = getJourneyDayNumber(trip);
  const totalStats = getMemoryStats(memories);
  const todayStats = getTodayMemoryStats(memories);
  const currentMember = members.find((member) => member.userId === currentUserId);
  const activeMembers = getActiveJourneyMembers(members);
  const participantCount = getJourneyParticipantCount(members);
  const canManageJourney =
    currentMember?.role === "owner" || trip.createdBy === currentUserId;

  async function handleDeleteJourney() {
    if (!trip) {
      return;
    }

    if (!canManageJourney) {
      setError("Only journey owners and admins can delete this journey.");
      return;
    }

    if (deleteConfirmation !== trip.name) {
      setError("Type the journey name exactly before deleting.");
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await deleteTrip(trip.id);
      router.replace("/trips");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete journey.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
        <div
          className="h-52 bg-cover bg-center"
          style={{ backgroundImage: `url(${coverImageUrl})` }}
        />
        <div className="space-y-5 p-5">
          <div>
            <p className="text-sm font-semibold text-emerald-700">
              Journey Overview
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-stone-950">
              {trip.name}
            </h1>
            <p className="mt-2 text-sm text-stone-500">
              {formatDateRange(trip.startDate, trip.endDate)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
                {status}
              </span>
              {dayNumber ? (
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700">
                  Day {dayNumber}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-2xl font-semibold text-stone-950">
                {participantCount}
              </p>
              <p className="mt-1 text-sm text-stone-500">travelers</p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-2xl font-semibold text-stone-950">
                {status === "completed" ? totalStats.total : todayStats.total}
              </p>
              <p className="mt-1 text-sm text-stone-500">
                {status === "completed" ? "total memories" : "today memories"}
              </p>
            </div>
          </div>

          {activeMembers.length > 0 ? (
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">
                Traveling with
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeMembers.map((member) => (
                  <Link
                    key={member.id}
                    href={
                      member.userId
                        ? `/people/${member.userId}`
                        : `/trips/${trip.id}/people`
                    }
                    title={
                      member.userId
                        ? member.displayName
                        : `${member.displayName} · not linked`
                    }
                    className={`grid size-9 place-items-center overflow-hidden rounded-full text-[10px] font-bold ring-2 ring-white ${
                      member.userId
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-stone-200 text-stone-500"
                    }`}
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
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href={`/trips/${trip.id}/capture`}
              className="rounded-2xl bg-emerald-700 px-4 py-3 text-center text-sm font-bold text-white"
            >
              Capture memory
            </Link>
            <Link
              href={`/trips/${trip.id}/daily`}
              className="rounded-2xl bg-emerald-100 px-4 py-3 text-center text-sm font-bold text-emerald-900"
            >
              Daily report
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-stone-950">
          {status === "active"
            ? "Today"
            : status === "upcoming"
              ? "Before You Go"
              : "Journey Archive"}
        </h2>
        {status === "active" ? (
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {todayEvents.length} planned events · {todayMemories.length} memories ·{" "}
            {todayStats.contributors} contributors
          </p>
        ) : status === "upcoming" ? (
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Starts in {getDaysUntilJourney(trip) ?? "?"} days · {events.length} planned events
          </p>
        ) : (
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {totalStats.total} memories · {totalStats.photos} photos ·{" "}
            {totalStats.contributors} contributors
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Link
            href={`/trips/${trip.id}/capture`}
            className="rounded-2xl bg-emerald-700 px-4 py-3 text-center text-sm font-bold text-white"
          >
            Add Memory
          </Link>
          <Link
            href={`/trips/${trip.id}/days/${today}`}
            className="rounded-2xl bg-emerald-100 px-4 py-3 text-center text-sm font-bold text-emerald-900"
          >
            View Today
          </Link>
          <Link
            href={`/trips/${trip.id}/planner`}
            className="rounded-2xl bg-stone-100 px-4 py-3 text-center text-sm font-bold text-stone-800"
          >
            View Planner
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {[
          ["Planner", "Your planned route, bookings, and scheduled activities.", `/trips/${trip.id}/planner`],
          ["Timeline", "What actually happened, day by day.", `/trips/${trip.id}/timeline`],
          ["People", "Everyone in this journey.", `/trips/${trip.id}/people`],
          ["Highlights", "Best moments and summaries. Coming soon.", `/trips/${trip.id}/highlights`],
        ].map(([title, copy, href]) => (
          <Link key={title} href={href} className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{copy}</p>
          </Link>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">Latest</p>
            <h2 className="mt-1 text-2xl font-semibold text-stone-950">
              Recent memories
            </h2>
          </div>
          <Link
            href={`/trips/${trip.id}/timeline`}
            className="rounded-full bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"
          >
            View full timeline
          </Link>
        </div>
        {memories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
            No memories yet. Capture the first note for this trip.
          </div>
        ) : (
          <div className="space-y-4">
            {memories.slice(0, 3).map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                displayUrl={memory.mediaUrl ? imageUrls[memory.mediaUrl] : undefined}
              />
            ))}
          </div>
        )}
      </section>

      {canManageJourney ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-red-900">Danger Zone</h2>
          <p className="mt-2 text-sm leading-6 text-red-800">
            Delete this journey and all related memories, media records, members,
            and planner items. Storage files may remain in the bucket and can be
            cleaned separately.
          </p>
          <label
            htmlFor="delete-journey-confirm"
            className="mt-4 block text-sm font-bold text-red-900"
          >
            Type “{trip.name}” to confirm
          </label>
          <input
            id="delete-journey-confirm"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            className="mt-3 w-full rounded-2xl border border-red-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
          />
          <button
            type="button"
            onClick={handleDeleteJourney}
            disabled={isDeleting || deleteConfirmation !== trip.name}
            className="mt-4 w-full rounded-2xl bg-red-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-red-200 disabled:text-red-500"
          >
            {isDeleting ? "Deleting journey..." : "Delete Journey"}
          </button>
        </section>
      ) : null}
    </div>
  );
}

export default function TripDashboardPage() {
  return <AuthGate>{() => <TripDashboardContent />}</AuthGate>;
}
