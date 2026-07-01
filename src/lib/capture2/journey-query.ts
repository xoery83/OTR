import { formatJourneyTime } from "@/lib/format";
import {
  allocatedLedgerAmountForDay,
  getLedgerAllocationDates,
} from "@/lib/ledger/date-allocation";
import { getLedgerData } from "@/lib/supabase/ledger";
import { getPlannerV2, type PlannerV2Day } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import type { LedgerEntry } from "@/types";

export type Capture2JourneyQueryAnswer = {
  handled: boolean;
  answer: string;
  date?: string | null;
};

function dateKey(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function queryDate(input: string) {
  if (/昨天/.test(input)) return dateKey(-1);
  if (/明天/.test(input)) return dateKey(1);
  if (/后天/.test(input)) return dateKey(2);
  return dateKey(0);
}

function timeText(value: string | null | undefined) {
  return value ? formatJourneyTime(value, "zh-CN") || "时间待定" : "时间待定";
}

function dayForDate(days: PlannerV2Day[], date: string) {
  return days.find((day) => day.day.dayDate === date) ?? null;
}

function itemTime(value: string | null | undefined) {
  if (!value) return "时间待定";
  return timeText(value);
}

function itemLine(title: string, startsAt: string | null | undefined) {
  return `${itemTime(startsAt)} · ${title}`;
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function dateLabelFromQuery(text: string) {
  if (/明天/.test(text)) return "明天";
  if (/后天/.test(text)) return "后天";
  if (/昨天/.test(text)) return "昨天";
  return "今天";
}

function entryTouchesDate(entry: LedgerEntry, date: string) {
  return getLedgerAllocationDates(entry).includes(date);
}

async function answerLedgerSpending(input: {
  tripId: string;
  text: string;
  date: string;
}): Promise<Capture2JourneyQueryAnswer> {
  const ledgerData = await getLedgerData(input.tripId);
  const dateText = dateLabelFromQuery(input.text);
  const entries = ledgerData.entries.filter((entry) => entryTouchesDate(entry, input.date));
  const dayAmounts = entries
    .map((entry) => ({
      entry,
      baseAmount: allocatedLedgerAmountForDay(entry, input.date),
      originalAmount:
        entry.originalAmount / Math.max(getLedgerAllocationDates(entry).length, 1),
    }))
    .filter((item) => item.baseAmount > 0);

  if (dayAmounts.length === 0) {
    return {
      handled: true,
      date: input.date,
      answer: `没有找到${dateText}的消费记录。`,
    };
  }

  const totalBase = dayAmounts.reduce((total, item) => total + item.baseAmount, 0);
  const byOriginalCurrency = new Map<string, number>();
  dayAmounts.forEach((item) => {
    byOriginalCurrency.set(
      item.entry.originalCurrency,
      (byOriginalCurrency.get(item.entry.originalCurrency) ?? 0) + item.originalAmount,
    );
  });

  const originalSummary = [...byOriginalCurrency.entries()]
    .sort(([leftCurrency], [rightCurrency]) => leftCurrency.localeCompare(rightCurrency))
    .map(([currency, amount]) => money(amount, currency))
    .join("，");
  const topEntries = [...dayAmounts]
    .sort((left, right) => right.baseAmount - left.baseAmount)
    .slice(0, 3)
    .map((item) => `${item.entry.title} ${money(item.baseAmount, ledgerData.ledger.baseCurrency)}`)
    .join("；");

  return {
    handled: true,
    date: input.date,
    answer: `${dateText}已记录 ${dayAmounts.length} 笔消费，合计 ${money(
      totalBase,
      ledgerData.ledger.baseCurrency,
    )}${originalSummary ? `。原币种小计：${originalSummary}` : ""}${
      topEntries ? `。主要支出：${topEntries}。` : "。"
    }`,
  };
}

function answerLodging(day: PlannerV2Day | null, date: string): Capture2JourneyQueryAnswer {
  const hotels =
    day?.reservations.filter(
      (reservation) =>
        reservation.status !== "cancelled" && reservation.reservationType === "hotel",
    ) ?? [];
  if (hotels.length === 0) {
    return {
      handled: true,
      date,
      answer: "没有找到今天明确的住宿安排。",
    };
  }

  const hotel = hotels[0];
  const place = hotel.locationName || hotel.provider || hotel.title;
  return {
    handled: true,
    date,
    answer: `今天住在 ${place}。${hotel.confirmationCode ? `确认号：${hotel.confirmationCode}。` : ""}`,
  };
}

function answerSchedule(day: PlannerV2Day | null, date: string) {
  const reservations =
    day?.reservations.filter((reservation) => reservation.status !== "cancelled") ?? [];
  const activities = day?.activities.filter((activity) => activity.status !== "cancelled") ?? [];
  const lines = [
    ...reservations.map((reservation) => itemLine(reservation.title, reservation.startsAt)),
    ...activities.map((activity) => itemLine(activity.title, activity.plannedStart)),
  ].slice(0, 8);

  if (lines.length === 0) {
    return {
      handled: true,
      date,
      answer: "没有找到今天明确安排。",
    };
  }

  return {
    handled: true,
    date,
    answer: `今天有这些安排：${lines.join("；")}。`,
  };
}

function answerDeparture(day: PlannerV2Day | null, date: string) {
  const items = [
    ...(day?.reservations ?? []).map((reservation) => ({
      title: reservation.title,
      startsAt: reservation.startsAt,
      status: reservation.status,
      type: reservation.reservationType,
    })),
    ...(day?.activities ?? []).map((activity) => ({
      title: activity.title,
      startsAt: activity.plannedStart,
      status: activity.status,
      type: activity.eventType,
    })),
  ]
    .filter((item) => item.status !== "cancelled" && item.startsAt)
    .sort((first, second) => (first.startsAt ?? "").localeCompare(second.startsAt ?? ""));

  const departure =
    items.find((item) => /出发|离开|depart|leave|checkout|check-out|退房/i.test(item.title)) ??
    items.find((item) => ["flight", "transport", "ferry", "car"].includes(item.type)) ??
    items[0];

  if (!departure) {
    return {
      handled: true,
      date,
      answer: "没有找到明天明确的出发时间。",
    };
  }

  return {
    handled: true,
    date,
    answer: `明天 ${timeText(departure.startsAt)} 有安排：${departure.title}。`,
  };
}

export async function answerCapture2JourneyQuery(input: {
  tripId: string;
  text: string;
}): Promise<Capture2JourneyQueryAnswer> {
  const text = input.text.trim();
  const date = queryDate(text);

  if (/(花了多少|多少钱|一共花|总共花|消费多少|费用多少|账本|支出|消费|花费)/.test(text)) {
    return answerLedgerSpending({ tripId: input.tripId, text, date });
  }

  const trip = await getTrip(input.tripId);
  const planner = await getPlannerV2(trip, { includeMemories: false });
  const day = dayForDate(planner.days, date);

  if (/(住哪里|住哪|酒店|住宿)/.test(text)) {
    return answerLodging(day, date);
  }

  if (/(几点出发|什么时候出发|出发时间)/.test(text)) {
    return answerDeparture(day, date);
  }

  if (/(行程|形成|安排|活动|计划|日程|有什么|都有什么|有哪些)/.test(text)) {
    return answerSchedule(day, date);
  }

  return {
    handled: false,
    date,
    answer: "没有找到明确安排。",
  };
}
