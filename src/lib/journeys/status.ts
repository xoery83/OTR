import type { JourneyStatus, Trip } from "@/types";

function getLocalDate(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getJourneyStatus(trip: Trip, now = new Date()): JourneyStatus {
  const today = getLocalDate(now);
  const start = parseDate(trip.startDate);
  const end = parseDate(trip.endDate);

  if (start && today < start) {
    return "upcoming";
  }

  if (end && today > end) {
    return "completed";
  }

  return "active";
}

export function getJourneyDayNumber(trip: Trip, now = new Date()) {
  const start = parseDate(trip.startDate);

  if (!start || getJourneyStatus(trip, now) !== "active") {
    return null;
  }

  const today = getLocalDate(now);
  const diff = today.getTime() - start.getTime();

  return Math.floor(diff / 86400000) + 1;
}

export function getDaysUntilJourney(trip: Trip, now = new Date()) {
  const start = parseDate(trip.startDate);

  if (!start) {
    return null;
  }

  const today = getLocalDate(now);
  return Math.max(0, Math.ceil((start.getTime() - today.getTime()) / 86400000));
}

function getJourneyStartTime(trip: Trip) {
  const start = parseDate(trip.startDate);
  return start instanceof Date && Number.isFinite(start.getTime())
    ? start.getTime()
    : null;
}

export function compareTripsByStartDateAsc(a: Trip, b: Trip) {
  const aStart = getJourneyStartTime(a);
  const bStart = getJourneyStartTime(b);

  if (aStart && bStart) {
    return aStart - bStart;
  }

  if (aStart) {
    return -1;
  }

  if (bStart) {
    return 1;
  }

  const aCreatedAt = new Date(a.createdAt).getTime();
  const bCreatedAt = new Date(b.createdAt).getTime();
  return aCreatedAt - bCreatedAt;
}
