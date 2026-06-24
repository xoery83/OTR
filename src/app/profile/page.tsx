"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/AuthGate";
import { logout } from "@/lib/supabase/auth";
import { getMemoryStats } from "@/lib/journeys/stats";
import { getTripMemories } from "@/lib/supabase/memories";
import { getProfile } from "@/lib/supabase/profiles";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { Profile } from "@/types";

function ProfileContent({ user }: { user: User }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [journeys, setJourneys] = useState(0);
  const [memories, setMemories] = useState(0);
  const [photos, setPhotos] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    async function loadProfile() {
      const profileData = await getProfile(user.id);
      const trips = await getTripsForCurrentUser();
      const allMemories = (
        await Promise.all(trips.map((trip) => getTripMemories(trip.id)))
      ).flat();
      const mine = allMemories.filter((memory) => memory.userId === user.id);
      const stats = getMemoryStats(mine);
      setProfile(profileData);
      setDisplayName(profileData.displayName);
      setAvatarUrl(profileData.avatarUrl ?? "");
      setJourneys(trips.length);
      setMemories(stats.total);
      setPhotos(stats.photos);
    }
    loadProfile();
  }, [user.id]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Profile</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {profile?.displayName ?? "Your profile"}
        </h1>
        <p className="mt-2 text-sm text-stone-500">{user.email}</p>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="grid size-16 place-items-center overflow-hidden rounded-2xl bg-emerald-100 text-xl font-bold text-emerald-800">
            {profile?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              profile?.displayName.slice(0, 1).toUpperCase() ?? "O"
            )}
          </div>
          <div>
            <p className="text-sm text-stone-500">Joined</p>
            <p className="font-semibold text-stone-950">
              {profile ? new Date(profile.createdAt).toLocaleDateString() : "..."}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ["Journeys", journeys],
            ["Memories", memories],
            ["Photos", photos],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-xl font-semibold text-stone-950">{value}</p>
              <p className="text-xs text-stone-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Basic fields</h2>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
        />
        <input
          value={avatarUrl}
          onChange={(event) => setAvatarUrl(event.target.value)}
          placeholder="Avatar URL"
          className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
        />
        <p className="text-xs text-stone-500">Editing persistence comes later.</p>
      </section>

      <button
        type="button"
        onClick={handleLogout}
        className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
      >
        Logout
      </button>
    </div>
  );
}

export default function ProfilePage() {
  return <AuthGate>{(user) => <ProfileContent user={user} />}</AuthGate>;
}
