"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/components/I18nProvider";
import type { Locale, TranslationKey } from "@/lib/i18n/dictionaries";
import type { PlannerV2Day } from "@/lib/supabase/planner-v2";
import { getApproxExchangeRate } from "@/lib/exchange-rates";
import { formatTime, toDateTimeLocalValue } from "@/lib/format";
import { getErrorMessage } from "@/lib/errors";
import { compressImageFile, type CompressedImage } from "@/lib/images";
import { getCurrentUser } from "@/lib/supabase/auth";
import {
  createItineraryEvent,
  deleteItineraryEvent,
  deleteItineraryReservation,
  updateItineraryEvent,
  updateItineraryReservation,
} from "@/lib/supabase/itinerary";
import { createLedgerEntry } from "@/lib/supabase/ledger";
import {
  createPhotoMemory,
  createTextMemory,
  getSignedMemoryImageUrls,
} from "@/lib/supabase/memories";
import {
  requestFaceDetection,
  requestPhotoIndexing,
} from "@/lib/supabase/media-assets";
import type {
  JourneyMember,
  ItineraryEventType,
  ItineraryItemStatus,
  ItineraryReservationType,
  LedgerAccountingMode,
  LedgerCategory,
  LedgerEntry,
  MemoryEntry,
} from "@/types";
import { DayMemoryPreview } from "./DayMemoryPreview";

type StoryItem = {
  id: string;
  time: string | null;
  title: string;
  detail: string | null;
  location: string | null;
  kind: string;
  note: string | null;
  itineraryEventId: string | null;
  itineraryReservationId: string | null;
  itemType: "event" | "reservation";
  status: ItineraryItemStatus;
  typeValue: ItineraryEventType | ItineraryReservationType;
  startsAt: string | null;
  endsAt: string | null;
  secondary: string | null;
  url: string | null;
  participantNames: string[];
};

type InlineMemoryState = Record<string, MemoryEntry[]>;

type InlineAttachmentState = {
  file: File;
  compressedImage: CompressedImage;
  fileName: string;
};

type PendingExpense = {
  itemId: string;
  memoryEntryId: string;
  title: string;
  category: LedgerCategory;
  accountingMode: LedgerAccountingMode;
  amount: string;
  currency: string;
  exchangeRate: string;
  payerMemberId: string;
  participantMemberIds: string[];
  addressText: string;
  description: string;
  itineraryEventId: string | null;
  itineraryReservationId: string | null;
  startDate: string | null;
  endDate: string | null;
};

type MemberAlias = {
  alias: string;
  member: JourneyMember;
};

type EditingItem = {
  id: string;
  itemType: "event" | "reservation";
  title: string;
  typeValue: string;
  description: string;
  locationName: string;
  startsAt: string;
  endsAt: string;
  secondary: string;
  url: string;
  status: ItineraryItemStatus;
};

type DraftPlanItem = {
  title: string;
  eventType: ItineraryEventType;
  locationName: string;
  plannedStart: string;
  plannedEnd: string;
  description: string;
};

const bookingLabelKeys: Partial<Record<string, TranslationKey>> = {
  flight: "planner.booking.flight",
  hotel: "planner.booking.hotel",
  car: "planner.booking.car",
  ferry: "planner.booking.ferry",
  tour: "planner.booking.tour",
  restaurant: "planner.booking.restaurant",
  other: "planner.booking.other",
};

const expenseCategories: LedgerCategory[] = [
  "flight",
  "hotel",
  "car",
  "fuel",
  "food",
  "ticket",
  "shopping",
  "transport",
  "insurance",
  "other",
];

const expenseCurrencies = ["ISK", "NZD", "DKK", "EUR", "CNY", "USD", "GBP"];
const eventTypes: ItineraryEventType[] = [
  "flight",
  "hotel",
  "car",
  "activity",
  "shopping",
  "meal",
  "transport",
  "note",
  "other",
];
const reservationTypes: ItineraryReservationType[] = [
  "flight",
  "hotel",
  "car",
  "ferry",
  "tour",
  "restaurant",
  "other",
];
const itemStatuses: ItineraryItemStatus[] = [
  "planned",
  "cancelled",
  "completed",
  "skipped",
];

const eventLabelKeys: Partial<Record<string, TranslationKey>> = {
  flight: "planner.event.flight",
  hotel: "planner.event.hotel",
  car: "planner.event.car",
  activity: "planner.event.activity",
  shopping: "planner.event.shopping",
  meal: "planner.event.meal",
  transport: "planner.event.transport",
  note: "planner.event.note",
  other: "planner.event.other",
};

const expenseCategoryLabelKeys: Record<LedgerCategory, TranslationKey> = {
  flight: "planner.expense.flight",
  hotel: "planner.expense.hotel",
  car: "planner.expense.car",
  fuel: "planner.expense.fuel",
  food: "planner.expense.food",
  ticket: "planner.expense.ticket",
  shopping: "planner.expense.shopping",
  transport: "planner.expense.transport",
  insurance: "planner.expense.insurance",
  other: "planner.expense.other",
};

const statusLabelKeys: Record<ItineraryItemStatus, TranslationKey> = {
  planned: "planner.status.planned",
  cancelled: "planner.status.cancelled",
  completed: "planner.status.completed",
  skipped: "planner.status.skipped",
};

function mapsHref(location: string | null) {
  if (!location) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function dayLocation(plannerDay: PlannerV2Day) {
  const locations = [
    ...plannerDay.activities.map((item) => item.locationName),
    ...plannerDay.reservations.map((item) => item.locationName),
  ].filter((location): location is string => Boolean(location));

  return [...new Set(locations)][0] ?? null;
}

function tonightStay(plannerDay: PlannerV2Day) {
  return plannerDay.reservations.find(
    (reservation) => reservation.reservationType === "hotel",
  );
}

function shouldShowInStory(
  dayDate: string,
  startValue: string | null | undefined,
  endValue: string | null | undefined,
) {
  if (dayDate === "unscheduled") return true;
  const startDate = dateOnly(startValue);
  const endDate = dateOnly(endValue);

  if (startDate && endDate && startDate !== endDate) {
    return dayDate === startDate || dayDate === endDate;
  }

  return true;
}

function storyItems(plannerDay: PlannerV2Day): StoryItem[] {
  const dayDate = plannerDay.day.dayDate;

  return [
    ...plannerDay.reservations
      .filter(
        (item) =>
          item.reservationType !== "hotel" &&
          shouldShowInStory(dayDate, item.startsAt, item.endsAt),
      )
      .map((item) => ({
        id: `reservation-${item.id}`,
        time: item.startsAt,
        title: item.title,
        detail: item.provider || item.confirmationCode || null,
        location: item.locationName,
        kind: item.reservationType,
        note: item.sourceText,
        itineraryEventId: null,
        itineraryReservationId: item.id,
        itemType: "reservation" as const,
        status: item.status,
        typeValue: item.reservationType,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        secondary: item.provider || item.confirmationCode || "",
        url: item.url,
        participantNames: item.participants.map((participant) => participant.name),
      })),
    ...plannerDay.activities
      .filter((item) =>
        shouldShowInStory(dayDate, item.plannedStart, item.plannedEnd),
      )
      .map((item) => ({
        id: `activity-${item.id}`,
        time: item.plannedStart,
        title: item.title,
        detail: item.description,
        location: item.locationName,
        kind: item.eventType,
        note: item.sourceText || item.description,
        itineraryEventId: item.id,
        itineraryReservationId: item.reservationId,
        itemType: "event" as const,
        status: item.status,
        typeValue: item.eventType,
        startsAt: item.plannedStart,
        endsAt: item.plannedEnd,
        secondary: item.bookingReference || "",
        url: item.url,
        participantNames: item.participants.map((participant) => participant.name),
      })),
  ].sort((a, b) => {
    if (!a.time && !b.time) return a.title.localeCompare(b.title);
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time.localeCompare(b.time);
  });
}

function groupedBookings(plannerDay: PlannerV2Day) {
  return Object.entries(
    plannerDay.reservations
      .filter((reservation) => {
        if (reservation.reservationType === "hotel") return true;
        return shouldShowInStory(
          plannerDay.day.dayDate,
          reservation.startsAt,
          reservation.endsAt,
        );
      })
      .reduce<Record<string, typeof plannerDay.reservations>>((groups, reservation) => {
        groups[reservation.reservationType] = [
          ...(groups[reservation.reservationType] ?? []),
          reservation,
        ];
        return groups;
      }, {}),
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-emerald-900">
      {title}
    </h3>
  );
}

function money(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPlannerDayLabel(value: string, locale: Locale) {
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const formatted = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  }).format(date);

  if (sameDate(date, today)) {
    return locale === "zh-CN" ? `今天 · ${formatted}` : `Today · ${formatted}`;
  }

  if (sameDate(date, yesterday)) {
    return locale === "zh-CN" ? `昨天 · ${formatted}` : `Yesterday · ${formatted}`;
  }

  return formatted;
}

function daysBetweenInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 1;
  }

  return Math.floor((end - start) / dayMs) + 1;
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function allocatedAmountForDay(
  entry: LedgerEntry,
  dayDate: string,
  range?: { startDate: string | null; endDate: string | null },
) {
  const startDate = range?.startDate ?? entry.startDate;
  const endDate = range?.endDate ?? entry.endDate;

  if (
    startDate &&
    endDate &&
    startDate <= dayDate &&
    endDate >= dayDate
  ) {
    return entry.baseAmount / daysBetweenInclusive(startDate, endDate);
  }

  return entry.expenseDate === dayDate ? entry.baseAmount : 0;
}

function toLocalInputValue(value: string | null) {
  return value ? toDateTimeLocalValue(new Date(value)) : "";
}

function normalizeCurrency(value: string, fallbackCurrency: string) {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.includes("冰岛") ||
    normalized === "isk" ||
    normalized.includes("iceland")
  ) {
    return "ISK";
  }
  if (normalized.includes("丹麦") || normalized === "dkk") return "DKK";
  if (normalized.includes("欧") || normalized === "eur") return "EUR";
  if (normalized.includes("美元") || normalized === "usd" || normalized === "$") {
    return "USD";
  }
  if (
    normalized.includes("人民币") ||
    normalized === "cny" ||
    normalized === "rmb" ||
    normalized === "¥" ||
    normalized === "￥"
  ) {
    return "CNY";
  }
  if (normalized.includes("纽") || normalized === "nzd") return "NZD";
  if (normalized.includes("英镑") || normalized === "gbp") return "GBP";
  if (normalized.includes("本地")) return fallbackCurrency;

  return value.toUpperCase();
}

function parseMoneyAmount(rawValue: string) {
  const value = rawValue.trim();
  const hasComma = value.includes(",");
  const hasDot = value.includes(".");

  if (hasComma && hasDot) {
    return value.replace(/,/g, "");
  }

  if (hasComma) {
    const parts = value.split(",");
    const last = parts[parts.length - 1];
    const looksLikeThousands =
      parts.length > 1 &&
      parts.slice(1).every((part) => /^\d{3}$/.test(part));

    if (looksLikeThousands) {
      return value.replace(/,/g, "");
    }

    if (last.length <= 2) {
      return value.replace(",", ".");
    }
  }

  return value;
}

function detectExpense(
  text: string,
  item: StoryItem,
  baseCurrency: string,
): Pick<
  PendingExpense,
  "title" | "category" | "amount" | "currency" | "description"
> | null {
  const amountMatch = text.match(
    /(?:^|[^\d])([¥￥€$]|冰岛本地货币|冰岛克朗|冰岛币|本地货币|丹麦克朗|人民币|纽币|美元|欧元|英镑|ISK|DKK|CNY|RMB|NZD|USD|EUR|GBP|kr)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(冰岛本地货币|冰岛克朗|冰岛币|本地货币|丹麦克朗|人民币|纽币|美元|欧元|英镑|ISK|DKK|CNY|RMB|NZD|USD|EUR|GBP|kr)?/i,
  );

  if (!amountMatch) return null;

  const amount = parseMoneyAmount(amountMatch[2]);
  const rawCurrency = amountMatch[1] || amountMatch[3] || baseCurrency;
  const lowerText = `${text} ${item.title} ${item.kind}`.toLowerCase();
  let category: LedgerCategory = "other";

  if (/costco|bonus|购物|采购|超市|shop/.test(lowerText)) {
    category = "shopping";
  } else if (/加油|fuel|gas|petrol/.test(lowerText)) {
    category = "fuel";
  } else if (/晚饭|午饭|早餐|餐|dinner|lunch|meal|restaurant/.test(lowerText)) {
    category = "food";
  } else if (/hotel|stay|accommodation|住宿/.test(lowerText)) {
    category = "hotel";
  } else if (/flight|航班|机票|机场/.test(lowerText)) {
    category = "flight";
  } else if (/car|rental|租车|取车/.test(lowerText)) {
    category = "car";
  } else if (/ticket|tour|门票/.test(lowerText)) {
    category = "ticket";
  } else if (/transport|ferry|bus|taxi|交通|渡轮/.test(lowerText)) {
    category = "transport";
  }

  return {
    title: item.title,
    category,
    amount,
    currency: normalizeCurrency(rawCurrency, baseCurrency),
    description: text,
  };
}

function capturedAtForItem(item: StoryItem, dayDate: string) {
  if (item.time) return item.time;
  if (dayDate === "unscheduled") return new Date().toISOString();

  const now = new Date();
  return `${dayDate}T${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}:00`;
}

function localDateTime(dayDate: string, hour: number, minute = 0) {
  return `${dayDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0",
  )}:00`;
}

function addHours(value: string, hours: number) {
  const date = new Date(value);
  date.setHours(date.getHours() + hours);
  return toDateTimeLocalValue(date);
}

function inferEventType(text: string): ItineraryEventType {
  const lower = text.toLocaleLowerCase();
  if (/flight|航班|飞机|机场|arrival|departure/.test(lower)) return "flight";
  if (/hotel|住宿|入住|check.?in|accommodation/.test(lower)) return "hotel";
  if (/car|租车|取车|还车|rental|pickup/.test(lower)) return "car";
  if (/晚饭|午饭|早餐|餐|dinner|lunch|meal|restaurant/.test(lower)) return "meal";
  if (/bus|taxi|ferry|transfer|交通|渡轮|巴士|打车/.test(lower)) {
    return "transport";
  }
  if (/购物|采购|超市|costco|bonus|shop|shopping/.test(lower)) return "shopping";
  return "activity";
}

function chineseNumberToInt(value: string) {
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (digits[value.slice(1)] ?? 0);
  if (value.endsWith("十")) return (digits[value.slice(0, 1)] ?? 1) * 10;
  if (value.includes("十")) {
    const [ten, one] = value.split("十");
    return (digits[ten] ?? 1) * 10 + (digits[one] ?? 0);
  }

  return digits[value] ?? Number.NaN;
}

function stripTimeWords(text: string) {
  return text
    .replace(/(今天|今晚|明早|明天|上午|中午|下午|傍晚|晚上|早上|夜里)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[点:：]\s*(半|一刻|三刻|\d{1,2}分?)?/g, "")
    .replace(/\b([01]?\d|2[0-3])[:：]([0-5]\d)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferLocation(text: string) {
  const meetingMatch = text.match(
    /(?:在)?\s*([A-Za-z0-9\u4e00-\u9fff\s&.'-]{2,30}?(?:门口|入口|大厅|前台|停车场|机场|车站|码头))\s*(?:集合|见面|meet)/i,
  );
  if (meetingMatch) return meetingMatch[1].trim();

  const atMatch = text.match(
    /(?:在|到|抵达|from|at)\s*([A-Za-z0-9\u4e00-\u9fff\s&.'-]{2,40}?)(?:集合|见面|出发|吃|采购|购物|看|玩|$|[，。,.;；])/i,
  );
  if (atMatch) return atMatch[1].trim();

  const destinationMatch = text.match(
    /(?:去|前往|to)\s*([A-Za-z0-9\u4e00-\u9fff\s&.'-]{2,40}?)(?:$|[，。,.;；])/i,
  );
  return destinationMatch?.[1]?.trim() ?? "";
}

function inferStartTime(text: string, dayDate: string) {
  const explicit = text.match(/(?:^|[^\d])([01]?\d|2[0-3])[:：]([0-5]\d)/);
  if (explicit) {
    return localDateTime(dayDate, Number(explicit[1]), Number(explicit[2]));
  }

  const chineseHour = text.match(
    /(今天|今晚|明早|明天|上午|中午|下午|傍晚|晚上|早上|夜里)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*点\s*(半|一刻|三刻|(\d{1,2})分?)?/,
  );
  if (chineseHour) {
    const period = chineseHour[1] ?? "";
    let hour = chineseNumberToInt(chineseHour[2]);
    let minute = 0;
    if (chineseHour[3] === "半") minute = 30;
    if (chineseHour[3] === "一刻") minute = 15;
    if (chineseHour[3] === "三刻") minute = 45;
    if (chineseHour[4]) minute = Number(chineseHour[4]);

    if (
      (period === "下午" ||
        period === "傍晚" ||
        period === "晚上" ||
        period === "今晚" ||
        period === "夜里") &&
      hour < 12
    ) {
      hour += 12;
    }
    if (period === "中午" && hour < 11) hour += 12;
    return localDateTime(dayDate, hour, minute);
  }

  const lower = text.toLocaleLowerCase();
  if (/morning|上午|早上/.test(lower)) return localDateTime(dayDate, 9);
  if (/afternoon|下午/.test(lower)) return localDateTime(dayDate, 13);
  if (/evening|晚上|傍晚/.test(lower)) return localDateTime(dayDate, 18);
  if (/night|夜里/.test(lower)) return localDateTime(dayDate, 20);

  return localDateTime(dayDate, 12);
}

function draftPlanFromText(text: string, dayDate: string): DraftPlanItem {
  const plannedStart = inferStartTime(text, dayDate);
  const eventType = inferEventType(text);
  const locationName = inferLocation(text);
  const withoutTime = stripTimeWords(text)
    .replace(/^(大家|全员|所有人|我们)\s*/, "")
    .replace(/[。.!！]$/, "")
    .trim();
  const actionMatch = withoutTime.match(/(.{2,30}?(?:门口|入口|大厅|前台|停车场))\s*集合\s*(?:去|前往)?\s*(.+)$/);
  const title = (actionMatch
    ? `${actionMatch[1].trim()}集合 · ${actionMatch[2].trim()}`
    : withoutTime)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return {
    title: title || "New plan item",
    eventType,
    locationName,
    plannedStart: toDateTimeLocalValue(new Date(plannedStart)),
    plannedEnd: addHours(plannedStart, eventType === "meal" ? 1.5 : 1),
    description: text.trim(),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function memberAliases(members: JourneyMember[]) {
  const aliases = new Map<string, MemberAlias>();

  members
    .filter((member) => member.role === "owner" || member.role === "group_member")
    .forEach((member) => {
      const candidates = [
        member.displayName,
        ...(member.notes ?? "")
          .split(/[,，、/|;\n]+/)
          .map((value) => value.trim()),
      ].filter((value) => value.length >= 2);

      candidates.forEach((alias) => {
        aliases.set(alias.toLocaleLowerCase(), { alias, member });
      });
    });

  return [...aliases.values()].sort((a, b) => b.alias.length - a.alias.length);
}

function HighlightedText({
  text,
  aliases,
}: {
  text: string;
  aliases: MemberAlias[];
}) {
  if (aliases.length === 0) return <>{text}</>;

  const pattern = new RegExp(
    `(${aliases.map((item) => escapeRegExp(item.alias)).join("|")})`,
    "gi",
  );
  const parts = text.split(pattern).filter(Boolean);

  return (
    <>
      {parts.map((part, index) => {
        const match = aliases.find(
          (item) => item.alias.toLocaleLowerCase() === part.toLocaleLowerCase(),
        );

        if (!match) return <span key={`${part}-${index}`}>{part}</span>;

        return (
          <span
            key={`${part}-${index}`}
            className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800"
            title={`Matched group member: ${match.member.displayName}`}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}

export function PlannerDayCard({
  tripId,
  plannerDay,
  journeyMembers,
  ledgerEntries = [],
  ledgerBaseCurrency = "NZD",
  preserveOriginalPhotos = false,
  nextDay,
  onLedgerEntryCreated,
  onPlannerChanged,
}: {
  tripId: string;
  plannerDay: PlannerV2Day;
  journeyMembers?: JourneyMember[];
  ledgerEntries?: LedgerEntry[];
  ledgerBaseCurrency?: string;
  preserveOriginalPhotos?: boolean;
  nextDay?: PlannerV2Day | null;
  onLedgerEntryCreated?: () => void;
  onPlannerChanged?: () => void;
}) {
  const { locale, t } = useI18n();
  const { day, dayNumber, dayTag, memories } = plannerDay;
  const dayLabel =
    day.dayDate === "unscheduled"
      ? t("planner.day.unscheduled")
      : formatPlannerDayLabel(day.dayDate, locale);
  const stay = tonightStay(plannerDay);
  const stayMapsHref = mapsHref(stay?.locationName ?? null);
  const stayItem: StoryItem | null = stay
    ? {
        id: `reservation-${stay.id}`,
        time: stay.startsAt,
        title: stay.title,
        detail: stay.provider || stay.confirmationCode || null,
        location: stay.locationName,
        kind: "hotel",
        note: stay.sourceText,
        itineraryEventId: null,
        itineraryReservationId: stay.id,
        itemType: "reservation",
        status: stay.status,
        typeValue: stay.reservationType,
        startsAt: stay.startsAt,
        endsAt: stay.endsAt,
        secondary: stay.provider || stay.confirmationCode || "",
        url: stay.url,
        participantNames: stay.participants.map((participant) => participant.name),
      }
    : null;
  const story = storyItems(plannerDay);
  const bookings = groupedBookings(plannerDay);
  const nextStory = nextDay ? storyItems(nextDay).slice(0, 2) : [];
  const aliases = memberAliases(journeyMembers ?? []);
  const ledgerCurrency = ledgerEntries[0]?.baseCurrency ?? "NZD";
  const reservationsById = new Map(
    plannerDay.reservations.map((reservation) => [reservation.id, reservation]),
  );
  const activitiesById = new Map(
    plannerDay.activities.map((activity) => [activity.id, activity]),
  );
  function linkedLedgerRange(entry: LedgerEntry) {
    if (entry.itineraryReservationId) {
      const reservation = reservationsById.get(entry.itineraryReservationId);
      if (reservation) {
        const startDate = dateOnly(reservation.startsAt) ?? dateOnly(reservation.endsAt);
        const endDate = dateOnly(reservation.endsAt) ?? startDate;
        return { startDate, endDate };
      }
    }

    if (entry.itineraryEventId) {
      const activity = activitiesById.get(entry.itineraryEventId);
      if (activity) {
        const startDate = dateOnly(activity.plannedStart) ?? dateOnly(activity.plannedEnd);
        const endDate = dateOnly(activity.plannedEnd) ?? startDate;
        return { startDate, endDate };
      }
    }

    return {
      startDate: entry.startDate,
      endDate: entry.endDate,
    };
  }

  function allocatedLedgerAmount(entry: LedgerEntry) {
    return allocatedAmountForDay(entry, day.dayDate, linkedLedgerRange(entry));
  }

  function rangeForStoryItem(item: StoryItem) {
    const startDate = dateOnly(item.startsAt) ?? dateOnly(item.endsAt);
    return {
      startDate,
      endDate: dateOnly(item.endsAt) ?? startDate,
    };
  }

  const ledgerTotal = ledgerEntries.reduce(
    (total, entry) => total + allocatedLedgerAmount(entry),
    0,
  );
  const sharedTotal = ledgerEntries
    .filter((entry) => entry.accountingMode === "shared")
    .reduce(
      (total, entry) => total + allocatedLedgerAmount(entry),
      0,
    );
  const statsOnlyTotal = ledgerEntries
    .filter((entry) => entry.accountingMode === "stats_only")
    .reduce(
      (total, entry) => total + allocatedLedgerAmount(entry),
      0,
    );
  const reviewCount = ledgerEntries.filter(
    (entry) => entry.status !== "complete" && allocatedLedgerAmount(entry) > 0,
  ).length;
  const [memoryTextByItem, setMemoryTextByItem] = useState<Record<string, string>>(
    {},
  );
  const [attachmentByItem, setAttachmentByItem] = useState<
    Record<string, InlineAttachmentState | undefined>
  >({});
  const [imageUrlByMemoryPath, setImageUrlByMemoryPath] = useState<
    Record<string, string>
  >({});
  const [preparingAttachmentId, setPreparingAttachmentId] = useState<
    string | null
  >(null);
  const [indexingStatusByItem, setIndexingStatusByItem] = useState<
    Record<string, string>
  >({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const attachmentByItemRef = useRef(attachmentByItem);
  const [inlineMemories, setInlineMemories] = useState<InlineMemoryState>({});
  const [savingMemoryId, setSavingMemoryId] = useState<string | null>(null);
  const [savingExpenseId, setSavingExpenseId] = useState<string | null>(null);
  const [pendingExpense, setPendingExpense] = useState<PendingExpense | null>(
    null,
  );
  const [memoryErrorByItem, setMemoryErrorByItem] = useState<Record<string, string>>(
    {},
  );
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const [canManagePlans, setCanManagePlans] = useState(false);
  const [currentMember, setCurrentMember] = useState<JourneyMember | null>(null);
  const [showMineOnly, setShowMineOnly] = useState(false);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [isAddingPlan, setIsAddingPlan] = useState(false);
  const [newPlanText, setNewPlanText] = useState("");
  const [draftPlan, setDraftPlan] = useState<DraftPlanItem | null>(null);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  function activeMembers() {
    return (journeyMembers ?? []).filter(
      (member) => member.role === "owner" || member.role === "group_member",
    );
  }

  useEffect(() => {
    let isMounted = true;

    async function checkMembership() {
      const user = await getCurrentUser().catch(() => null);
      const allowed = Boolean(
        user &&
          activeMembers().some((member) => member.userId === user.id),
      );
      const member =
        activeMembers().find((journeyMember) => journeyMember.userId === user?.id) ??
        null;
      if (isMounted) {
        setCanManagePlans(allowed);
        setCurrentMember(member);
      }
    }

    checkMembership();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyMembers]);

  useEffect(() => {
    attachmentByItemRef.current = attachmentByItem;
  }, [attachmentByItem]);

  useEffect(() => {
    return () => {
      Object.values(attachmentByItemRef.current).forEach((attachment) => {
        if (attachment?.compressedImage.previewUrl) {
          URL.revokeObjectURL(attachment.compressedImage.previewUrl);
        }
      });
    };
  }, []);

  function ledgerTotalForItem(item: StoryItem) {
    return ledgerEntries
      .filter(
        (entry) =>
          (item.itineraryEventId &&
            entry.itineraryEventId === item.itineraryEventId) ||
          (item.itineraryReservationId &&
            entry.itineraryReservationId === item.itineraryReservationId),
      )
      .reduce((total, entry) => total + entry.baseAmount, 0);
  }

  function persistedMemoriesForItem(item: StoryItem) {
    return memories.filter(
      (memory) => {
        if (
          (item.itineraryEventId &&
            memory.itineraryEventId === item.itineraryEventId) ||
          (item.itineraryReservationId &&
            memory.itineraryReservationId === item.itineraryReservationId)
        ) {
          return true;
        }

        if (memory.itineraryEventId || memory.itineraryReservationId || !item.time) {
          return false;
        }

        const memoryTime = new Date(memory.capturedAt).getTime();
        const itemTime = new Date(item.time).getTime();
        const sameMinute =
          Number.isFinite(memoryTime) &&
          Number.isFinite(itemTime) &&
          Math.abs(memoryTime - itemTime) < 60 * 1000;
        const sameLocation =
          item.location &&
          memory.locationName &&
          item.location.trim().toLocaleLowerCase() ===
            memory.locationName.trim().toLocaleLowerCase();

        return Boolean(sameMinute && sameLocation);
      },
    );
  }

  function memoriesForItem(item: StoryItem) {
    const byId = new Map<string, MemoryEntry>();

    persistedMemoriesForItem(item).forEach((memory) => {
      byId.set(memory.id, memory);
    });

    (inlineMemories[item.id] ?? []).forEach((memory) => {
      byId.set(memory.id, memory);
    });

    return [...byId.values()].sort(
      (first, second) =>
        new Date(second.createdAt || second.capturedAt).getTime() -
        new Date(first.createdAt || first.capturedAt).getTime(),
    );
  }

  function currentMemberAliases() {
    if (!currentMember) return [];

    return [
      currentMember.displayName,
      ...(currentMember.notes ?? "")
        .split(/[,，、/|;\n]+/)
        .map((value) => value.trim()),
    ]
      .filter((value) => value.length >= 2)
      .map((value) => value.toLocaleLowerCase());
  }

  function textMentionsMe(text: string | null | undefined) {
    if (!text) return false;
    const lower = text.toLocaleLowerCase();
    return currentMemberAliases().some((alias) => lower.includes(alias));
  }

  function textMentionsEveryone(text: string | null | undefined) {
    return Boolean(text && /@所有人|@all|@everyone/i.test(text));
  }

  function memoryTargetsMe(memory: MemoryEntry) {
    const lower = memory.content.toLocaleLowerCase();
    const hasMention = /@/.test(lower);
    const mentionsAll = textMentionsEveryone(memory.content);

    if (mentionsAll) return true;
    if (textMentionsMe(memory.content)) return true;

    return !hasMention;
  }

  function itemRelatesToMe(item: StoryItem) {
    if (!currentMember) return true;
    if (
      textMentionsEveryone(item.title) ||
      textMentionsEveryone(item.detail) ||
      textMentionsEveryone(item.note) ||
      textMentionsEveryone(item.location)
    ) {
      return true;
    }

    if (
      textMentionsMe(item.title) ||
      textMentionsMe(item.detail) ||
      textMentionsMe(item.note) ||
      textMentionsMe(item.location) ||
      textMentionsMe(item.participantNames.join(" "))
    ) {
      return true;
    }

    return memoriesForItem(item).some(memoryTargetsMe);
  }

  const visibleStory = showMineOnly
    ? story.filter((item) => itemRelatesToMe(item))
    : story;

  function itemSubtitle(item: StoryItem) {
    const total = ledgerTotalForItem(item);
    const label = item.detail || item.location || labelForItemKind(item.kind);
    return total > 0
      ? `${label} · ${money(total, ledgerCurrency, locale)}`
      : label;
  }

  function labelForItemKind(value: string) {
    const key = bookingLabelKeys[value] ?? eventLabelKeys[value];
    return key ? t(key) : value;
  }

  function labelForExpenseCategory(value: LedgerCategory) {
    return t(expenseCategoryLabelKeys[value]);
  }

  function labelForEventType(value: ItineraryEventType) {
    return t(eventLabelKeys[value] ?? "planner.event.other");
  }

  function labelForReservationType(value: ItineraryReservationType) {
    return t(bookingLabelKeys[value] ?? "planner.booking.other");
  }

  function labelForStatus(value: ItineraryItemStatus) {
    return t(statusLabelKeys[value]);
  }

  function startEditItem(item: StoryItem) {
    setEditingItem({
      id:
        item.itemType === "event"
          ? item.itineraryEventId!
          : item.itineraryReservationId!,
      itemType: item.itemType,
      title: item.title,
      typeValue: item.typeValue,
      description: item.note ?? "",
      locationName: item.location ?? "",
      startsAt: toLocalInputValue(item.startsAt),
      endsAt: toLocalInputValue(item.endsAt),
      secondary: item.secondary ?? "",
      url: item.url ?? "",
      status: item.status,
    });
    setPlanError(null);
  }

  async function saveEditingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingItem || isSavingPlan) return;

    setIsSavingPlan(true);
    setPlanError(null);

    try {
      if (editingItem.itemType === "event") {
        await updateItineraryEvent({
          id: editingItem.id,
          tripId,
          title: editingItem.title,
          description: editingItem.description,
          eventType: editingItem.typeValue as ItineraryEventType,
          locationName: editingItem.locationName,
          plannedStart: editingItem.startsAt,
          plannedEnd: editingItem.endsAt,
          bookingReference: editingItem.secondary,
          url: editingItem.url,
          status: editingItem.status,
        });
      } else {
        await updateItineraryReservation({
          id: editingItem.id,
          tripId,
          reservationType: editingItem.typeValue as ItineraryReservationType,
          title: editingItem.title,
          provider: editingItem.secondary,
          locationName: editingItem.locationName,
          startsAt: editingItem.startsAt,
          endsAt: editingItem.endsAt,
          confirmationCode: "",
          url: editingItem.url,
          status: editingItem.status,
        });
      }

      setEditingItem(null);
      await onPlannerChanged?.();
    } catch (error) {
      setPlanError(getErrorMessage(error, t("planner.error.updateItem")));
    } finally {
      setIsSavingPlan(false);
    }
  }

  async function deleteEditingItem() {
    if (!editingItem) return;
    const confirmed = globalThis.confirm(
      t("planner.confirm.delete", { title: editingItem.title }),
    );
    if (!confirmed) return;

    setIsSavingPlan(true);
    setPlanError(null);

    try {
      if (editingItem.itemType === "event") {
        await deleteItineraryEvent(editingItem.id);
      } else {
        await deleteItineraryReservation(editingItem.id);
      }
      setEditingItem(null);
      await onPlannerChanged?.();
    } catch (error) {
      setPlanError(getErrorMessage(error, t("planner.error.deleteItem")));
    } finally {
      setIsSavingPlan(false);
    }
  }

  function mentionQuery(itemId: string) {
    const text = memoryTextByItem[itemId] ?? "";
    const match = text.match(/@([^\s@]*)$/);
    return match ? match[1].toLocaleLowerCase() : null;
  }

  function mentionOptions(itemId: string) {
    const query = mentionQuery(itemId);
    if (query === null) return [];

    return [
      { id: "all", label: t("planner.mentions.everyone") },
      ...activeMembers().map((member) => ({
        id: member.id,
        label: member.displayName,
      })),
    ].filter((option) => option.label.toLocaleLowerCase().includes(query));
  }

  function insertMention(itemId: string, label: string) {
    setMemoryTextByItem((current) => {
      const text = current[itemId] ?? "";
      return {
        ...current,
        [itemId]: text.replace(/@([^\s@]*)$/, `@${label} `),
      };
    });
  }

  async function handleInlineAttachmentChange(
    event: ChangeEvent<HTMLInputElement>,
    itemId: string,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setPreparingAttachmentId(itemId);
    setMemoryErrorByItem((current) => ({ ...current, [itemId]: "" }));

    try {
      const compressedImage = await compressImageFile(file);

      setAttachmentByItem((current) => {
        const previous = current[itemId];
        if (previous?.compressedImage.previewUrl) {
          URL.revokeObjectURL(previous.compressedImage.previewUrl);
        }

        return {
          ...current,
          [itemId]: {
            file,
            compressedImage,
            fileName: file.name,
          },
        };
      });
    } catch (error) {
      setMemoryErrorByItem((current) => ({
        ...current,
        [itemId]: getErrorMessage(error, t("planner.error.prepareImage")),
      }));
    } finally {
      setPreparingAttachmentId(null);
    }
  }

  function removeInlineAttachment(itemId: string) {
    setAttachmentByItem((current) => {
      const next = { ...current };
      const previous = next[itemId];

      if (previous?.compressedImage.previewUrl) {
        URL.revokeObjectURL(previous.compressedImage.previewUrl);
      }

      delete next[itemId];
      return next;
    });
  }

  async function runPhotoProcessing(memory: MemoryEntry, itemId: string) {
    if (!memory.mediaAssetId) return;

    setIndexingStatusByItem((current) => ({
      ...current,
      [itemId]: t("memory.indexingStarted"),
    }));

    const [indexResult, faceResult] = await Promise.allSettled([
      requestPhotoIndexing(memory.mediaAssetId, tripId),
      requestFaceDetection(memory.mediaAssetId, tripId),
    ]);

    setIndexingStatusByItem((current) => ({
      ...current,
      [itemId]:
        indexResult.status === "fulfilled" && faceResult.status === "fulfilled"
          ? t("memory.indexingDone")
          : t("memory.indexingFailed"),
    }));
  }

  function prepareDraftPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newPlanText.trim();
    if (!text || day.dayDate === "unscheduled") return;
    setDraftPlan(draftPlanFromText(text, day.dayDate));
    setPlanError(null);
  }

  async function saveDraftPlan() {
    if (!draftPlan || isSavingPlan || day.dayDate === "unscheduled") return;

    setIsSavingPlan(true);
    setPlanError(null);

    try {
      await createItineraryEvent({
        tripId,
        tripDayId: day.id.startsWith("synthetic-") ? null : day.id,
        title: draftPlan.title,
        description: draftPlan.description,
        eventType: draftPlan.eventType,
        locationName: draftPlan.locationName,
        plannedStart: draftPlan.plannedStart,
        plannedEnd: draftPlan.plannedEnd,
        bookingReference: "",
        url: "",
        sourceText: newPlanText.trim(),
        needsReview: false,
        isEstimatedTime: true,
      });
      setIsAddingPlan(false);
      setNewPlanText("");
      setDraftPlan(null);
      await onPlannerChanged?.();
    } catch (error) {
      setPlanError(getErrorMessage(error, t("planner.error.addItem")));
    } finally {
      setIsSavingPlan(false);
    }
  }

  useEffect(() => {
    if (!pendingExpense) return;

    let isMounted = true;

    async function loadRate() {
      if (!pendingExpense) return;

      setIsLoadingRate(true);
      try {
        const result = await getApproxExchangeRate(
          pendingExpense.currency,
          ledgerBaseCurrency,
        );
        if (isMounted) {
          updatePendingExpense({
            exchangeRate: result.rate.toFixed(4),
          });
        }
      } catch {
        if (isMounted && pendingExpense.currency === ledgerBaseCurrency) {
          updatePendingExpense({ exchangeRate: "1" });
        }
      } finally {
        if (isMounted) setIsLoadingRate(false);
      }
    }

    loadRate();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExpense?.currency, ledgerBaseCurrency]);

  async function addInlineMemory(
    event: FormEvent<HTMLFormElement>,
    item: StoryItem,
  ) {
    event.preventDefault();
    const content = (memoryTextByItem[item.id] ?? "").trim();
    const attachment = attachmentByItem[item.id];
    if ((!content && !attachment) || savingMemoryId) return;

    setSavingMemoryId(item.id);
    setMemoryErrorByItem((current) => ({ ...current, [item.id]: "" }));
    setIndexingStatusByItem((current) => ({ ...current, [item.id]: "" }));

    try {
      const memoryInput = {
        capturedAt: capturedAtForItem(item, day.dayDate),
        locationName: item.location ?? "",
        tripDayId: day.id.startsWith("synthetic-") ? null : day.id,
        itineraryEventId: item.itineraryEventId,
        itineraryReservationId: item.itineraryReservationId,
      };
      const saved = attachment
        ? await createPhotoMemory(
            tripId,
            attachment.compressedImage,
            attachment.fileName,
            content,
            memoryInput,
            preserveOriginalPhotos ? attachment.file : null,
          )
        : await createTextMemory(tripId, content, memoryInput);

      if (saved.mediaUrl) {
        const signedUrls = await getSignedMemoryImageUrls([saved]);
        setImageUrlByMemoryPath((current) => ({ ...current, ...signedUrls }));
      }

      setInlineMemories((current) => ({
        ...current,
        [item.id]: [...(current[item.id] ?? []), saved],
      }));
      setMemoryTextByItem((current) => ({ ...current, [item.id]: "" }));
      if (attachment) {
        removeInlineAttachment(item.id);
        void runPhotoProcessing(saved, item.id);
      }

      const detectedExpense = detectExpense(content, item, ledgerBaseCurrency);
      if (detectedExpense) {
        const user = await getCurrentUser().catch(() => null);
        const defaultPayer =
          activeMembers().find((member) => member.userId === user?.id)?.id ?? "";
        const matchedParticipantIds = [
          ...new Set(
            aliases
              .filter((alias) =>
                item.title
                  .toLocaleLowerCase()
                  .includes(alias.alias.toLocaleLowerCase()),
              )
              .map((alias) => alias.member.id),
          ),
        ];
        const defaultParticipantIds =
          detectedExpense.category === "flight" && matchedParticipantIds.length > 0
            ? matchedParticipantIds
            : activeMembers().map((member) => member.id);
        const perPerson = /每人|每位|each|per person/i.test(content);
        const detectedAmount =
          perPerson && defaultParticipantIds.length > 1
            ? String(
                Number(detectedExpense.amount) * defaultParticipantIds.length,
              )
            : detectedExpense.amount;

        setPendingExpense({
          itemId: item.id,
          memoryEntryId: saved.id,
          title: detectedExpense.title,
          category: detectedExpense.category,
          accountingMode:
            detectedExpense.category === "flight" ? "stats_only" : "shared",
          amount: detectedAmount,
          currency: detectedExpense.currency,
          exchangeRate:
            detectedExpense.currency === ledgerBaseCurrency ? "1" : "",
          payerMemberId: defaultPayer,
          participantMemberIds: defaultParticipantIds,
          addressText: item.location ?? "",
          description: detectedExpense.description,
          itineraryEventId: item.itineraryEventId,
          itineraryReservationId: item.itineraryReservationId,
          ...rangeForStoryItem(item),
        });
      }
    } catch (error) {
      setMemoryErrorByItem((current) => ({
        ...current,
        [item.id]: getErrorMessage(error, t("planner.error.saveMemory")),
      }));
    } finally {
      setSavingMemoryId(null);
    }
  }

  function updatePendingExpense(patch: Partial<PendingExpense>) {
    setPendingExpense((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleExpenseParticipant(memberId: string) {
    if (!pendingExpense) return;
    const selected = new Set(pendingExpense.participantMemberIds);
    if (selected.has(memberId)) {
      selected.delete(memberId);
    } else {
      selected.add(memberId);
    }
    updatePendingExpense({ participantMemberIds: [...selected] });
  }

  async function confirmPendingExpense() {
    if (!pendingExpense || savingExpenseId) return;

    setSavingExpenseId(pendingExpense.itemId);
    setExpenseError(null);

    try {
      await createLedgerEntry({
        journeyId: tripId,
        itineraryEventId: pendingExpense.itineraryEventId,
        itineraryReservationId: pendingExpense.itineraryReservationId,
        memoryEntryId: pendingExpense.memoryEntryId,
        title: pendingExpense.title,
        description: pendingExpense.description,
        category: pendingExpense.category,
        accountingMode: pendingExpense.accountingMode,
        expenseDate:
          day.dayDate === "unscheduled" ? new Date().toISOString().slice(0, 10) : day.dayDate,
        startDate: pendingExpense.startDate ?? "",
        endDate: pendingExpense.endDate ?? "",
        originalAmount: Number(pendingExpense.amount),
        originalCurrency: pendingExpense.currency,
        baseCurrency: ledgerBaseCurrency,
        exchangeRate: Number(pendingExpense.exchangeRate || 1),
        payerMemberId: pendingExpense.payerMemberId || null,
        participantMemberIds:
          pendingExpense.participantMemberIds,
        addressText: pendingExpense.addressText,
      });
      setPendingExpense(null);
      onLedgerEntryCreated?.();
    } catch (error) {
      setExpenseError(getErrorMessage(error, t("planner.error.addExpense")));
    } finally {
      setSavingExpenseId(null);
    }
  }

  return (
    <article className="overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-sm">
      <header className="bg-[#fff8ec] p-4 sm:p-5">
        <div className="grid grid-cols-[72px_1fr] gap-3">
          <div className="grid h-[88px] place-items-center rounded-2xl bg-emerald-800 text-white shadow-sm">
            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em]">
                {t("planner.day.label")}
              </p>
              <p className="text-3xl font-semibold leading-none">
                {dayTag || dayNumber}
              </p>
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold text-emerald-800">{dayLabel}</p>
              {ledgerTotal > 0 ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-900">
                  {t("planner.day.cost", {
                    amount: money(ledgerTotal, ledgerCurrency, locale),
                  })}
                </span>
              ) : null}
            </div>
            <h2 className="mt-1 text-xl font-semibold leading-tight text-stone-950">
              {day.title || t("planner.day.open")}
            </h2>
            <p className="mt-2 truncate text-sm text-stone-600">
              {dayLocation(plannerDay) ?? t("planner.location.tbd")}
            </p>
          </div>
        </div>

      </header>

      <div className="space-y-5 p-4 sm:p-5">
        {stay && stayItem ? (
          <details className="group rounded-2xl border border-amber-200 bg-amber-50 p-3 open:bg-[#fffaf1]">
            <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                  {t("planner.tonight")}
                </p>
                <h3 className="mt-1 truncate text-base font-semibold text-stone-950">
                  {stay.title}
                </h3>
                {stay.locationName ? (
                  <p className="mt-1 truncate text-sm text-stone-600">
                    {itemSubtitle(stayItem)}
                  </p>
                ) : null}
              </div>
              <span className="pt-1 text-xs font-bold text-amber-800">
                <span className="group-open:hidden">{t("common.open")}</span>
                <span className="hidden group-open:inline">{t("common.close")}</span>
              </span>
            </summary>
            <div className="mt-3 rounded-xl bg-white p-3 text-sm leading-6 text-stone-600">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {stay.locationName ? (
                    <a
                      href={stayMapsHref || mapsHref(stay.locationName) || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-emerald-800 underline decoration-emerald-200 underline-offset-4"
                    >
                      {stay.locationName}
                    </a>
                  ) : (
                    <span className="text-stone-400">
                      {t("planner.location.tbd")}
                    </span>
                  )}
                </div>
                {canManagePlans ? (
                  <button
                    type="button"
                    onClick={() => startEditItem(stayItem)}
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-50 shadow-sm"
                    title={t("planner.modify.booking")}
                  >
                    <Image
                      src="/icons/modify.png"
                      alt=""
                      width={14}
                      height={14}
                      className="object-contain opacity-75"
                    />
                  </button>
                ) : null}
              </div>
              <form
                onSubmit={(event) => addInlineMemory(event, stayItem)}
                className="mt-3 rounded-2xl border border-amber-100 bg-white p-2 shadow-sm"
              >
                <div className="flex items-end gap-2">
                  <input
                    ref={(node) => {
                      fileInputRefs.current[stayItem.id] = node;
                    }}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) =>
                      handleInlineAttachmentChange(event, stayItem.id)
                    }
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRefs.current[stayItem.id]?.click()}
                    disabled={preparingAttachmentId === stayItem.id}
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-100 text-lg font-semibold text-stone-500"
                    title={t("memory.attachImage")}
                  >
                    {preparingAttachmentId === stayItem.id ? "..." : "+"}
                  </button>
                  <textarea
                    value={memoryTextByItem[stayItem.id] ?? ""}
                    onChange={(event) =>
                      setMemoryTextByItem((current) => ({
                        ...current,
                        [stayItem.id]: event.target.value,
                      }))
                    }
                    rows={1}
                    placeholder={t("planner.memory.placeholderStay")}
                    className="min-h-9 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-stone-950 outline-none focus:border-amber-300"
                  />
                  <button
                    type="submit"
                    disabled={
                      savingMemoryId === stayItem.id ||
                      (!attachmentByItem[stayItem.id] &&
                        !(memoryTextByItem[stayItem.id] ?? "").trim())
                    }
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-700 text-xs font-bold text-white disabled:bg-stone-300"
                    title={t("planner.memory.save")}
                  >
                    {savingMemoryId === stayItem.id ? "..." : t("common.go")}
                  </button>
                </div>
                {attachmentByItem[stayItem.id] ? (
                  <div className="mt-2 flex items-center gap-3 rounded-2xl bg-amber-50 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        attachmentByItem[stayItem.id]?.compressedImage
                          .previewUrl
                      }
                      alt=""
                      className="size-12 rounded-xl object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-stone-800">
                        {t("memory.attachmentReady")}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {attachmentByItem[stayItem.id]?.fileName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeInlineAttachment(stayItem.id)}
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-stone-500"
                    >
                      {t("memory.removeAttachment")}
                    </button>
                  </div>
                ) : null}
                {preparingAttachmentId === stayItem.id ? (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    {t("memory.compressingImage")}
                  </p>
                ) : null}
                {memoryErrorByItem[stayItem.id] ? (
                  <p className="mt-2 text-xs font-medium text-red-700">
                    {memoryErrorByItem[stayItem.id]}
                  </p>
                ) : null}
                {indexingStatusByItem[stayItem.id] ? (
                  <p className="mt-2 text-xs font-medium text-emerald-800">
                    {indexingStatusByItem[stayItem.id]}
                  </p>
                ) : null}
                {mentionOptions(stayItem.id).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mentionOptions(stayItem.id).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => insertMention(stayItem.id, option.label)}
                        className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900"
                      >
                        @{option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </form>
            {memoriesForItem(stayItem).length > 0 ? (
              <div className="mt-3 space-y-2 border-t border-amber-100 pt-3">
                {memoriesForItem(stayItem).map((memory) => (
                  <div
                    key={memory.id}
                    className="rounded-2xl bg-white px-3 py-2"
                  >
                    <p className="text-xs font-semibold text-emerald-800">
                      {memory.contributorName || t("planner.traveler")}
                    </p>
                    {memory.type === "photo" &&
                    memory.mediaUrl &&
                    imageUrlByMemoryPath[memory.mediaUrl] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrlByMemoryPath[memory.mediaUrl]}
                        alt=""
                        className="mt-2 max-h-56 w-full rounded-xl object-cover"
                      />
                    ) : null}
                    {memory.content ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                        {memory.content}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {pendingExpense?.itemId === stayItem.id ? (
              <section className="mt-3 rounded-3xl border border-amber-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">
                      {t("planner.expense.detected")}
                    </p>
                    <h4 className="mt-1 font-semibold text-stone-950">
                      {t("planner.expense.addStay")}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingExpense(null)}
                    className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-bold text-stone-500"
                  >
                    {t("common.dismiss")}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_96px_1fr] gap-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-700">
                      {t("planner.field.amount")}
                    </span>
                    <input
                      value={pendingExpense.amount}
                      onChange={(event) =>
                        updatePendingExpense({ amount: event.target.value })
                      }
                      min="0"
                      step="0.01"
                      type="number"
                      className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-700">
                      {t("planner.field.currency")}
                    </span>
                    <select
                      value={pendingExpense.currency}
                      onChange={(event) =>
                        updatePendingExpense({
                          currency: event.target.value,
                          exchangeRate:
                            event.target.value === ledgerBaseCurrency ? "1" : "",
                        })
                      }
                      className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                    >
                      {expenseCurrencies.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-700">
                      {t("planner.field.rateTo", { currency: ledgerBaseCurrency })}
                    </span>
                    <input
                      value={pendingExpense.exchangeRate}
                      onChange={(event) =>
                        updatePendingExpense({
                          exchangeRate: event.target.value,
                        })
                      }
                      min="0"
                      step="0.0001"
                      type="number"
                      className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                    />
                  </label>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-700">
                      {t("planner.field.paidBy")}
                    </span>
                    <select
                      value={pendingExpense.payerMemberId}
                      onChange={(event) =>
                        updatePendingExpense({
                          payerMemberId: event.target.value,
                        })
                      }
                      className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                    >
                      <option value="">{t("planner.field.choosePayer")}</option>
                      {activeMembers().map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-700">
                      {t("planner.field.mode")}
                    </span>
                    <select
                      value={pendingExpense.accountingMode}
                      onChange={(event) =>
                        updatePendingExpense({
                          accountingMode: event.target
                            .value as LedgerAccountingMode,
                        })
                      }
                      className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                    >
                      <option value="shared">{t("ledger.shared")}</option>
                      <option value="stats_only">{t("ledger.statsOnly")}</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-bold text-stone-700">
                    {pendingExpense.accountingMode === "shared"
                      ? t("planner.expense.splitWith")
                      : t("planner.expense.countFor")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {activeMembers().map((member) => {
                      const selected =
                        pendingExpense.participantMemberIds.includes(member.id);
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleExpenseParticipant(member.id)}
                          className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                            selected
                              ? "bg-emerald-700 text-white"
                              : "bg-stone-100 text-stone-600"
                          }`}
                        >
                          {member.displayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={confirmPendingExpense}
                    disabled={
                      savingExpenseId === pendingExpense.itemId ||
                      !pendingExpense.amount ||
                      !pendingExpense.exchangeRate
                    }
                    className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:bg-stone-300"
                  >
                      {savingExpenseId === pendingExpense.itemId
                      ? t("common.adding")
                      : t("planner.expense.addToLedger")}
                  </button>
                </div>
                {expenseError ? (
                  <p className="mt-2 rounded-2xl bg-red-50 p-2 text-xs font-medium text-red-700">
                    {expenseError}
                  </p>
                ) : null}
              </section>
            ) : null}
            </div>
          </details>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle title={t("planner.section.today")} />
            <div className="flex items-center gap-2">
              {currentMember ? (
                <button
                  type="button"
                  onClick={() => setShowMineOnly((current) => !current)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold shadow-sm ${
                    showMineOnly
                      ? "bg-emerald-700 text-white"
                      : "bg-white text-emerald-800"
                  }`}
                >
                  {t("planner.filter.mine")}
                </button>
              ) : null}
              {canManagePlans && day.dayDate !== "unscheduled" ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingPlan(true);
                    setDraftPlan(null);
                    setPlanError(null);
                  }}
                  className="grid size-8 place-items-center rounded-full bg-emerald-700 text-lg font-bold leading-none text-white shadow-sm"
                  title={t("planner.addSchedule")}
                >
                  +
                </button>
              ) : null}
            </div>
          </div>
          {story.length === 0 ? (
            <p className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">
              {t("planner.empty.schedule")}
            </p>
          ) : visibleStory.length === 0 ? (
            <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
              {t("planner.empty.mine")}
            </p>
          ) : (
            <div className="relative space-y-2 pl-5 before:absolute before:bottom-4 before:left-2 before:top-4 before:w-px before:bg-emerald-100">
              {visibleStory.map((item) => {
                const navHref = mapsHref(item.location);
                return (
                  <details
                    key={item.id}
                    className={`group relative rounded-2xl p-3 open:bg-[#fffaf1] ${
                      item.status === "cancelled" || item.status === "skipped"
                        ? "bg-stone-100 opacity-70"
                        : "bg-stone-50"
                    }`}
                  >
                    <summary className="grid cursor-pointer list-none grid-cols-[48px_1fr] gap-3">
                      <span className="absolute -left-[17px] top-5 size-3 rounded-full border-2 border-white bg-emerald-700 shadow-sm" />
                      <span className="text-sm font-bold text-emerald-800">
                        {item.time ? formatTime(item.time) : t("planner.anytime")}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-stone-950">
                          <HighlightedText text={item.title} aliases={aliases} />
                          {item.status !== "planned" ? (
                            <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-bold uppercase text-stone-600">
                              {labelForStatus(item.status)}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate text-xs text-stone-500">
                          <HighlightedText
                            text={itemSubtitle(item)}
                            aliases={aliases}
                          />
                        </span>
                      </span>
                    </summary>
                    <div className="mt-3 rounded-xl bg-white p-3 text-sm leading-6 text-stone-600">
                      <div className="mb-3 flex items-start justify-between gap-3 border-b border-stone-100 pb-3">
                        <div className="min-w-0">
                          {item.location ? (
                            <a
                              href={navHref || mapsHref(item.location) || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-emerald-800 underline decoration-emerald-200 underline-offset-4"
                            >
                              {item.location}
                            </a>
                          ) : (
                            <span className="text-stone-400">
                              {t("planner.location.tbd")}
                            </span>
                          )}
                        </div>
                        {canManagePlans ? (
                          <button
                            type="button"
                            onClick={() => startEditItem(item)}
                            className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-50 shadow-sm"
                            title={t("planner.modify.schedule")}
                          >
                            <Image
                              src="/icons/modify.png"
                              alt=""
                              width={14}
                              height={14}
                              className="object-contain opacity-75"
                            />
                          </button>
                        ) : null}
                      </div>
                      <HighlightedText
                        text={
                          item.note ||
                          t("planner.note.empty")
                        }
                        aliases={aliases}
                      />
                      {memoriesForItem(item).length > 0 ? (
                        <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
                          {memoriesForItem(item).map((memory) => (
                            <div
                              key={memory.id}
                              className="rounded-2xl bg-emerald-50 px-3 py-2"
                            >
                              <p className="text-xs font-semibold text-emerald-800">
                                {memory.contributorName || t("planner.traveler")}
                              </p>
                              {memory.type === "photo" &&
                              memory.mediaUrl &&
                              imageUrlByMemoryPath[memory.mediaUrl] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={imageUrlByMemoryPath[memory.mediaUrl]}
                                  alt=""
                                  className="mt-2 max-h-56 w-full rounded-xl object-cover"
                                />
                              ) : null}
                              {memory.content ? (
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                                  {memory.content}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {day.dayDate !== "unscheduled" ? (
                        <form
                          onSubmit={(event) => addInlineMemory(event, item)}
                          className="mt-3 rounded-2xl border border-emerald-100 bg-[#fffdf8] p-2 shadow-sm"
                        >
                          <div className="flex items-end gap-2">
                            <input
                              ref={(node) => {
                                fileInputRefs.current[item.id] = node;
                              }}
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              onChange={(event) =>
                                handleInlineAttachmentChange(event, item.id)
                              }
                            />
                            <button
                              type="button"
                              onClick={() =>
                                fileInputRefs.current[item.id]?.click()
                              }
                              disabled={preparingAttachmentId === item.id}
                              className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-100 text-lg font-semibold text-stone-500"
                              title={t("memory.attachImage")}
                            >
                              {preparingAttachmentId === item.id ? "..." : "+"}
                            </button>
                            <textarea
                              value={memoryTextByItem[item.id] ?? ""}
                              onChange={(event) =>
                                setMemoryTextByItem((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              rows={1}
                              placeholder={t("planner.memory.placeholder")}
                              className="min-h-9 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-stone-950 outline-none focus:border-emerald-300"
                            />
                            <button
                              type="button"
                              className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-100 text-xs font-bold text-stone-500"
                              title={t("planner.voiceInput")}
                            >
                              {t("planner.mic")}
                            </button>
                            <button
                              type="submit"
                              disabled={
                                savingMemoryId === item.id ||
                                (!attachmentByItem[item.id] &&
                                  !(memoryTextByItem[item.id] ?? "").trim())
                              }
                              className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-700 text-xs font-bold text-white disabled:bg-stone-300"
                              title={t("planner.memory.save")}
                            >
                              {savingMemoryId === item.id ? "..." : t("common.go")}
                            </button>
                          </div>
                          {attachmentByItem[item.id] ? (
                            <div className="mt-2 flex items-center gap-3 rounded-2xl bg-emerald-50 p-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={
                                  attachmentByItem[item.id]?.compressedImage
                                    .previewUrl
                                }
                                alt=""
                                className="size-12 rounded-xl object-cover"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-stone-800">
                                  {t("memory.attachmentReady")}
                                </p>
                                <p className="truncate text-xs text-stone-500">
                                  {attachmentByItem[item.id]?.fileName}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeInlineAttachment(item.id)}
                                className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-stone-500"
                              >
                                {t("memory.removeAttachment")}
                              </button>
                            </div>
                          ) : null}
                          {preparingAttachmentId === item.id ? (
                            <p className="mt-2 text-xs font-medium text-emerald-800">
                              {t("memory.compressingImage")}
                            </p>
                          ) : null}
                          {memoryErrorByItem[item.id] ? (
                            <p className="mt-2 text-xs font-medium text-red-700">
                              {memoryErrorByItem[item.id]}
                            </p>
                          ) : null}
                          {indexingStatusByItem[item.id] ? (
                            <p className="mt-2 text-xs font-medium text-emerald-800">
                              {indexingStatusByItem[item.id]}
                            </p>
                          ) : null}
                          {mentionOptions(item.id).length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {mentionOptions(item.id).map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => insertMention(item.id, option.label)}
                                  className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-900"
                                >
                                  @{option.label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </form>
                      ) : null}
                      {pendingExpense?.itemId === item.id ? (
                        <section className="mt-3 rounded-3xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">
                                {t("planner.expense.detected")}
                              </p>
                              <h4 className="mt-1 font-semibold text-stone-950">
                                {t("planner.expense.addThis")}
                              </h4>
                            </div>
                            <button
                              type="button"
                              onClick={() => setPendingExpense(null)}
                              className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-stone-500"
                            >
                              {t("common.dismiss")}
                            </button>
                          </div>

                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-700">
                                {t("planner.field.title")}
                              </span>
                              <input
                                value={pendingExpense.title}
                                onChange={(event) =>
                                  updatePendingExpense({
                                    title: event.target.value,
                                  })
                                }
                                className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-700">
                                {t("planner.field.category")}
                              </span>
                              <select
                                value={pendingExpense.category}
                                onChange={(event) =>
                                  updatePendingExpense({
                                    category: event.target.value as LedgerCategory,
                                  })
                                }
                                className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                              >
                                {expenseCategories.map((category) => (
                                  <option
                                    key={category}
                                    value={category}
                                  >
                                    {labelForExpenseCategory(category)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div className="mt-2 grid grid-cols-[1fr_96px_1fr] gap-2">
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-700">
                                {t("planner.field.amount")}
                              </span>
                              <input
                                value={pendingExpense.amount}
                                onChange={(event) =>
                                  updatePendingExpense({
                                    amount: event.target.value,
                                  })
                                }
                                min="0"
                                step="0.01"
                                type="number"
                                className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-700">
                                {t("planner.field.currency")}
                              </span>
                              <select
                                value={pendingExpense.currency}
                                onChange={(event) =>
                                  updatePendingExpense({
                                    currency: event.target.value,
                                    exchangeRate:
                                      event.target.value === ledgerBaseCurrency
                                        ? "1"
                                        : "",
                                  })
                                }
                                className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                              >
                                {expenseCurrencies.map((currency) => (
                                  <option key={currency} value={currency}>
                                    {currency}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-700">
                                {t("planner.field.rateTo", {
                                  currency: ledgerBaseCurrency,
                                })}
                                {isLoadingRate ? t("planner.loadingSuffix") : ""}
                              </span>
                              <input
                                value={pendingExpense.exchangeRate}
                                onChange={(event) =>
                                  updatePendingExpense({
                                    exchangeRate: event.target.value,
                                  })
                                }
                                min="0"
                                step="0.0001"
                                type="number"
                                placeholder="1"
                                className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                              />
                            </label>
                          </div>

                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-700">
                                {t("planner.field.paidBy")}
                              </span>
                              <select
                                value={pendingExpense.payerMemberId}
                                onChange={(event) =>
                                  updatePendingExpense({
                                    payerMemberId: event.target.value,
                                  })
                                }
                                className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                              >
                                <option value="">
                                  {t("planner.field.choosePayer")}
                                </option>
                                {activeMembers().map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {member.displayName}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-700">
                                {t("planner.field.mode")}
                              </span>
                              <select
                                value={pendingExpense.accountingMode}
                                onChange={(event) =>
                                  updatePendingExpense({
                                    accountingMode: event.target
                                      .value as LedgerAccountingMode,
                                  })
                                }
                                className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                              >
                                <option value="shared">{t("ledger.shared")}</option>
                                <option value="stats_only">
                                  {t("ledger.statsOnly")}
                                </option>
                              </select>
                            </label>
                          </div>

                          <div className="mt-3 space-y-2">
                            <p className="text-xs font-bold text-stone-700">
                              {pendingExpense.accountingMode === "shared"
                                ? t("planner.expense.splitWith")
                                : t("planner.expense.countFor")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {activeMembers().map((member) => {
                                const selected =
                                  pendingExpense.participantMemberIds.includes(
                                    member.id,
                                  );
                                return (
                                  <button
                                    key={member.id}
                                    type="button"
                                    onClick={() =>
                                      toggleExpenseParticipant(member.id)
                                    }
                                    className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                                      selected
                                        ? "bg-emerald-700 text-white"
                                        : "bg-white text-stone-600"
                                    }`}
                                  >
                                    {member.displayName}
                                  </button>
                                );
                              })}
                            </div>
                            {pendingExpense.accountingMode === "stats_only" ? (
                              <p className="text-xs leading-5 text-stone-500">
                                {t("planner.expense.statsOnlyNote")}
                              </p>
                            ) : null}
                          </div>

                          <label className="mt-3 block space-y-1">
                            <span className="text-xs font-bold text-stone-700">
                              {t("planner.field.location")}
                            </span>
                            <input
                              value={pendingExpense.addressText}
                              onChange={(event) =>
                                updatePendingExpense({
                                  addressText: event.target.value,
                                })
                              }
                              className="w-full rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm text-stone-950 outline-none focus:border-amber-300"
                            />
                          </label>

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-amber-900">
                              {t("planner.expense.linked")}
                            </p>
                            <button
                              type="button"
                              onClick={confirmPendingExpense}
                              disabled={
                                savingExpenseId === pendingExpense.itemId ||
                                !pendingExpense.amount ||
                                !pendingExpense.exchangeRate
                              }
                              className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:bg-stone-300"
                            >
                              {savingExpenseId === pendingExpense.itemId
                                ? t("common.adding")
                                : t("planner.expense.addToLedger")}
                            </button>
                          </div>
                          {expenseError ? (
                            <p className="mt-2 rounded-2xl bg-red-50 p-2 text-xs font-medium text-red-700">
                              {expenseError}
                            </p>
                          ) : null}
                        </section>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>

        {bookings.length > 0 ? (
          <section className="space-y-3">
            <SectionTitle title={t("planner.section.keyBookings")} />
            <div className="grid gap-2 sm:grid-cols-3">
              {bookings.map(([type, items]) => {
                const first = items[0];
                const bookingTotal = items.reduce(
                  (total, item) =>
                    total +
                    ledgerEntries
                      .filter((entry) => entry.itineraryReservationId === item.id)
                      .reduce((sum, entry) => sum + entry.baseAmount, 0),
                  0,
                );
                return (
                  <div
                    key={type}
                    className="rounded-2xl border border-stone-100 bg-white p-3 shadow-sm"
                  >
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                      {labelForItemKind(type)}
                    </p>
                    <h4 className="mt-1 truncate text-sm font-semibold text-stone-950">
                      {items.length > 1
                        ? t("planner.items.count", { count: items.length })
                        : first.title}
                    </h4>
                    {first.locationName ? (
                      <p className="mt-1 truncate text-xs text-stone-500">
                        {first.locationName}
                      </p>
                    ) : null}
                    {bookingTotal > 0 ? (
                      <p className="mt-2 text-xs font-bold text-emerald-800">
                        {money(bookingTotal, ledgerCurrency, locale)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {day.notes ? (
          <section className="space-y-2 rounded-3xl bg-[#fff8ec] p-4">
            <SectionTitle title={t("planner.section.dayNotes")} />
            <p className="text-sm leading-6 text-stone-700">{day.notes}</p>
          </section>
        ) : null}

        <section className="space-y-3 rounded-3xl border border-stone-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle title={t("nav.ledger")} />
            <Link
              href={`/trips/${tripId}/ledger`}
              className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-bold text-stone-700"
            >
              {t("common.open")}
            </Link>
          </div>
          {ledgerEntries.length === 0 ? (
            <p className="rounded-2xl bg-stone-50 p-3 text-sm text-stone-500">
              {t("planner.empty.expenses")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl bg-emerald-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                  {t("ledger.totalCost")}
                </p>
                <p className="mt-1 font-semibold text-emerald-950">
                  {money(ledgerTotal, ledgerCurrency, locale)}
                </p>
              </div>
              <div className="rounded-2xl bg-amber-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
                  {t("ledger.shared")}
                </p>
                <p className="mt-1 font-semibold text-amber-950">
                  {money(sharedTotal, ledgerCurrency, locale)}
                </p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                  {t("ledger.statsOnly")}
                </p>
                <p className="mt-1 font-semibold text-stone-950">
                  {money(statsOnlyTotal, ledgerCurrency, locale)}
                </p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                  {t("ledger.needsReview")}
                </p>
                <p className="mt-1 font-semibold text-stone-950">
                  {reviewCount}
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-3xl bg-emerald-50/60 p-3">
          <SectionTitle title={t("planner.section.memoryPreview")} />
          <DayMemoryPreview
            tripId={tripId}
            date={day.dayDate}
            tripDayId={day.id}
            memories={memories}
          />
        </section>

        {nextDay ? (
          <section className="rounded-3xl border border-stone-100 bg-stone-50 p-4">
            <SectionTitle title={t("planner.section.tomorrow")} />
            <h3 className="mt-2 text-base font-semibold text-stone-950">
              {nextDay.day.title ||
                formatPlannerDayLabel(nextDay.day.dayDate, locale)}
            </h3>
            {nextStory.length > 0 ? (
              <p className="mt-1 line-clamp-2 text-sm text-stone-600">
                {nextStory.map((item) => item.title).join(" / ")}
              </p>
            ) : (
              <p className="mt-1 text-sm text-stone-500">
                {t("planner.empty.tomorrow")}
              </p>
            )}
          </section>
        ) : null}
      </div>
      {isAddingPlan ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-stone-950/30 p-3 sm:place-items-center">
          <section className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-emerald-800">
                  {t("planner.addSchedule")}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-stone-950">
                  {t("planner.describePlan")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddingPlan(false);
                  setDraftPlan(null);
                  setNewPlanText("");
                }}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
              >
                {t("common.close")}
              </button>
            </div>

            <form onSubmit={prepareDraftPlan} className="mt-4 space-y-3">
              <textarea
                value={newPlanText}
                onChange={(event) => {
                  setNewPlanText(event.target.value);
                  setDraftPlan(null);
                }}
                rows={3}
                placeholder={t("planner.add.placeholder")}
                className="w-full resize-none rounded-2xl border border-stone-200 px-4 py-3 text-sm leading-6 text-stone-950 outline-none focus:border-emerald-300"
              />
              <button
                type="submit"
                disabled={!newPlanText.trim()}
                className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:bg-stone-300"
              >
                {t("planner.parsePlan")}
              </button>
            </form>

            {draftPlan ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-sm font-bold text-stone-800">
                    {t("planner.field.title")}
                  </span>
                  <input
                    value={draftPlan.title}
                    onChange={(event) =>
                      setDraftPlan((current) =>
                        current ? { ...current, title: event.target.value } : current,
                      )
                    }
                    className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-bold text-stone-800">
                    {t("planner.field.type")}
                  </span>
                  <select
                    value={draftPlan.eventType}
                    onChange={(event) =>
                      setDraftPlan((current) =>
                        current
                          ? {
                              ...current,
                              eventType: event.target.value as ItineraryEventType,
                            }
                          : current,
                      )
                    }
                    className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                  >
                    {eventTypes.map((type) => (
                      <option key={type} value={type}>
                        {labelForEventType(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-bold text-stone-800">
                    {t("planner.field.location")}
                  </span>
                  <input
                    value={draftPlan.locationName}
                    onChange={(event) =>
                      setDraftPlan((current) =>
                        current
                          ? { ...current, locationName: event.target.value }
                          : current,
                      )
                    }
                    className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-bold text-stone-800">
                    {t("planner.field.start")}
                  </span>
                  <input
                    value={draftPlan.plannedStart}
                    onChange={(event) =>
                      setDraftPlan((current) =>
                        current
                          ? { ...current, plannedStart: event.target.value }
                          : current,
                      )
                    }
                    type="datetime-local"
                    className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-bold text-stone-800">
                    {t("planner.field.end")}
                  </span>
                  <input
                    value={draftPlan.plannedEnd}
                    onChange={(event) =>
                      setDraftPlan((current) =>
                        current
                          ? { ...current, plannedEnd: event.target.value }
                          : current,
                      )
                    }
                    type="datetime-local"
                    className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-sm font-bold text-stone-800">
                    {t("planner.field.note")}
                  </span>
                  <textarea
                    value={draftPlan.description}
                    onChange={(event) =>
                      setDraftPlan((current) =>
                        current
                          ? { ...current, description: event.target.value }
                          : current,
                      )
                    }
                    rows={2}
                    className="w-full resize-none rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                  />
                </label>
                <div className="flex justify-end sm:col-span-2">
                  <button
                    type="button"
                    onClick={saveDraftPlan}
                    disabled={isSavingPlan || !draftPlan.title.trim()}
                    className="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {isSavingPlan ? t("common.adding") : t("planner.addToToday")}
                  </button>
                </div>
              </div>
            ) : null}

            {planError ? (
              <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
                {planError}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
      {editingItem ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-stone-950/30 p-3 sm:place-items-center">
          <form
            onSubmit={saveEditingItem}
            className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-emerald-800">
                  {editingItem.itemType === "event"
                    ? t("planner.edit.schedule")
                    : t("planner.edit.booking")}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-stone-950">
                  {editingItem.title || t("planner.planItem")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
              >
                {t("common.close")}
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className="text-sm font-bold text-stone-800">
                  {t("planner.field.title")}
                </span>
                <input
                  value={editingItem.title}
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current ? { ...current, title: event.target.value } : current,
                    )
                  }
                  required
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-bold text-stone-800">
                  {t("planner.field.type")}
                </span>
                <select
                  value={editingItem.typeValue}
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current
                        ? { ...current, typeValue: event.target.value }
                        : current,
                    )
                  }
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                >
                  {(editingItem.itemType === "event"
                    ? eventTypes
                    : reservationTypes
                  ).map((type) => (
                    <option key={type} value={type}>
                      {editingItem.itemType === "event"
                        ? labelForEventType(type as ItineraryEventType)
                        : labelForReservationType(type as ItineraryReservationType)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-sm font-bold text-stone-800">
                  {t("planner.field.status")}
                </span>
                <select
                  value={editingItem.status}
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current
                        ? {
                            ...current,
                            status: event.target.value as ItineraryItemStatus,
                          }
                        : current,
                    )
                  }
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                >
                  {itemStatuses.map((status) => (
                    <option key={status} value={status}>
                      {labelForStatus(status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-sm font-bold text-stone-800">
                  {editingItem.itemType === "event"
                    ? t("planner.field.detailNote")
                    : t("planner.field.provider")}
                </span>
                <input
                  value={
                    editingItem.itemType === "event"
                      ? editingItem.description
                      : editingItem.secondary
                  }
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current
                        ? editingItem.itemType === "event"
                          ? { ...current, description: event.target.value }
                          : { ...current, secondary: event.target.value }
                        : current,
                    )
                  }
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-bold text-stone-800">
                  {t("planner.field.location")}
                </span>
                <input
                  value={editingItem.locationName}
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current
                        ? { ...current, locationName: event.target.value }
                        : current,
                    )
                  }
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-bold text-stone-800">
                  {t("planner.field.start")}
                </span>
                <input
                  value={editingItem.startsAt}
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current
                        ? { ...current, startsAt: event.target.value }
                        : current,
                    )
                  }
                  type="datetime-local"
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm font-bold text-stone-800">
                  {t("planner.field.end")}
                </span>
                <input
                  value={editingItem.endsAt}
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current ? { ...current, endsAt: event.target.value } : current,
                    )
                  }
                  type="datetime-local"
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                />
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="text-sm font-bold text-stone-800">
                  {t("planner.field.url")}
                </span>
                <input
                  value={editingItem.url}
                  onChange={(event) =>
                    setEditingItem((current) =>
                      current ? { ...current, url: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
                />
              </label>
            </div>

            {planError ? (
              <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
                {planError}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={deleteEditingItem}
                className="rounded-full bg-red-50 px-4 py-2 text-sm font-bold text-red-700"
              >
                {t("common.delete")}
              </button>
              <button
                type="submit"
                disabled={isSavingPlan}
                className="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white disabled:bg-stone-300"
              >
                {isSavingPlan ? t("common.saving") : t("common.saveChanges")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </article>
  );
}
