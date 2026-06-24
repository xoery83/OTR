"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getTripMembers } from "@/lib/supabase/members";
import { getTrip } from "@/lib/supabase/trips";
import type { Trip, TripMember } from "@/types";

function MembersPageContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadMembers() {
      try {
        const [tripData, memberData, user] = await Promise.all([
          getTrip(tripId),
          getTripMembers(tripId),
          getCurrentUser(),
        ]);
        if (isMounted) {
          setTrip(tripData);
          setMembers(memberData);
          setCurrentUserId(user?.id ?? null);
        }
      } catch (membersError) {
        if (isMounted) {
          setError(
            membersError instanceof Error
              ? membersError.message
              : "Could not load members.",
          );
        }
      }
    }

    loadMembers();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const currentMember = useMemo(
    () => members.find((member) => member.userId === currentUserId),
    [currentUserId, members],
  );
  const canInvite =
    currentMember?.role === "owner" ||
    currentMember?.role === "admin" ||
    trip?.createdBy === currentUserId;

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            {trip?.name || "Journey"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-950">
            People
          </h1>
          <p className="mt-3 text-base leading-7 text-stone-600">
            Everyone currently part of this journey.
          </p>
        </div>
        {canInvite ? (
          <Link
            href={`/trips/${tripId}/invite`}
            className="shrink-0 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
          >
            Invite people
          </Link>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        {members.map((member) => (
          <article key={member.id} className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center overflow-hidden rounded-full bg-emerald-100 font-bold text-emerald-800">
                {member.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  member.name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div>
                <h2 className="font-semibold text-stone-950">{member.name}</h2>
                <span className="mt-1 inline-flex rounded-full bg-stone-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-stone-600">
                  {member.role}
                </span>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

export default function JourneyPeoplePage() {
  return <AuthGate>{() => <MembersPageContent />}</AuthGate>;
}
