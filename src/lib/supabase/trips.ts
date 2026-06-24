import type { CreateTripInput, Trip } from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";
import { upsertProfileForUser } from "./profiles";

type TripRow = {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  created_by: string | null;
  created_at: string;
};

function mapTrip(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    destination: row.destination ?? "",
    startDate: row.start_date,
    endDate: row.end_date,
    coverImageUrl: row.cover_image_url,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function getTripsForCurrentUser() {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapTrip);
}

export async function getTrip(tripId: string) {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();

  if (error) {
    throw error;
  }

  return mapTrip(data);
}

export async function createTrip(input: CreateTripInput) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to create a trip.");
  }

  await upsertProfileForUser(user);

  const tripId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const { error } = await supabase
    .from("trips")
    .insert({
      id: tripId,
      name: input.name,
      destination: input.destination || null,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      created_by: user.id,
    });

  if (error) {
    throw error;
  }

  return {
    id: tripId,
    name: input.name,
    destination: input.destination,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    coverImageUrl: null,
    createdBy: user.id,
    createdAt,
  } satisfies Trip;
}

export async function deleteTrip(tripId: string) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to delete a journey.");
  }

  const { error } = await supabase.from("trips").delete().eq("id", tripId);

  if (error) {
    throw error;
  }
}
