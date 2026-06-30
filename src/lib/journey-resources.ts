"use client";

import { getCurrentUser } from "@/lib/supabase/auth";
import { getJourneyChatMessages } from "@/lib/supabase/chat";
import { getItineraryRatingCountsByUser } from "@/lib/supabase/itinerary-ratings";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getJourneyParticipantCount } from "@/lib/journeys/stats";
import { getLedgerData } from "@/lib/supabase/ledger";
import {
  getJourneyLiveLocations,
  getJourneyMapObjects,
} from "@/lib/supabase/map";
import {
  getMediaAssetDisplayUrl,
  getMediaAssetLegacySignedUrlById,
  getMediaAssetPreviewUrl,
  getMediaAssetsByMemoryIds,
  getPhotoFacesForAssets,
  getTripFaceTagCountsByMember,
  getTripImageUploadCountsByUser,
} from "@/lib/supabase/media-assets";
import {
  getSignedMemoryImageUrls,
  getTripMemorySummary,
  getTripMemories,
  getTripMemoriesPage,
} from "@/lib/supabase/memories";
import { getPlannerV2 } from "@/lib/supabase/planner-v2";
import { getTrip, getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { PhotoAssetWithMemory, Trip } from "@/types";

export type JourneyListItem = {
  trip: Trip;
  memorySummary: Awaited<ReturnType<typeof getTripMemorySummary>>;
  memberCount: number;
  planner: Awaited<ReturnType<typeof getPlannerV2>>;
};

export const journeyResourceKey = {
  tripsBase: () => "journeys:base-list",
  trips: () => "journeys:list",
  trip: (tripId: string) => `journey:${tripId}:trip`,
  planner: (tripId: string) => `journey:${tripId}:planner:v2`,
  map: (tripId: string) => `journey:${tripId}:map:v2`,
  ledger: (tripId: string) => `journey:${tripId}:ledger:v2`,
  chat: (tripId: string) => `journey:${tripId}:chat:recent`,
  timeline: (tripId: string) => `journey:${tripId}:timeline:page`,
  people: (tripId: string) => `journey:${tripId}:people`,
  highlights: (tripId: string) => `journey:${tripId}:highlights`,
};

export async function loadJourneyTripResource(tripId: string) {
  return getTrip(tripId);
}

export async function loadJourneyBaseListResource() {
  return getTripsForCurrentUser();
}

export async function loadJourneyListResource(): Promise<JourneyListItem[]> {
  const trips = await getTripsForCurrentUser();
  return Promise.all(
    trips.map(async (trip) => {
      const [memorySummary, members, planner] = await Promise.all([
        getTripMemorySummary(trip.id),
        getJourneyMembers(trip.id),
        getPlannerV2(trip, { includeMemories: false }).catch(() => ({ days: [] })),
      ]);
      return {
        trip,
        memorySummary,
        memberCount: getJourneyParticipantCount(members),
        planner,
      };
    }),
  );
}

export async function loadJourneyPlannerResource(tripId: string) {
  const [tripData, members] = await Promise.all([
    getTrip(tripId),
    getJourneyMembers(tripId),
  ]);
  const [plannerData, ledgerData] = await Promise.all([
    getPlannerV2(tripData),
    getLedgerData(tripId).catch(() => null),
  ]);
  return {
    tripData,
    plannerData,
    members,
    ledgerEntries: ledgerData?.entries ?? [],
    ledgerBaseCurrency: ledgerData?.ledger.baseCurrency ?? "NZD",
  };
}

export async function loadJourneyMapResource(tripId: string) {
  const [user, journey] = await Promise.all([
    getCurrentUser().catch(() => null),
    getTrip(tripId),
  ]);
  const [journeyMembers, locations, objects, planner] = await Promise.all([
    getJourneyMembers(tripId),
    getJourneyLiveLocations(tripId),
    getJourneyMapObjects(tripId),
    getPlannerV2(journey),
  ]);

  return {
    currentUserId: user?.id ?? null,
    trip: journey,
    members: journeyMembers,
    liveLocations: locations,
    mapObjects: objects,
    days: planner.days,
  };
}

export async function loadJourneyLedgerResource(tripId: string) {
  const [tripData, data, user] = await Promise.all([
    getTrip(tripId),
    getLedgerData(tripId),
    getCurrentUser().catch(() => null),
  ]);
  return { tripData, data, userId: user?.id ?? null };
}

export async function loadJourneyChatResource(tripId: string) {
  const [tripData, bundle] = await Promise.all([
    getTrip(tripId),
    getJourneyChatMessages(tripId),
  ]);
  return { tripData, bundle };
}

export async function loadJourneyTimelineResource(tripId: string) {
  const [tripData, memoryPage, memberData, memorySummary] = await Promise.all([
    getTrip(tripId),
    getTripMemoriesPage(tripId, { limit: 60 }),
    getJourneyMembers(tripId),
    getTripMemorySummary(tripId),
  ]);
  const memoryIds = memoryPage.memories.map((memory) => memory.id);
  const [plannerData, assetRows, signedUrls] = await Promise.all([
    getPlannerV2(tripData, { includeMemories: false }),
    getMediaAssetsByMemoryIds(memoryIds),
    getSignedMemoryImageUrls(memoryPage.memories),
  ]);
  const memoryById = new Map(memoryPage.memories.map((memory) => [memory.id, memory]));
  const legacyUrlsByAssetId = await getMediaAssetLegacySignedUrlById(assetRows);
  const assetData: PhotoAssetWithMemory[] = assetRows.map((asset) => ({
    ...asset,
    memory: memoryById.get(asset.memoryEntryId) ?? null,
    displayUrl: getMediaAssetDisplayUrl(asset),
    displayPreviewUrl: getMediaAssetPreviewUrl(asset),
    displayFallbackUrl: legacyUrlsByAssetId[asset.id],
  }));
  const faceData = await getPhotoFacesForAssets(assetData.map((asset) => asset.id)).catch(
    () => ({}),
  );
  return {
    tripData,
    memoryPage,
    memberData,
    memorySummary,
    plannerData,
    assetData,
    signedUrls,
    faceData,
  };
}

export async function loadJourneyPeopleResource(tripId: string) {
  const [tripData, memberData, user] = await Promise.all([
    getTrip(tripId),
    getJourneyMembers(tripId),
    getCurrentUser().catch(() => null),
  ]);
  return { tripData, memberData, currentUserId: user?.id ?? null };
}

export async function loadJourneyHighlightsResource(tripId: string) {
  const tripData = await getTrip(tripId);
  const [
    plannerData,
    ledgerData,
    journeyMembers,
    imageCounts,
    faceCounts,
    ratingCountsByUser,
    memoryData,
  ] = await Promise.all([
    getPlannerV2(tripData),
    getLedgerData(tripData.id),
    getJourneyMembers(tripData.id),
    getTripImageUploadCountsByUser(tripData.id),
    getTripFaceTagCountsByMember(tripData.id),
    getItineraryRatingCountsByUser(tripData.id),
    getTripMemories(tripData.id, { limit: 80 }),
  ]);

  return {
    tripData,
    plannerData,
    ledgerData,
    journeyMembers,
    imageCounts,
    faceCounts,
    ratingCountsByUser,
    memoryData,
  };
}
