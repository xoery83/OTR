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
  return formatFloatingDateTime(value, "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const journeyWallClockTimeZone = "Pacific/Auckland";

const explicitTimeZonePattern = /(?:z|[+-]\d{2}:?\d{2})$/i;

function hasExplicitTimeZone(value: string) {
  return explicitTimeZonePattern.test(value.trim());
}

function localDateTimeParts(value: string) {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "0";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
  };
}

function dateFromFloatingParts(
  parts: NonNullable<ReturnType<typeof localDateTimeParts>>,
) {
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
}

function formatFloatingDateTime(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const trimmed = value.trim();
  const parsed = localDateTimeParts(trimmed);
  const date =
    parsed && !hasExplicitTimeZone(trimmed)
      ? dateFromFloatingParts(parsed)
      : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: parsed && !hasExplicitTimeZone(trimmed) ? "UTC" : journeyWallClockTimeZone,
  }).format(date);
}

export function formatJourneyTime(value: string, locale = "en") {
  return formatFloatingDateTime(value, locale === "zh-CN" ? "zh-CN" : "en", {
    hour: "numeric",
    minute: "2-digit",
  });
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

export function toJourneyDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  const localParts = localDateTimeParts(trimmed);
  if (localParts && !hasExplicitTimeZone(trimmed)) {
    return `${String(localParts.year).padStart(4, "0")}-${String(localParts.month).padStart(
      2,
      "0",
    )}-${String(localParts.day).padStart(2, "0")}T${String(localParts.hour).padStart(
      2,
      "0",
    )}:${String(localParts.minute).padStart(2, "0")}`;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedDateParts(date, journeyWallClockTimeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(
    2,
    "0",
  )}:${String(parts.minute).padStart(2, "0")}`;
}

export function journeyDateKey(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const localParts = localDateTimeParts(trimmed);
  if (localParts && !hasExplicitTimeZone(trimmed)) {
    return `${String(localParts.year).padStart(4, "0")}-${String(localParts.month).padStart(
      2,
      "0",
    )}-${String(localParts.day).padStart(2, "0")}`;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed.slice(0, 10);
  const parts = zonedDateParts(date, journeyWallClockTimeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}`;
}

export function floatingDateTimeToStorageIso(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = localDateTimeParts(trimmed);
  if (!parts || hasExplicitTimeZone(trimmed)) {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const targetUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let utcMs = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const zonedParts = zonedDateParts(new Date(utcMs), journeyWallClockTimeZone);
    const zonedAsUtc = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      zonedParts.second,
    );
    utcMs -= zonedAsUtc - targetUtc;
  }
  return new Date(utcMs).toISOString();
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
