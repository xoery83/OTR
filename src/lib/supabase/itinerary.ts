import type {
  CreateItineraryEventInput,
  ItineraryEvent,
  ItineraryEventType,
} from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";

type ItineraryRow = {
  id: string;
  trip_id: string;
  title: string;
  description: string | null;
  event_type: ItineraryEventType;
  location_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  booking_reference: string | null;
  url: string | null;
  order_index: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function mapEvent(row: ItineraryRow): ItineraryEvent {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    description: row.description,
    eventType: row.event_type,
    locationName: row.location_name,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    bookingReference: row.booking_reference,
    url: row.url,
    orderIndex: row.order_index ?? 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getItineraryEvents(tripId: string) {
  const { data, error } = await supabase
    .from("itinerary_events")
    .select("*")
    .eq("trip_id", tripId)
    .order("planned_start", { ascending: true, nullsFirst: false })
    .order("order_index", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapEvent);
}

export async function getItineraryEventsForDate(tripId: string, date: string) {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  const { data, error } = await supabase
    .from("itinerary_events")
    .select("*")
    .eq("trip_id", tripId)
    .gte("planned_start", start.toISOString())
    .lt("planned_start", end.toISOString())
    .order("planned_start", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapEvent);
}

export async function createItineraryEvent(input: CreateItineraryEventInput) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to add a plan item.");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error } = await supabase.from("itinerary_events").insert({
    id,
    trip_id: input.tripId,
    title: input.title,
    description: input.description || null,
    event_type: input.eventType,
    location_name: input.locationName || null,
    planned_start: input.plannedStart
      ? new Date(input.plannedStart).toISOString()
      : null,
    planned_end: input.plannedEnd ? new Date(input.plannedEnd).toISOString() : null,
    booking_reference: input.bookingReference || null,
    url: input.url || null,
    created_by: user.id,
  });

  if (error) {
    throw error;
  }

  return {
    id,
    tripId: input.tripId,
    title: input.title,
    description: input.description || null,
    eventType: input.eventType,
    locationName: input.locationName || null,
    plannedStart: input.plannedStart
      ? new Date(input.plannedStart).toISOString()
      : null,
    plannedEnd: input.plannedEnd ? new Date(input.plannedEnd).toISOString() : null,
    bookingReference: input.bookingReference || null,
    url: input.url || null,
    orderIndex: 0,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  } satisfies ItineraryEvent;
}
