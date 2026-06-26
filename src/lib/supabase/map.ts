import type {
  JourneyLiveLocation,
  JourneyMapObject,
  JourneyMapObjectType,
  JourneyMapObjectVisibility,
} from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";

type JourneyMapObjectRow = {
  id: string;
  journey_id: string;
  type: JourneyMapObjectType;
  source_type: string | null;
  source_id: string | null;
  title: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  timestamp: string | null;
  owner_user_id: string | null;
  visibility: JourneyMapObjectVisibility;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type JourneyLiveLocationRow = {
  journey_id: string;
  user_id: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  recorded_at: string | null;
  is_live_enabled: boolean;
  updated_at: string;
};

export type UpsertLiveLocationInput = {
  journeyId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt?: string;
};

type LiveLocationMemberRow = {
  role: string;
  status: string;
};

function mapMapObject(row: JourneyMapObjectRow): JourneyMapObject {
  return {
    id: row.id,
    journeyId: row.journey_id,
    type: row.type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    description: row.description,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    timestamp: row.timestamp,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLiveLocation(row: JourneyLiveLocationRow): JourneyLiveLocation {
  return {
    journeyId: row.journey_id,
    userId: row.user_id,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    recordedAt: row.recorded_at,
    isLiveEnabled: row.is_live_enabled,
    updatedAt: row.updated_at,
  };
}

export async function canShareJourneyLiveLocation(journeyId: string) {
  const user = await getCurrentUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from("journey_members")
    .select("role, status")
    .eq("trip_id", journeyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  const member = data as LiveLocationMemberRow | null;
  return Boolean(
    member?.status === "linked" &&
      (member.role === "owner" || member.role === "group_member"),
  );
}

async function assertCanShareJourneyLiveLocation(journeyId: string) {
  const canShare = await canShareJourneyLiveLocation(journeyId);
  if (!canShare) {
    throw new Error("Live location is only available to journey members.");
  }
}

export async function getJourneyMapObjects(journeyId: string) {
  const { data, error } = await supabase
    .from("journey_map_objects")
    .select("*")
    .eq("journey_id", journeyId)
    .order("timestamp", { ascending: true, nullsFirst: false });

  if (error) throw error;
  return ((data ?? []) as JourneyMapObjectRow[]).map(mapMapObject);
}

export async function getJourneyLiveLocations(journeyId: string) {
  const { data, error } = await supabase
    .from("journey_live_locations")
    .select("*")
    .eq("journey_id", journeyId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as JourneyLiveLocationRow[]).map(mapLiveLocation);
}

export async function getOwnLiveLocation(journeyId: string) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("journey_live_locations")
    .select("*")
    .eq("journey_id", journeyId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapLiveLocation(data as JourneyLiveLocationRow) : null;
}

export async function upsertLiveLocation(input: UpsertLiveLocationInput) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to share live location.");
  }
  await assertCanShareJourneyLiveLocation(input.journeyId);

  const recordedAt = input.recordedAt ?? new Date().toISOString();

  const { data, error } = await supabase
    .from("journey_live_locations")
    .upsert(
      {
        journey_id: input.journeyId,
        user_id: user.id,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
        recorded_at: recordedAt,
        is_live_enabled: true,
      },
      { onConflict: "journey_id,user_id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return mapLiveLocation(data as JourneyLiveLocationRow);
}

export async function setLiveLocationEnabled(
  journeyId: string,
  isLiveEnabled: boolean,
) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to update live location.");
  }
  await assertCanShareJourneyLiveLocation(journeyId);

  const { data, error } = await supabase
    .from("journey_live_locations")
    .upsert(
      {
        journey_id: journeyId,
        user_id: user.id,
        is_live_enabled: isLiveEnabled,
      },
      { onConflict: "journey_id,user_id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  return mapLiveLocation(data as JourneyLiveLocationRow);
}
