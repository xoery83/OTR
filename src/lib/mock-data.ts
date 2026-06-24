import type { DailyReport, MemoryEntry, Trip, TripMember } from "@/types";

export const trips: Trip[] = [
  {
    id: "iceland-2026",
    name: "Iceland 2026",
    destination: "Reykjavik, South Coast, Golden Circle",
    startDate: "2026-02-08",
    endDate: "2026-02-15",
    coverImageUrl:
      "https://images.unsplash.com/photo-1504829857797-ddff29c27927?auto=format&fit=crop&w=1200&q=80",
    createdAt: "2026-01-10T10:00:00.000Z",
  },
  {
    id: "greenland-2026",
    name: "Greenland 2026",
    destination: "Nuuk, Ilulissat, Disko Bay",
    startDate: "2026-06-18",
    endDate: "2026-06-27",
    coverImageUrl:
      "https://images.unsplash.com/photo-1517783999520-f068d7431a60?auto=format&fit=crop&w=1200&q=80",
    createdAt: "2026-01-15T10:00:00.000Z",
  },
  {
    id: "faroe-2026",
    name: "Faroe Islands 2026",
    destination: "Torshavn, Vagar, Gjogv",
    startDate: "2026-09-03",
    endDate: "2026-09-10",
    coverImageUrl:
      "https://images.unsplash.com/photo-1528133837573-a3cc1f00fe8c?auto=format&fit=crop&w=1200&q=80",
    createdAt: "2026-01-20T10:00:00.000Z",
  },
];

export const tripMembers: TripMember[] = trips.flatMap((trip) => [
  {
    id: `${trip.id}-member-1`,
    tripId: trip.id,
    userId: `${trip.id}-member-1`,
    name: "Mia",
    role: "Planner",
    avatarUrl: "",
  },
  {
    id: `${trip.id}-member-2`,
    tripId: trip.id,
    userId: `${trip.id}-member-2`,
    name: "Leo",
    role: "Photographer",
    avatarUrl: "",
  },
  {
    id: `${trip.id}-member-3`,
    tripId: trip.id,
    userId: `${trip.id}-member-3`,
    name: "Ava",
    role: "Navigator",
    avatarUrl: "",
  },
  {
    id: `${trip.id}-member-4`,
    tripId: trip.id,
    userId: `${trip.id}-member-4`,
    name: "Noah",
    role: "Food scout",
    avatarUrl: "",
  },
  {
    id: `${trip.id}-member-5`,
    tripId: trip.id,
    userId: `${trip.id}-member-5`,
    name: "Sofia",
    role: "Memory keeper",
    avatarUrl: "",
  },
  {
    id: `${trip.id}-member-6`,
    tripId: trip.id,
    userId: `${trip.id}-member-6`,
    name: "Ethan",
    role: "Driver",
    avatarUrl: "",
  },
  {
    id: `${trip.id}-member-7`,
    tripId: trip.id,
    userId: `${trip.id}-member-7`,
    name: "Zoe",
    role: "Snack lead",
    avatarUrl: "",
  },
]);

export const memoryEntries: MemoryEntry[] = [
  {
    id: "ice-memory-1",
    tripId: "iceland-2026",
    userId: "iceland-2026-member-1",
    type: "text",
    content:
      "First coffee in Reykjavik. Everyone was sleepy, but the harbor light made it feel cinematic.",
    mediaUrl: null,
    locationName: "Reykjavik Harbor",
    capturedAt: "2026-02-08T09:15:00.000Z",
    createdAt: "2026-02-08T09:16:00.000Z",
  },
  {
    id: "ice-memory-2",
    tripId: "iceland-2026",
    userId: "iceland-2026-member-2",
    type: "photo",
    content: "Steam rolling across the path near the hot springs.",
    mediaUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    locationName: "Hot springs",
    capturedAt: "2026-02-08T13:40:00.000Z",
    createdAt: "2026-02-08T13:44:00.000Z",
  },
  {
    id: "ice-memory-3",
    tripId: "iceland-2026",
    userId: "iceland-2026-member-4",
    type: "location",
    content: "Pinned the tiny bakery where we found warm cinnamon rolls.",
    mediaUrl: null,
    locationName: "Reykjavik",
    capturedAt: "2026-02-09T08:30:00.000Z",
    createdAt: "2026-02-09T08:31:00.000Z",
  },
  {
    id: "ice-memory-4",
    tripId: "iceland-2026",
    userId: "iceland-2026-member-5",
    type: "voice",
    content: "Voice note: the whole van reacting when the waterfall appeared.",
    mediaUrl: null,
    locationName: "South Coast",
    capturedAt: "2026-02-09T15:10:00.000Z",
    createdAt: "2026-02-09T15:12:00.000Z",
  },
  {
    id: "green-memory-1",
    tripId: "greenland-2026",
    userId: "greenland-2026-member-2",
    type: "photo",
    content: "Icebergs outside Ilulissat, blue edges glowing after dinner.",
    mediaUrl:
      "https://images.unsplash.com/photo-1517783999520-f068d7431a60?auto=format&fit=crop&w=900&q=80",
    locationName: "Ilulissat",
    capturedAt: "2026-06-18T20:35:00.000Z",
    createdAt: "2026-06-18T20:37:00.000Z",
  },
  {
    id: "green-memory-2",
    tripId: "greenland-2026",
    userId: "greenland-2026-member-3",
    type: "text",
    content:
      "The group went quiet on the boardwalk. It was the good kind of quiet.",
    mediaUrl: null,
    locationName: "Boardwalk",
    capturedAt: "2026-06-19T11:25:00.000Z",
    createdAt: "2026-06-19T11:26:00.000Z",
  },
  {
    id: "green-memory-3",
    tripId: "greenland-2026",
    userId: "greenland-2026-member-6",
    type: "location",
    content: "Marked the overlook for tomorrow's sunrise attempt.",
    mediaUrl: null,
    locationName: "Disko Bay overlook",
    capturedAt: "2026-06-19T17:05:00.000Z",
    createdAt: "2026-06-19T17:06:00.000Z",
  },
  {
    id: "faroe-memory-1",
    tripId: "faroe-2026",
    userId: "faroe-2026-member-1",
    type: "text",
    content: "Landed through low clouds. The runway view already felt unreal.",
    mediaUrl: null,
    locationName: "Vagar Airport",
    capturedAt: "2026-09-03T14:20:00.000Z",
    createdAt: "2026-09-03T14:21:00.000Z",
  },
  {
    id: "faroe-memory-2",
    tripId: "faroe-2026",
    userId: "faroe-2026-member-2",
    type: "photo",
    content: "Green cliffs dropping straight into the water near Gasadalur.",
    mediaUrl:
      "https://images.unsplash.com/photo-1528133837573-a3cc1f00fe8c?auto=format&fit=crop&w=900&q=80",
    locationName: "Gasadalur",
    capturedAt: "2026-09-04T10:45:00.000Z",
    createdAt: "2026-09-04T10:48:00.000Z",
  },
  {
    id: "faroe-memory-3",
    tripId: "faroe-2026",
    userId: "faroe-2026-member-5",
    type: "voice",
    content: "Voice note: wind so loud we had to shout the lunch order.",
    mediaUrl: null,
    locationName: "Vagar",
    capturedAt: "2026-09-04T13:10:00.000Z",
    createdAt: "2026-09-04T13:12:00.000Z",
  },
  {
    id: "faroe-memory-4",
    tripId: "faroe-2026",
    userId: "faroe-2026-member-7",
    type: "text",
    content: "Best soup of the trip so far, eaten while watching rain cross the bay.",
    mediaUrl: null,
    locationName: "Torshavn",
    capturedAt: "2026-09-04T19:30:00.000Z",
    createdAt: "2026-09-04T19:32:00.000Z",
  },
];

export const dailyReports: DailyReport[] = [
  {
    id: "ice-report-1",
    tripId: "iceland-2026",
    date: "2026-02-09",
    title: "Steam, waterfalls, and van-window wonder",
    summary:
      "The group eased into Iceland with slow coffee, geothermal walks, and the first big South Coast drive. The day felt full without feeling rushed.",
    highlights: [
      "Morning harbor walk in Reykjavik",
      "Hot spring steam drifting across the trail",
      "A shared cinnamon roll stop that became an instant favorite",
      "First waterfall sighting from the van",
    ],
    createdAt: "2026-02-09T22:00:00.000Z",
  },
  {
    id: "green-report-1",
    tripId: "greenland-2026",
    date: "2026-06-19",
    title: "Quiet awe around Disko Bay",
    summary:
      "Today was all about scale: icebergs, soft light, and long pauses while everyone took in the landscape together.",
    highlights: [
      "Dinner walk with blue iceberg light",
      "Boardwalk silence near Ilulissat",
      "Sunrise overlook marked for tomorrow",
    ],
    createdAt: "2026-06-19T22:00:00.000Z",
  },
  {
    id: "faroe-report-1",
    tripId: "faroe-2026",
    date: "2026-09-04",
    title: "Cliffs, weather, and warm bowls",
    summary:
      "The Faroe Islands introduced themselves with dramatic skies, loud wind, and a dinner that everyone kept talking about afterward.",
    highlights: [
      "Cloudy arrival over Vagar",
      "Cliff views near Gasadalur",
      "A chaotic voice note in the wind",
      "Soup by the bay while rain moved over the water",
    ],
    createdAt: "2026-09-04T22:00:00.000Z",
  },
];

export function getTripById(tripId: string) {
  return trips.find((trip) => trip.id === tripId);
}

export function getTripMembers(tripId: string) {
  return tripMembers.filter((member) => member.tripId === tripId);
}

export function getTripMemories(tripId: string) {
  return memoryEntries
    .filter((memory) => memory.tripId === tripId)
    .sort(
      (a, b) =>
        new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    );
}

export function getTripDailyReport(tripId: string) {
  return dailyReports.find((report) => report.tripId === tripId);
}

export function groupMemoriesByDate(entries: MemoryEntry[]) {
  return entries.reduce<Record<string, MemoryEntry[]>>((groups, entry) => {
    const date = entry.capturedAt.slice(0, 10);
    groups[date] = [...(groups[date] ?? []), entry];
    return groups;
  }, {});
}
