import type { LedgerEntry } from "@/types";

export type LedgerAllocationRange = {
  startDate: string | null;
  endDate: string | null;
};

function dateValue(date: string) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function isValidRange(startDate: string, endDate: string) {
  const start = dateValue(startDate);
  const end = dateValue(endDate);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

function allocationDatesInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (!isValidRange(startDate, endDate)) return [];

  const dates: string[] = [];
  let cursor = start;

  while (cursor <= end && dates.length < 90) {
    dates.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

export function getLedgerAllocationDates(
  entry: LedgerEntry,
  range?: LedgerAllocationRange,
) {
  const startDate = range?.startDate ?? entry.startDate ?? entry.expenseDate;
  const endDate = range?.endDate ?? entry.endDate ?? startDate;

  if (!startDate || !endDate) return [entry.expenseDate];

  const dates = allocationDatesInclusive(startDate, endDate);
  return dates.length > 0 ? dates : [entry.expenseDate];
}

export function allocatedLedgerAmountForDay(
  entry: LedgerEntry,
  dayDate: string,
  range?: LedgerAllocationRange,
) {
  const dates = getLedgerAllocationDates(entry, range);

  if (!dates.includes(dayDate)) return 0;

  return entry.baseAmount / dates.length;
}
