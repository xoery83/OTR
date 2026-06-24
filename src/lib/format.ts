export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "Dates to be decided";
  }

  if (!startDate) {
    return `Until ${formatDate(endDate!)}`;
  }

  if (!endDate) {
    return `From ${formatDate(startDate)}`;
  }

  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const formatted = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);

  if (sameDate(date, today)) {
    return `Today · ${formatted}`;
  }

  if (sameDate(date, yesterday)) {
    return `Yesterday · ${formatted}`;
  }

  return formatted;
}

export function toDateTimeLocalValue(value: Date) {
  const offsetMs = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function getDefaultCapturedAt(date?: string | null) {
  const now = new Date();

  if (!date) {
    return toDateTimeLocalValue(now);
  }

  const [year, month, day] = date.split("-").map(Number);
  const localDate = new Date(
    year,
    month - 1,
    day,
    now.getHours(),
    now.getMinutes(),
  );

  return toDateTimeLocalValue(localDate);
}
