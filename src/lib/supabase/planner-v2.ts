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
  const [tripDays, reservations, activities, memories] = await Promise.all([
    getTripDays(trip.id),
    getItineraryReservations(trip.id),
    getItineraryEvents(trip.id),
    getTripMemories(trip.id),
  ]);

  const daysById = new Map(tripDays.map((day) => [day.id, day]));
  const daysByDate = new Map(tripDays.map((day) => [day.dayDate, day]));
  const allDates = new Set<string>(tripDateRange(trip));

  reservations.forEach((reservation) => {
    const date =
      (reservation.tripDayId && daysById.get(reservation.tripDayId)?.dayDate) ||
      dateKey(reservation.startsAt) ||
      dateKey(reservation.endsAt);
    allDates.add(date ?? "unscheduled");
  });

  activities.forEach((activity) => {
    const date =
      (activity.tripDayId && daysById.get(activity.tripDayId)?.dayDate) ||
      dateKey(activity.plannedStart) ||
      dateKey(activity.plannedEnd);
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

      return {
        day,
        dayNumber: index + 1,
        reservations: sortByTime(
          reservations.filter((reservation) => {
            if (coversDate(date, reservation.startsAt, reservation.endsAt)) {
              return true;
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
