"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { MemoryCard } from "@/components/MemoryCard";
import { getPersonDetail } from "@/lib/supabase/people";
import type { MemoryEntry, Profile, Trip } from "@/types";

function PersonContent() {
  const { profileId } = useParams<{ profileId: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);

  useEffect(() => {
    getPersonDetail(profileId).then((data) => {
      setProfile(data.profile);
      setTrips(data.trips);
      setMemories(data.memories);
    });
  }, [profileId]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-emerald-700">Person</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {profile?.displayName ?? "Traveler"}
        </h1>
        <p className="mt-2 text-sm text-stone-500">
          {trips.length} shared journeys · {memories.length} memories
        </p>
      </section>
      <section className="space-y-4">
        {memories.map((memory) => (
          <MemoryCard key={memory.id} memory={memory} />
        ))}
      </section>
    </div>
  );
}

export default function PersonPage() {
  return <AuthGate>{() => <PersonContent />}</AuthGate>;
}
