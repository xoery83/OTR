"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getPeopleOverview, type Companion } from "@/lib/supabase/people";
import type { Profile, Trip } from "@/types";

function PeopleContent() {
  const [me, setMe] = useState<Profile | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPeopleOverview()
      .then((data) => {
        setMe(data.me);
        setTrips(data.trips);
        setCompanions(data.companions);
      })
      .catch((peopleError) =>
        setError(peopleError instanceof Error ? peopleError.message : "Failed."),
      );
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">People</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Travel Companions
        </h1>
      </section>
      {error ? <p className="rounded-2xl bg-red-50 p-4 text-red-700">{error}</p> : null}
      {me ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-emerald-700">Me</p>
          <h2 className="mt-2 text-xl font-semibold">{me.displayName}</h2>
          <p className="mt-1 text-sm text-stone-500">{trips.length} journeys</p>
        </section>
      ) : null}
      <section className="grid gap-4 sm:grid-cols-2">
        {companions.map((companion) => (
          <Link
            key={companion.profile.id}
            href={`/people/${companion.profile.id}`}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center overflow-hidden rounded-full bg-emerald-100 font-bold text-emerald-800">
                {companion.profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={companion.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  companion.profile.displayName.slice(0, 1).toUpperCase()
                )}
              </div>
              <div>
                <h2 className="font-semibold text-stone-950">{companion.profile.displayName}</h2>
                <p className="text-sm text-stone-500">
                  {companion.journeysTogether} journeys together
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-stone-600">
              {companion.memoriesContributed} memories · Latest:{" "}
              {companion.latestJourney ?? "No journey yet"}
            </p>
          </Link>
        ))}
      </section>
      {companions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-600">
          Travel companions will appear after you share journeys.
        </p>
      ) : null}
    </div>
  );
}

export default function PeoplePage() {
  return <AuthGate>{() => <PeopleContent />}</AuthGate>;
}
