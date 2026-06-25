import type {
  CreateItineraryEventInput,
  CreateItineraryReservationInput,
  ItineraryEvent,
  ItineraryEventParticipant,
  ItineraryEventParticipantStatus,
  ItineraryItemStatus,
  ItineraryReservation,
  ItineraryReservationParticipant,
  ItineraryReservationType,
  ItineraryEventType,
  UpdateItineraryEventInput,
  UpdateItineraryReservationInput,
} from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";

type ItineraryRow = {
  id: string;
  trip_id: string;
  trip_day_id: string | null;
  reservation_id: string | null;
  title: string;
  description: string | null;
  event_type: ItineraryEventType;
  location_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  booking_reference: string | null;
  url: string | null;
  order_index: number | null;
  source_text: string | null;
  confidence: number | null;
  needs_review: boolean | null;
  status?: ItineraryItemStatus | null;
  is_estimated_time: boolean | null;
  date_confidence: number | null;
  time_confidence: number | null;
  participants_confidence: number | null;
  location_confidence: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ParticipantRow = {
  id: string;
  event_id: string;
  user_id: string;
  participation_status: ItineraryEventParticipantStatus | null;
  created_at: string;
  profiles:
    | {
        display_name: string | null;
        avatar_url: string | null;
      }
    | {
        display_name: string | null;
        avatar_url: string | null;
      }[]
    | null;
};

type ReservationRow = {
  id: string;
  trip_id: string;
  trip_day_id: string | null;
  reservation_type: ItineraryReservationType;
  title: string;
  provider: string | null;
  location_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  confirmation_code: string | null;
  url: string | null;
  source_text: string | null;
  confidence: number | null;
  needs_review: boolean | null;
  status?: ItineraryItemStatus | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ReservationParticipantRow = {
  id: string;
  reservation_id: string;
  user_id: string;
  participation_status: ItineraryEventParticipantStatus | null;
  created_at: string;
  profiles:
    | {
        display_name: string | null;
        avatar_url: string | null;
      }
    | {
        display_name: string | null;
        avatar_url: string | null;
      }[]
    | null;
};

function mapReservationParticipant(
  row: ReservationParticipantRow,
): ItineraryReservationParticipant {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

  return {
    id: row.id,
    reservationId: row.reservation_id,
    userId: row.user_id,
    participationStatus: row.participation_status ?? "planned",
    name: profile?.display_name || "Traveler",
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: row.created_at,
  };
}

function mapReservation(
  row: ReservationRow,
  participants: ItineraryReservationParticipant[] = [],
): ItineraryReservation {
  return {
    id: row.id,
    tripId: row.trip_id,
    tripDayId: row.trip_day_id,
    reservationType: row.reservation_type,
    title: row.title,
    provider: row.provider,
    locationName: row.location_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    confirmationCode: row.confirmation_code,
    url: row.url,
    sourceText: row.source_text,
    confidence: row.confidence,
    needsReview: row.needs_review ?? false,
    status: row.status ?? "planned",
    participants,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipant(row: ParticipantRow): ItineraryEventParticipant {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    participationStatus: row.participation_status ?? "planned",
    name: profile?.display_name || "Traveler",
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: row.created_at,
  };
}

function mapEvent(
  row: ItineraryRow,
  participants: ItineraryEventParticipant[] = [],
): ItineraryEvent {
  return {
    id: row.id,
    tripId: row.trip_id,
    tripDayId: row.trip_day_id,
    reservationId: row.reservation_id,
    title: row.title,
    description: row.description,
    eventType: row.event_type,
    locationName: row.location_name,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    bookingReference: row.booking_reference,
    url: row.url,
    orderIndex: row.order_index ?? 0,
    sourceText: row.source_text,
    confidence: row.confidence,
    needsReview: row.needs_review ?? false,
    status: row.status ?? "planned",
    isEstimatedTime: row.is_estimated_time ?? false,
    dateConfidence: row.date_confidence,
    timeConfidence: row.time_confidence,
    participantsConfidence: row.participants_confidence,
    locationConfidence: row.location_confidence,
    participants,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getParticipantsForEvents(eventIds: string[]) {
  if (eventIds.length === 0) {
    return new Map<string, ItineraryEventParticipant[]>();
  }

  const { data, error } = await supabase
    .from("itinerary_event_participants")
    .select("id, event_id, user_id, participation_status, created_at, profiles(display_name, avatar_url)")
    .in("event_id", eventIds);

  if (error) {
    if (error.code === "42P01") {
      return new Map<string, ItineraryEventParticipant[]>();
    }

    throw error;
  }

  const byEvent = new Map<string, ItineraryEventParticipant[]>();
  ((data ?? []) as ParticipantRow[]).forEach((row) => {
    const participant = mapParticipant(row);
    byEvent.set(row.event_id, [...(byEvent.get(row.event_id) ?? []), participant]);
  });

  return byEvent;
}

async function mapEventsWithParticipants(rows: ItineraryRow[]) {
  const participantsByEvent = await getParticipantsForEvents(rows.map((row) => row.id));
  return rows.map((row) => mapEvent(row, participantsByEvent.get(row.id) ?? []));
}

async function getParticipantsForReservations(reservationIds: string[]) {
  if (reservationIds.length === 0) {
    return new Map<string, ItineraryReservationParticipant[]>();
  }

  const { data, error } = await supabase
    .from("itinerary_reservation_participants")
    .select("id, reservation_id, user_id, participation_status, created_at, profiles(display_name, avatar_url)")
    .in("reservation_id", reservationIds);

  if (error) {
    if (error.code === "42P01") {
      return new Map<string, ItineraryReservationParticipant[]>();
    }

    throw error;
  }

  const byReservation = new Map<string, ItineraryReservationParticipant[]>();
  ((data ?? []) as ReservationParticipantRow[]).forEach((row) => {
    const participant = mapReservationParticipant(row);
    byReservation.set(row.reservation_id, [
      ...(byReservation.get(row.reservation_id) ?? []),
      participant,
    ]);
  });

  return byReservation;
}

export async function getItineraryReservations(tripId: string) {
  const { data, error } = await supabase
    .from("itinerary_reservations")
    .select("*")
    .eq("trip_id", tripId)
    .order("starts_at", { ascending: true, nullsFirst: false });

  if (error) {
    if (error.code === "42P01") {
      return [];
    }

    throw error;
  }

  const rows = (data ?? []) as ReservationRow[];
  const participantsByReservation = await getParticipantsForReservations(
    rows.map((row) => row.id),
  );

  return rows.map((row) =>
    mapReservation(row, participantsByReservation.get(row.id) ?? []),
  );
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

  return mapEventsWithParticipants((data ?? []) as ItineraryRow[]);
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

  return mapEventsWithParticipants((data ?? []) as ItineraryRow[]);
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
    trip_day_id: input.tripDayId || null,
    reservation_id: input.reservationId || null,
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
    source_text: input.sourceText || null,
    confidence: input.confidence ?? null,
    needs_review: input.needsReview ?? false,
    is_estimated_time: input.isEstimatedTime ?? false,
    date_confidence: input.dateConfidence ?? null,
    time_confidence: input.timeConfidence ?? null,
    participants_confidence: input.participantsConfidence ?? null,
    location_confidence: input.locationConfidence ?? null,
    created_by: user.id,
  });

  if (error) {
    throw error;
  }

  if (input.participantUserIds && input.participantUserIds.length > 0) {
    const { error: participantError } = await supabase
      .from("itinerary_event_participants")
      .insert(
        input.participantUserIds.map((userId) => ({
          event_id: id,
          user_id: userId,
          participation_status: "planned",
        })),
      );

    if (participantError) {
      throw participantError;
    }
  }

  return {
    id,
    tripId: input.tripId,
    tripDayId: input.tripDayId || null,
    reservationId: input.reservationId || null,
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
    sourceText: input.sourceText || null,
    confidence: input.confidence ?? null,
    needsReview: input.needsReview ?? false,
    isEstimatedTime: input.isEstimatedTime ?? false,
    dateConfidence: input.dateConfidence ?? null,
    timeConfidence: input.timeConfidence ?? null,
    participantsConfidence: input.participantsConfidence ?? null,
    locationConfidence: input.locationConfidence ?? null,
    participants: [],
    status: "planned",
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  } satisfies ItineraryEvent;
}

export async function createItineraryReservation(
  input: CreateItineraryReservationInput,
) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to add a reservation.");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error } = await supabase.from("itinerary_reservations").insert({
    id,
    trip_id: input.tripId,
    trip_day_id: input.tripDayId || null,
    reservation_type: input.reservationType,
    title: input.title,
    provider: input.provider || null,
    location_name: input.locationName || null,
    starts_at: input.startsAt ? new Date(input.startsAt).toISOString() : null,
    ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    confirmation_code: input.confirmationCode || null,
    url: input.url || null,
    source_text: input.sourceText || null,
    confidence: input.confidence ?? null,
    needs_review: input.needsReview ?? false,
    status: "planned",
    created_by: user.id,
  });

  if (error) {
    throw error;
  }

  if (input.participantUserIds && input.participantUserIds.length > 0) {
    const { error: participantError } = await supabase
      .from("itinerary_reservation_participants")
      .insert(
        input.participantUserIds.map((userId) => ({
          reservation_id: id,
          user_id: userId,
          participation_status: "planned",
        })),
      );

    if (participantError) {
      throw participantError;
    }
  }

  return mapReservation({
    id,
    trip_id: input.tripId,
    trip_day_id: input.tripDayId || null,
    reservation_type: input.reservationType,
    title: input.title,
    provider: input.provider || null,
    location_name: input.locationName || null,
    starts_at: input.startsAt ? new Date(input.startsAt).toISOString() : null,
    ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    confirmation_code: input.confirmationCode || null,
    url: input.url || null,
    source_text: input.sourceText || null,
    confidence: input.confidence ?? null,
    needs_review: input.needsReview ?? false,
    status: "planned",
    created_by: user.id,
    created_at: now,
    updated_at: now,
  });
}

export async function updateItineraryEvent(input: UpdateItineraryEventInput) {
  const { error } = await supabase
    .from("itinerary_events")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      event_type: input.eventType,
      location_name: input.locationName?.trim() || null,
      planned_start: input.plannedStart
        ? new Date(input.plannedStart).toISOString()
        : null,
      planned_end: input.plannedEnd ? new Date(input.plannedEnd).toISOString() : null,
      booking_reference: input.bookingReference?.trim() || null,
      url: input.url?.trim() || null,
      status: input.status ?? "planned",
    })
    .eq("id", input.id)
    .eq("trip_id", input.tripId);

  if (error) throw error;
}

export async function deleteItineraryEvent(id: string) {
  const { error } = await supabase.from("itinerary_events").delete().eq("id", id);
  if (error) throw error;
}

export async function updateItineraryReservation(
  input: UpdateItineraryReservationInput,
) {
  const { error } = await supabase
    .from("itinerary_reservations")
    .update({
      reservation_type: input.reservationType,
      title: input.title.trim(),
      provider: input.provider?.trim() || null,
      location_name: input.locationName?.trim() || null,
      starts_at: input.startsAt ? new Date(input.startsAt).toISOString() : null,
      ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
      confirmation_code: input.confirmationCode?.trim() || null,
      url: input.url?.trim() || null,
      status: input.status ?? "planned",
    })
    .eq("id", input.id)
    .eq("trip_id", input.tripId);

  if (error) throw error;
}

export async function deleteItineraryReservation(id: string) {
  const { error } = await supabase
    .from("itinerary_reservations")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
