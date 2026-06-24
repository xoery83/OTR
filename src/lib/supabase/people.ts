import type { MemoryEntry, Profile, Trip } from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";
import { getTripMembers } from "./members";
import { getProfile } from "./profiles";
import { getTripsForCurrentUser } from "./trips";

type MemoryRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  type: MemoryEntry["type"];
  content: string | null;
  media_url: string | null;
  location_name: string | null;
  captured_at: string;
  created_at: string;
};

export type Companion = {
  profile: Profile;
  journeysTogether: number;
  memoriesContributed: number;
  latestJourney: string | null;
};

export async function getPeopleOverview() {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in.");

  const [me, trips] = await Promise.all([getProfile(user.id), getTripsForCurrentUser()]);
  const tripIds = trips.map((trip) => trip.id);

  if (tripIds.length === 0) {
    return { me, trips, companions: [] as Companion[] };
  }

  const members = (await Promise.all(tripIds.map(getTripMembers))).flat();

  const { data: memories } = await supabase
    .from("memory_entries")
    .select("user_id")
    .in("trip_id", tripIds);

  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
  const byUser = new Map<string, { profile: Profile; tripIds: Set<string> }>();

  members
    .filter((member) => member.userId !== user.id)
    .forEach((member) => {
      const existing = byUser.get(member.userId);
      const profile = {
        id: member.userId,
        displayName: member.name || "Traveler",
        avatarUrl: member.avatarUrl,
        createdAt: "",
      };
      if (existing) {
        existing.tripIds.add(member.tripId);
      } else {
        byUser.set(member.userId, { profile, tripIds: new Set([member.tripId]) });
      }
    });

  const memoryCounts = new Map<string, number>();
  (memories ?? []).forEach((memory) => {
    if (memory.user_id) {
      memoryCounts.set(memory.user_id, (memoryCounts.get(memory.user_id) ?? 0) + 1);
    }
  });

  return {
    me,
    trips,
    companions: [...byUser.values()].map((value) => {
      const latestTrip = [...value.tripIds]
        .map((tripId) => tripsById.get(tripId))
        .filter((trip): trip is Trip => Boolean(trip))
        .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0];

      return {
        profile: value.profile,
        journeysTogether: value.tripIds.size,
        memoriesContributed: memoryCounts.get(value.profile.id) ?? 0,
        latestJourney: latestTrip?.name ?? null,
      };
    }),
  };
}

export async function getPersonDetail(profileId: string) {
  const overview = await getPeopleOverview();
  const trips = overview.trips;
  const tripIds = trips.map((trip) => trip.id);
  const profile =
    overview.companions.find((item) => item.profile.id === profileId)?.profile ??
    (await getProfile(profileId));

  const { data } = await supabase
    .from("memory_entries")
    .select("*")
    .eq("user_id", profileId)
    .in("trip_id", tripIds)
    .order("captured_at", { ascending: false });

  const memories = ((data ?? []) as MemoryRow[]).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id ?? "",
    type: row.type,
    content: row.content ?? "",
    mediaUrl: row.media_url,
    locationName: row.location_name,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    contributorName: profile.displayName,
    contributorAvatarUrl: profile.avatarUrl,
  }));

  return { profile, trips, memories };
}
