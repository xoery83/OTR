import type {
  ItineraryEvent,
  ItineraryReservation,
  MemoryEntry,
  Trip,
  TripDay,
} from "@/types";
import { getTripMemories } from "./memories";
import {
  getItineraryEvents,
  getItineraryReservations,
} from "./itinerary";
import {
  getItineraryRatingSummaries,
  itineraryRatingKey,
} from "./itinerary-ratings";
import { supabase } from "./client";
import { getCurrentUser } from "./auth";

type TripDayRow = {
  id: string;
  trip_id: string;
  day_date: string;
  title: string | null;
  notes: string | null;
  order_index: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlannerV2Day = {
  day: TripDay;
  dayNumber: number;
  dayTag: string | null;
  reservations: ItineraryReservation[];
  activities: ItineraryEvent[];
  memories: MemoryEntry[];
};

export type PlannerV2Data = {
  days: PlannerV2Day[];
};

function mapTripDay(row: TripDayRow): TripDay {
  return {
    id: row.id,
    tripId: row.trip_id,
    dayDate: row.day_date,
    title: row.title,
    notes: row.notes,
    orderIndex: row.order_index ?? 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dateKey(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;
  }
  return value.slice(0, 10);
}

function coversDate(
  date: string,
  startValue: string | null | undefined,
  endValue: string | null | undefined,
) {
  const start = dateKey(startValue);
  const end = dateKey(endValue) ?? start;

  if (!start) return false;
  return start <= date && (!end || end >= date);
}

function coversReservationDate(
  date: string,
  reservation: ItineraryReservation,
) {
  if (reservation.reservationType !== "hotel") {
    return coversDate(date, reservation.startsAt, reservation.endsAt);
  }

  const start = dateKey(reservation.startsAt) ?? dateKey(reservation.endsAt);
  const end = dateKey(reservation.endsAt) ?? start;

  if (!start) return false;

  if (!end || end <= start) {
    return date === start;
  }

  return start <= date && date < end;
}

function tripDateRange(trip: Trip) {
  if (!trip.startDate || !trip.endDate) return [];

  const dates: string[] = [];
  const cursor = new Date(`${trip.startDate}T00:00:00`);
  const end = new Date(`${trip.endDate}T00:00:00`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function dayNumberFromTripStart(date: string, tripStartDate: string | null) {
  if (!tripStartDate) {
    return null;
  }

  const start = new Date(`${tripStartDate}T00:00:00Z`).getTime();
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (!Number.isFinite(start) || !Number.isFinite(target)) {
    return null;
  }
  const dayOffset = Math.floor((target - start) / dayMs) + 1;
  if (dayOffset < 1) return null;
  return dayOffset;
}

function dayTagForDate(date: string, tripStartDate: string | null) {
  if (date === "unscheduled") {
    return null;
  }

  if (!tripStartDate) {
    return null;
  }

  if (date < tripStartDate) {
    return "Prep";
  }

  const journeyDay = dayNumberFromTripStart(date, tripStartDate);
  return journeyDay ? `D${journeyDay}` : "Prep";
}

function makeSyntheticDay(tripId: string, date: string, orderIndex: number): TripDay {
  return {
    id: `synthetic-${date}`,
    tripId,
    dayDate: date,
    title: null,
    notes: null,
    orderIndex,
    createdBy: null,
    createdAt: "",
    updatedAt: "",
  };
}

async function getTripDays(tripId: string) {
  const { data, error } = await supabase
    .from("trip_days")
    .select("*")
    .eq("trip_id", tripId)
    .order("day_date", { ascending: true });

  if (error) {
    if (error.code === "42P01") {
      return [];
    }

    throw error;
  }

  return ((data ?? []) as TripDayRow[]).map(mapTripDay);
}

export async function upsertTripDay({
  tripId,
  date,
  title,
  notes,
}: {
  tripId: string;
  date: string;
  title?: string | null;
  notes?: string | null;
}) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to create trip days.");
  }

  const { data, error } = await supabase
    .from("trip_days")
    .upsert(
      {
        trip_id: tripId,
        day_date: date,
        title: title || null,
        notes: notes || null,
        created_by: user.id,
      },
      { onConflict: "trip_id,day_date" },
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapTripDay(data as TripDayRow);
}

export async function updateTripDayTitle({
  tripId,
  date,
  title,
}: {
  tripId: string;
  date: string;
  title: string | null;
}) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to update trip days.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("trip_days")
    .select("*")
    .eq("trip_id", tripId)
    .eq("day_date", date)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const { data, error } = await supabase
    .from("trip_days")
    .upsert(
      {
        trip_id: tripId,
        day_date: date,
        title: title?.trim() || null,
        notes: existing?.notes ?? null,
        created_by: existing?.created_by ?? user.id,
      },
      { onConflict: "trip_id,day_date" },
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapTripDay(data as TripDayRow);
}

function sortByTime<T>(
  rows: T[],
  getValue: (row: T) => string | null | undefined,
) {
  return [...rows].sort((a, b) => {
    const first = getValue(a) ?? "";
    const second = getValue(b) ?? "";
    return first.localeCompare(second);
  });
}

export async function getPlannerV2(trip: Trip): Promise<PlannerV2Data> {
  const [tripDays, rawReservations, rawActivities, memories, ratingSummaries] =
    await Promise.all([
    getTripDays(trip.id),
    getItineraryReservations(trip.id),
    getItineraryEvents(trip.id),
    getTripMemories(trip.id),
    getItineraryRatingSummaries(trip.id),
  ]);
  const reservations = rawReservations.map((reservation) => ({
    ...reservation,
    ratingSummary:
      ratingSummaries.get(
        itineraryRatingKey("reservation", reservation.id),
      ) ?? null,
  }));
  const activities = rawActivities.map((activity) => ({
    ...activity,
    ratingSummary:
      ratingSummaries.get(itineraryRatingKey("event", activity.id)) ?? null,
  }));

  const daysById = new Map(tripDays.map((day) => [day.id, day]));
  const daysByDate = new Map(tripDays.map((day) => [day.dayDate, day]));
  const allDates = new Set<string>(tripDateRange(trip));

  reservations.forEach((reservation) => {
    const date =
      dateKey(reservation.startsAt) ||
      dateKey(reservation.endsAt) ||
      (reservation.tripDayId && daysById.get(reservation.tripDayId)?.dayDate);
    allDates.add(date ?? "unscheduled");
  });

  activities.forEach((activity) => {
    const date =
      dateKey(activity.plannedStart) ||
      dateKey(activity.plannedEnd) ||
      (activity.tripDayId && daysById.get(activity.tripDayId)?.dayDate);
    allDates.add(date ?? "unscheduled");
  });

  memories.forEach((memory) => {
    const date =
      (memory.tripDayId && daysById.get(memory.tripDayId)?.dayDate) ||
      dateKey(memory.capturedAt);
    if (date) allDates.add(date);
  });

  const sortedDates = [...allDates].sort((a, b) => {
    if (a === "unscheduled") return 1;
    if (b === "unscheduled") return -1;
    return a.localeCompare(b);
  });

  return {
    days: sortedDates.map((date, index) => {
      const day = daysByDate.get(date) ?? makeSyntheticDay(trip.id, date, index);
      const dayTag = dayTagForDate(date, trip.startDate);
      const dayNumberFromTag =
        dayTag?.startsWith("D") ? Number.parseInt(dayTag.slice(1), 10) : null;

      return {
        day,
        dayNumber: dayNumberFromTag ?? index + 1,
        dayTag,
        reservations: sortByTime(
          reservations.filter((reservation) => {
            if (coversReservationDate(date, reservation)) {
              return true;
            }
            if ((reservation.startsAt || reservation.endsAt) && date !== "unscheduled") {
              return false;
            }
            if (reservation.tripDayId) return reservation.tripDayId === day.id;
            return (
              dateKey(reservation.startsAt) === date ||
              dateKey(reservation.endsAt) === date ||
              (!reservation.startsAt && !reservation.endsAt && date === "unscheduled")
            );
          }),
          (reservation) => reservation.startsAt,
        ),
        activities: sortByTime(
          activities.filter((activity) => {
            if (coversDate(date, activity.plannedStart, activity.plannedEnd)) {
              return true;
            }
            if ((activity.plannedStart || activity.plannedEnd) && date !== "unscheduled") {
              return false;
            }
            if (activity.tripDayId) return activity.tripDayId === day.id;
            return (
              dateKey(activity.plannedStart) === date ||
              dateKey(activity.plannedEnd) === date ||
              (!activity.plannedStart && !activity.plannedEnd && date === "unscheduled")
            );
          }),
          (activity) => activity.plannedStart,
        ),
        memories: memories
          .filter((memory) => {
            if (memory.tripDayId) return memory.tripDayId === day.id;
            return dateKey(memory.capturedAt) === date;
          })
          .sort(
            (first, second) =>
              new Date(second.createdAt || second.capturedAt).getTime() -
              new Date(first.createdAt || first.capturedAt).getTime(),
          ),
      };
    }),
  };
}
