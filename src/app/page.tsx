"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TripCard } from "@/components/TripCard";
import { getJourneyDayNumber, getJourneyStatus } from "@/lib/journeys/status";
import { getMemoryStats, getTodayMemoryStats } from "@/lib/journeys/stats";
import { signInWithGoogle } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import { getItineraryEvents } from "@/lib/supabase/itinerary";
import { getTripMembers } from "@/lib/supabase/members";
import { getTripMemories } from "@/lib/supabase/memories";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { ItineraryEvent, MemoryEntry, Trip } from "@/types";

type JourneyItem = {
  trip: Trip;
  memories: MemoryEntry[];
  memberCount: number;
  events: ItineraryEvent[];
};

function PublicLanding() {
  const [error, setError] = useState<string | null>(null);

  async function loginGoogle() {
    try {
      await signInWithGoogle();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-white p-8 shadow-sm">
        <div className="grid size-14 place-items-center rounded-2xl bg-emerald-700 text-xl font-bold text-white">
          O
        </div>
        <h1 className="mt-6 text-4xl font-semibold text-stone-950">OTR</h1>
        <p className="mt-3 text-lg leading-8 text-stone-600">
          Group travel memories, plans, and stories.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={loginGoogle}
            className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
          >
            Continue with Google
          </button>
          <Link
            href="/login"
            className="rounded-2xl bg-emerald-100 px-5 py-3 text-center text-sm font-bold text-emerald-900"
          >
            Sign in with email
          </Link>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function HomeDashboard() {
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadHome() {
      try {
        const trips = await getTripsForCurrentUser();
        const loaded = await Promise.all(
          trips.map(async (trip) => {
            const [memories, members, events] = await Promise.all([
              getTripMemories(trip.id),
              getTripMembers(trip.id),
              getItineraryEvents(trip.id),
            ]);
            return { trip, memories, memberCount: members.length, events };
          }),
        );

        if (isMounted) {
          setItems(loaded);
        }
      } catch (homeError) {
        if (isMounted) {
          setError(
            homeError instanceof Error ? homeError.message : "Could not load home.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadHome();

    return () => {
      isMounted = false;
    };
  }, []);

  const groups = useMemo(
    () => ({
      active: items.filter((item) => getJourneyStatus(item.trip) === "active"),
      upcoming: items.filter((item) => getJourneyStatus(item.trip) === "upcoming"),
      completed: items.filter(
        (item) => getJourneyStatus(item.trip) === "completed",
      ),
    }),
    [items],
  );
  const current = groups.active[0];

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading your journeys...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Home</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Journey Dashboard
        </h1>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {current ? (
        <section className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div
            className="h-48 bg-cover bg-center"
            style={{
              backgroundImage: `url(${
                current.trip.coverImageUrl ||
                "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80"
              })`,
            }}
          />
          <div className="space-y-5 p-5">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">
                Current Journey
              </p>
              <h2 className="mt-2 text-3xl font-semibold text-stone-950">
                {current.trip.name}
              </h2>
              <p className="mt-1 text-stone-600">{current.trip.destination}</p>
              {getJourneyDayNumber(current.trip) ? (
                <p className="mt-2 text-sm font-bold text-emerald-800">
                  Day {getJourneyDayNumber(current.trip)}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(getTodayMemoryStats(current.memories)).map(
                ([label, value]) => (
                  <div key={label} className="rounded-2xl bg-emerald-50 p-3">
                    <p className="text-xl font-semibold text-stone-950">{value}</p>
                    <p className="text-xs text-stone-500">{label}</p>
                  </div>
                ),
              )}
            </div>
            {current.events[0] ? (
              <p className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-700">
                Next plan: <strong>{current.events[0].title}</strong>
              </p>
            ) : null}
            {current.memories[0] ? (
              <p className="text-sm leading-6 text-stone-600">
                Latest: {current.memories[0].content || "Photo memory"}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href={`/trips/${current.trip.id}`}
                className="rounded-2xl bg-emerald-700 px-4 py-3 text-center text-sm font-bold text-white"
              >
                Open Journey
              </Link>
              <Link
                href={`/trips/${current.trip.id}/capture`}
                className="rounded-2xl bg-emerald-100 px-4 py-3 text-center text-sm font-bold text-emerald-900"
              >
                Capture Memory
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-stone-950">
            No active journey right now
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Plan what is next, or revisit memories from a completed journey.
          </p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <Link href="/trips/new" className="rounded-2xl bg-white p-4 font-bold">
          New Journey
        </Link>
        <Link href="/trips" className="rounded-2xl bg-white p-4 font-bold">
          Add Memory
        </Link>
        <Link href="/people" className="rounded-2xl bg-white p-4 font-bold">
          View People
        </Link>
      </section>

      {(["upcoming", "completed"] as const).map((status) => (
        <section key={status} className="space-y-4">
          <h2 className="text-2xl font-semibold capitalize text-stone-950">
            {status === "upcoming" ? "Upcoming Journeys" : "Past Journeys"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {groups[status].slice(0, 4).map((item) => {
              const stats = getMemoryStats(item.memories);
              return (
                <TripCard
                  key={item.trip.id}
                  trip={item.trip}
                  memoryCount={stats.total}
                  photoCount={stats.photos}
                  memberCount={item.memberCount}
                  status={status}
                  actionLabel={status === "upcoming" ? "View Plan" : "View Memories"}
                  href={
                    status === "upcoming"
                      ? `/trips/${item.trip.id}/planner`
                      : `/trips/${item.trip.id}/timeline`
                  }
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Home() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthed(Boolean(data.session?.user));
    });
  }, []);

  if (isAuthed === null) {
    return null;
  }

  return isAuthed ? <HomeDashboard /> : <PublicLanding />;
}
