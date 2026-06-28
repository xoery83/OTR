"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AiRouteRecommendationPanel } from "@/components/AiRouteRecommendationPanel";
import { AuthGate } from "@/components/AuthGate";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { getErrorMessage } from "@/lib/errors";
import { getApproxExchangeRate } from "@/lib/exchange-rates";
import {
  formatDateTime,
  journeyDateKey,
  toJourneyDateTimeLocalValue,
} from "@/lib/format";
import { compressImageFile } from "@/lib/images";
import {
  addConflictWarnings,
  type AiItineraryResponse,
  type ParsedExpenseDraft,
  type ParsedItineraryDraft,
  type ParsedReservationDraft,
  toPlannerDrafts,
} from "@/lib/planner-import";
import {
  createItineraryEvent,
  createItineraryReservation,
  getItineraryEvents,
  getItineraryReservations,
} from "@/lib/supabase/itinerary";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { createLedgerEntry, getLedgerData } from "@/lib/supabase/ledger";
import { requestVoiceTranscription } from "@/lib/supabase/media-assets";
import { getTripMembers } from "@/lib/supabase/members";
import { upsertTripDay, type PlannerV2Day } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import { supabase } from "@/lib/supabase/client";
import type {
  ItineraryEvent,
  ItineraryEventType,
  ItineraryReservation,
  ItineraryReservationType,
  JourneyMember,
  LedgerAccountingMode,
  LedgerCategory,
  Trip,
  TripMember,
} from "@/types";

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

const eventTypeLabels: Record<ItineraryEventType, string> = {
  flight: "航班",
  hotel: "住宿",
  car: "租车",
  activity: "活动",
  shopping: "购物",
  meal: "用餐",
  transport: "交通",
  note: "备注",
  other: "其他",
};

const reservationTypeLabels: Record<ItineraryReservationType, string> = {
  flight: "航班",
  hotel: "住宿",
  car: "租车",
  ferry: "轮渡",
  tour: "预订活动",
  restaurant: "餐厅",
  other: "其他",
};

const ledgerCategories: LedgerCategory[] = [
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

const ledgerCategoryLabels: Record<LedgerCategory, string> = {
  flight: "航班",
  hotel: "住宿",
  car: "租车",
  fuel: "燃油",
  food: "餐饮",
  ticket: "门票",
  shopping: "购物",
  transport: "交通",
  insurance: "保险",
  other: "其他",
};

const accountingModeLabels: Record<LedgerAccountingMode, string> = {
  shared: "共同分摊",
  stats_only: "只统计不分摊",
};

type DraftKind = "event" | "reservation" | "expense";

type DraftQueueItem = {
  kind: DraftKind;
  clientId: string;
  createdAt: number;
};

type EventExtraFields = {
  bookingReference: string;
  url: string;
};

type ReservationExtraFields = {
  provider: string;
  confirmationCode: string;
  url: string;
};

type QuickAddType =
  | "event"
  | "hotel"
  | "car"
  | "expense"
  | "flight"
  | "ferry"
  | "tour"
  | "restaurant";

function reservationFormCopy(type: ItineraryReservationType) {
  if (type === "flight") {
    return {
      heading: "航班预订",
      titleLabel: "航班号 / 航班标题",
      locationLabel: "航线 / 机场",
      startLabel: "起飞时间",
      endLabel: "到达时间",
      providerLabel: "航空公司 / 预订平台",
      codeLabel: "PNR / 确认号",
      urlLabel: "机票链接",
      peopleLabel: "乘机人",
      saveLabel: "保存这条航班",
    };
  }
  if (type === "hotel") {
    return {
      heading: "住宿预订",
      titleLabel: "酒店 / 住宿名称",
      locationLabel: "住宿地址",
      startLabel: "入住时间",
      endLabel: "退房时间",
      providerLabel: "平台 / 预订人",
      codeLabel: "确认号",
      urlLabel: "预订链接",
      peopleLabel: "入住人",
      saveLabel: "保存这条住宿",
    };
  }
  if (type === "car") {
    return {
      heading: "租车预订",
      titleLabel: "车行 / 租车标题",
      locationLabel: "取还车地点",
      startLabel: "取车时间",
      endLabel: "还车时间",
      providerLabel: "租车公司 / 平台",
      codeLabel: "预订号",
      urlLabel: "租车链接",
      peopleLabel: "相关成员",
      saveLabel: "保存这条租车",
    };
  }
  if (type === "restaurant") {
    return {
      heading: "餐厅预订",
      titleLabel: "餐厅名称",
      locationLabel: "餐厅地址",
      startLabel: "用餐时间",
      endLabel: "结束时间",
      providerLabel: "预订平台 / 联系人",
      codeLabel: "确认号",
      urlLabel: "餐厅链接",
      peopleLabel: "用餐人",
      saveLabel: "保存这条餐厅",
    };
  }
  if (type === "tour") {
    return {
      heading: "活动预订",
      titleLabel: "活动 / Tour 名称",
      locationLabel: "集合地点",
      startLabel: "开始时间",
      endLabel: "结束时间",
      providerLabel: "供应商 / 平台",
      codeLabel: "确认号",
      urlLabel: "活动链接",
      peopleLabel: "参与人",
      saveLabel: "保存这条活动预订",
    };
  }
  if (type === "ferry") {
    return {
      heading: "轮渡预订",
      titleLabel: "轮渡 / 船班标题",
      locationLabel: "航线 / 港口",
      startLabel: "出发时间",
      endLabel: "抵达时间",
      providerLabel: "船公司 / 平台",
      codeLabel: "确认号",
      urlLabel: "轮渡链接",
      peopleLabel: "乘船人",
      saveLabel: "保存这条轮渡",
    };
  }
  return {
    heading: "其他预订",
    titleLabel: "预订标题",
    locationLabel: "地点 / 地址",
    startLabel: "开始时间",
    endLabel: "结束时间",
    providerLabel: "供应商 / 平台",
    codeLabel: "确认号",
    urlLabel: "链接",
    peopleLabel: "参与人",
    saveLabel: "保存这条预订",
  };
}

function toInputDateTime(value: string | null) {
  return toJourneyDateTimeLocalValue(value);
}

function warningClass(severity: string) {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function timeValue(value: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function dateValue(value: string | null) {
  return journeyDateKey(value);
}

function addDateDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeDateParam(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function localDateTimeIso(date: string | null, time: string) {
  if (!date) return null;
  return `${date}T${time}:00`;
}

function makeDraftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendTextBlock(current: string, addition: string) {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return current;
  const trimmedCurrent = current.trimEnd();
  return trimmedCurrent ? `${trimmedCurrent}\n\n${trimmedAddition}` : trimmedAddition;
}

function normalizePlannerImportVoiceTranscript(transcript: string) {
  let text = transcript
    .trim()
    .replace(/\s+/g, " ")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/[，,]\s*/g, "，")
    .replace(/[。\.]\s*/g, "。");

  const phraseReplacements: Array<[RegExp, string]> = [
    [/(添加|新增|加|安排|创建)一个形成/g, "$1一个行程"],
    [/(添加|新增|加|安排|创建)(?:新的)?形成/g, "$1行程"],
    [/今天的形成/g, "今天的行程"],
    [/明天的形成/g, "明天的行程"],
    [/形成安排/g, "行程安排"],
    [/形程/g, "行程"],
    [/景区点/g, "景点"],
    [/第一个地点/g, "第一个地点"],
    [/美术管/g, "美术馆"],
    [/博物管/g, "博物馆"],
    [/飞机场/g, "机场"],
    [/酒店住/g, "酒店住宿"],
    [/住处地址/g, "住宿地址"],
    [/帐本/g, "账本"],
    [/记帐/g, "记账"],
  ];

  phraseReplacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  const chineseDigitMap: Record<string, string> = {
    一: "1",
    二: "2",
    两: "2",
    三: "3",
    四: "4",
    五: "5",
    六: "6",
    七: "7",
    八: "8",
    九: "9",
    十: "10",
  };

  text = text.replace(
    /(上午|中午|下午|晚上|早上)?([一二两三四五六七八九十])点/g,
    (_match, period: string | undefined, digit: string) =>
      `${period ?? ""}${chineseDigitMap[digit] ?? digit}点`,
  );

  text = text
    .replace(/就是(?=今天|明天|后天|上午|中午|下午|晚上|早上|\d|[一二两三四五六七八九十]点)/g, "")
    .replace(/帮我(加|添加|新增)一个行程(?=今天|明天|后天)/g, "帮我$1一个行程，")
    .replace(/([。！？]){2,}/g, "$1")
    .trim();

  return text;
}

function getDatesInRange(startValue: string | null, endValue: string | null) {
  const startDate = dateValue(startValue);
  const endDate = dateValue(endValue);
  if (!startDate) return [];
  if (!endDate || endDate < startDate) return [startDate];

  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate && dates.length < 370) {
    dates.push(current);
    current = addDateDays(current, 1);
  }
  return dates;
}

function normalizedText(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function textIncludesEither(left: string | null | undefined, right: string | null | undefined) {
  const leftText = normalizedText(left);
  const rightText = normalizedText(right);
  if (!leftText || !rightText) return false;
  return leftText.includes(rightText) || rightText.includes(leftText);
}

function reservationTextMatches(expense: ParsedExpenseDraft, reservation: ItineraryReservation) {
  return (
    textIncludesEither(expense.linked_stay_title, reservation.title) ||
    textIncludesEither(expense.linked_stay_location, reservation.locationName) ||
    textIncludesEither(expense.address_text, reservation.locationName) ||
    textIncludesEither(expense.source_excerpt, reservation.title) ||
    textIncludesEither(expense.source_excerpt, reservation.locationName)
  );
}

function reservationTypesForExpense(expense: ParsedExpenseDraft): ItineraryReservationType[] {
  if (expense.category === "hotel") return ["hotel"];
  if (expense.category === "car") return ["car"];
  if (expense.category === "flight") return ["flight"];
  if (expense.category === "food") return ["restaurant"];
  if (expense.category === "ticket") return ["tour"];
  return ["hotel", "car", "flight", "ferry", "tour", "restaurant", "other"];
}

function reservationLinkLabels(expense: ParsedExpenseDraft) {
  if (expense.category === "hotel") {
    return {
      label: "关联住宿",
      range: "住宿范围",
      missing: "未找到匹配住宿，导入后不会挂到住宿卡片",
    };
  }
  if (expense.category === "car") {
    return {
      label: "关联租车",
      range: "租车范围",
      missing: "未找到匹配租车预订，导入后不会挂到租车卡片",
    };
  }
  return {
    label: "关联预订",
    range: "预订范围",
    missing: "未找到匹配预订，导入后不会挂到预订卡片",
  };
}

function findLinkedReservation(
  expense: ParsedExpenseDraft,
  reservations: ItineraryReservation[],
) {
  const startDate = expense.linked_stay_start_date ?? expense.start_date;
  const endDate = expense.linked_stay_end_date ?? expense.end_date;
  const candidateTypes = new Set(reservationTypesForExpense(expense));
  const candidates = reservations.filter((reservation) =>
    candidateTypes.has(reservation.reservationType),
  );

  return (
    candidates.find((reservation) => {
      const reservationStart = dateValue(reservation.startsAt);
      const reservationEnd = dateValue(reservation.endsAt);
      const dateMatches =
        (!startDate || reservationStart === startDate) &&
        (!endDate || reservationEnd === endDate);
      if (!dateMatches) return false;

      return reservationTextMatches(expense, reservation);
    }) ??
    candidates.find((reservation) => reservationTextMatches(expense, reservation)) ??
    candidates.find((reservation) => {
      const reservationStart = dateValue(reservation.startsAt);
      const reservationEnd = dateValue(reservation.endsAt);
      return (
        (!startDate || reservationStart === startDate) &&
        (!endDate || reservationEnd === endDate)
      );
    }) ??
    null
  );
}

function getReservationValidationNotes(reservations: ParsedReservationDraft[]) {
  const notes: string[] = [];
  const flights = reservations.filter((item) => item.reservation_type === "flight");
  const hotels = reservations.filter((item) => item.reservation_type === "hotel");
  const cars = reservations.filter((item) => item.reservation_type === "car");

  flights.forEach((flight) => {
    const flightEnd = timeValue(flight.ends_at) ?? timeValue(flight.starts_at);
    if (!flightEnd) return;

    [...hotels, ...cars].forEach((reservation) => {
      const reservationStart = timeValue(reservation.starts_at);
      if (!reservationStart) return;

      if (
        reservation.day_date &&
        flight.day_date &&
        reservation.day_date === flight.day_date &&
        reservationStart < flightEnd
      ) {
        notes.push(
          `${reservation.title} 的开始时间早于 ${flight.title} 预计结束时间。`,
        );
      }
    });
  });

  return notes;
}

function PlannerImportContent({ currentUserId }: { currentUserId: string }) {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [journeyMembers, setJourneyMembers] = useState<JourneyMember[]>([]);
  const [existingEvents, setExistingEvents] = useState<ItineraryEvent[]>([]);
  const [existingReservations, setExistingReservations] = useState<
    ItineraryReservation[]
  >([]);
  const [ledgerBaseCurrency, setLedgerBaseCurrency] = useState("NZD");
  const [rawText, setRawText] = useState(() => {
    if (typeof window === "undefined") return "";

    const storedDraft = window.localStorage.getItem(
      `otr:planner-import-draft:${tripId}`,
    );

    if (storedDraft) {
      window.localStorage.removeItem(`otr:planner-import-draft:${tripId}`);
    }

    return storedDraft ?? "";
  });
  const [drafts, setDrafts] = useState<ParsedItineraryDraft[]>([]);
  const [reservationDrafts, setReservationDrafts] = useState<
    ParsedReservationDraft[]
  >([]);
  const [expenseDrafts, setExpenseDrafts] = useState<ParsedExpenseDraft[]>([]);
  const [draftQueue, setDraftQueue] = useState<DraftQueueItem[]>([]);
  const [eventExtras, setEventExtras] = useState<Record<string, EventExtraFields>>(
    {},
  );
  const [reservationExtras, setReservationExtras] = useState<
    Record<string, ReservationExtraFields>
  >({});
  const [lastParsedResult, setLastParsedResult] = useState<AiItineraryResponse | null>(
    null,
  );
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [defaultImportDate, setDefaultImportDate] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [isRecommendationOpen, setIsRecommendationOpen] = useState(false);
  const [inputStatus, setInputStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setDefaultImportDate(normalizeDateParam(params.get("date")));
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadContext() {
      try {
        const [
          tripData,
          memberData,
          journeyMemberData,
          eventData,
          reservationData,
          ledgerData,
        ] = await Promise.all([
          getTrip(tripId),
          getTripMembers(tripId),
          getJourneyMembers(tripId),
          getItineraryEvents(tripId),
          getItineraryReservations(tripId),
          getLedgerData(tripId),
        ]);
        if (isMounted) {
          setTrip(tripData);
          setMembers(memberData);
          setJourneyMembers(journeyMemberData);
          setExistingEvents(eventData);
          setExistingReservations(reservationData);
          setLedgerBaseCurrency(ledgerData.ledger.baseCurrency);
        }
      } catch (contextError) {
        if (isMounted) {
          setError(getErrorMessage(contextError, "无法加载行程导入上下文。"));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadContext();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const currentMember = useMemo(
    () => members.find((member) => member.userId === currentUserId),
    [currentUserId, members],
  );
  const currentJourneyMember = useMemo(
    () => journeyMembers.find((member) => member.userId === currentUserId),
    [currentUserId, journeyMembers],
  );
  const canImport =
    currentMember?.role === "owner" ||
    currentMember?.role === "admin" ||
    trip?.createdBy === currentUserId;
  const hasDrafts =
    drafts.length > 0 || reservationDrafts.length > 0 || expenseDrafts.length > 0;
  const draftCount = drafts.length + reservationDrafts.length + expenseDrafts.length;
  const effectiveImportDate =
    defaultImportDate && trip?.startDate && trip?.endDate
      ? defaultImportDate >= trip.startDate && defaultImportDate <= trip.endDate
        ? defaultImportDate
        : defaultImportDate
      : defaultImportDate;
  const orderedDraftQueue = useMemo(
    () =>
      draftQueue
        .filter((item) => {
          if (item.kind === "event") {
            return drafts.some((draft) => draft.clientId === item.clientId);
          }
          if (item.kind === "reservation") {
            return reservationDrafts.some(
              (draft) => draft.clientId === item.clientId,
            );
          }
          return expenseDrafts.some((draft) => draft.clientId === item.clientId);
        })
        .sort((left, right) => right.createdAt - left.createdAt),
    [draftQueue, drafts, expenseDrafts, reservationDrafts],
  );
  const recommendationDate =
    effectiveImportDate ?? trip?.startDate ?? new Date().toISOString().slice(0, 10);
  const recommendationPlannerDay = useMemo<PlannerV2Day | null>(() => {
    if (!trip || !recommendationDate) return null;

    const coversDate = (startValue: string | null, endValue: string | null) => {
      const startDate = dateValue(startValue);
      const endDate = dateValue(endValue) ?? startDate;
      if (!startDate) return false;
      return startDate <= recommendationDate && (!endDate || endDate >= recommendationDate);
    };

    return {
      day: {
        id: `synthetic-import-${recommendationDate}`,
        tripId,
        dayDate: recommendationDate,
        title: null,
        notes: null,
        orderIndex: 0,
        createdBy: currentUserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      dayNumber: 1,
      dayTag: null,
      reservations: existingReservations.filter((reservation) =>
        coversDate(reservation.startsAt, reservation.endsAt),
      ),
      activities: existingEvents.filter((event) =>
        coversDate(event.plannedStart, event.plannedEnd),
      ),
      memories: [],
    };
  }, [
    currentUserId,
    existingEvents,
    existingReservations,
    recommendationDate,
    trip,
    tripId,
  ]);

  function replaceDraftQueue(parsed: {
    events: ParsedItineraryDraft[];
    reservations: ParsedReservationDraft[];
    expenses: ParsedExpenseDraft[];
  }) {
    const now = Date.now();
    setDraftQueue([
      ...parsed.events.map((draft, index) => ({
        kind: "event" as const,
        clientId: draft.clientId,
        createdAt: now - index,
      })),
      ...parsed.reservations.map((draft, index) => ({
        kind: "reservation" as const,
        clientId: draft.clientId,
        createdAt: now - parsed.events.length - index,
      })),
      ...parsed.expenses.map((draft, index) => ({
        kind: "expense" as const,
        clientId: draft.clientId,
        createdAt: now - parsed.events.length - parsed.reservations.length - index,
      })),
    ]);
  }

  function prependDraftQueueItem(kind: DraftKind, clientId: string) {
    setDraftQueue((current) => [
      { kind, clientId, createdAt: Date.now() },
      ...current.filter(
        (item) => item.kind !== kind || item.clientId !== clientId,
      ),
    ]);
  }

  function reservationMemberOptions() {
    if (journeyMembers.length > 0) {
      return journeyMembers.map((member) => ({
        key: member.id,
        name: member.displayName,
        userId: member.userId,
      }));
    }

    return members.map((member) => ({
      key: member.userId,
      name: member.name,
      userId: member.userId,
    }));
  }

  function selectedReservationMemberOptions(
    reservation: ParsedReservationDraft,
  ) {
    const selectedNames = new Set(reservation.participant_names.map(normalizedText));
    const selectedUserIds = new Set(reservation.matched_participant_user_ids);

    return reservationMemberOptions().filter(
      (member) =>
        selectedNames.has(normalizedText(member.name)) ||
        (member.userId ? selectedUserIds.has(member.userId) : false),
    );
  }

  function updateReservationParticipants(
    clientId: string,
    selectedMembers: Array<{ name: string; userId: string | null }>,
  ) {
    updateReservationDraft(clientId, {
      participant_names: selectedMembers.map((member) => member.name),
      matched_participant_user_ids: selectedMembers
        .map((member) => member.userId)
        .filter((userId): userId is string => Boolean(userId)),
      unmatched_participant_names: [],
    });
  }

  function recomputeWarnings(nextDrafts: ParsedItineraryDraft[]) {
    return addConflictWarnings(
      nextDrafts.map((draft) => ({ ...draft, warnings: [] })),
      existingEvents,
    );
  }

  function withDefaultImportDate(parsed: {
    events: ParsedItineraryDraft[];
    reservations: ParsedReservationDraft[];
    expenses: ParsedExpenseDraft[];
  }) {
    if (!effectiveImportDate) return parsed;

    return {
      events: parsed.events.map((draft) => ({
        ...draft,
        day_date: draft.day_date ?? effectiveImportDate,
      })),
      reservations: parsed.reservations.map((reservation) => ({
        ...reservation,
        day_date: reservation.day_date ?? dateValue(reservation.starts_at) ?? effectiveImportDate,
      })),
      expenses: parsed.expenses.map((expense) => ({
        ...expense,
        expense_date: expense.expense_date ?? expense.start_date ?? effectiveImportDate,
        start_date: expense.start_date ?? effectiveImportDate,
      })),
    };
  }

  function updateDraft(
    clientId: string,
    patch: Partial<ParsedItineraryDraft>,
  ) {
    setDrafts((current) =>
      recomputeWarnings(
        current.map((draft) =>
          draft.clientId === clientId ? { ...draft, ...patch } : draft,
        ),
      ),
    );
  }

  function updateReservationDraft(
    clientId: string,
    patch: Partial<ParsedReservationDraft>,
  ) {
    setReservationDrafts((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
  }

  function updateExpenseDraft(
    clientId: string,
    patch: Partial<ParsedExpenseDraft>,
  ) {
    setExpenseDrafts((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
  }

  function removeDraft(kind: DraftKind, clientId: string) {
    if (kind === "event") {
      setDrafts((current) => current.filter((item) => item.clientId !== clientId));
      setEventExtras((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
    } else if (kind === "reservation") {
      setReservationDrafts((current) =>
        current.filter((item) => item.clientId !== clientId),
      );
      setReservationExtras((current) => {
        const next = { ...current };
        delete next[clientId];
        return next;
      });
    } else {
      setExpenseDrafts((current) =>
        current.filter((item) => item.clientId !== clientId),
      );
    }

    setDraftQueue((current) =>
      current.filter((item) => item.kind !== kind || item.clientId !== clientId),
    );
  }

  async function upsertDayForDate(
    date: string | null,
    title?: string | null,
    notes?: string | null,
  ) {
    if (!date) return null;

    const day = await upsertTripDay({
      tripId,
      date,
      title: title ?? null,
      notes: notes ?? null,
    });
    return day.id;
  }

  const voiceRecorder = useVoiceRecorder({
    onRecordingComplete: async (file) => {
      setIsTranscribing(true);
      setInputStatus("正在转写语音，完成后会填入上面的文本框。");
      setError(null);
      try {
        const result = await requestVoiceTranscription({ tripId, audio: file });
        const normalizedTranscript = normalizePlannerImportVoiceTranscript(
          result.transcript,
        );
        setRawText((current) => appendTextBlock(current, normalizedTranscript));
        setInputStatus(
          result.model
            ? `语音已整理成可解析文本，可修改后再解析。模型：${result.model}`
            : "语音已整理成可解析文本，可修改后再解析。",
        );
      } catch (voiceError) {
        setError(getErrorMessage(voiceError, "语音转文字失败。"));
        setInputStatus(null);
      } finally {
        setIsTranscribing(false);
      }
    },
    onError: (recordingError) => {
      setError(getErrorMessage(recordingError, "无法开始录音。"));
      setInputStatus(null);
    },
  });

  async function toggleVoiceRecording() {
    if (voiceRecorder.isRecording) {
      voiceRecorder.stop();
      return;
    }

    setInputStatus("正在录音。说完停顿一下会自动转写，也可以再次点击结束。");
    await voiceRecorder.start();
  }

  async function readItineraryImage(file: File) {
    setIsReadingImage(true);
    setInputStatus("正在读取图片里的行程文字，可能需要几十秒。");
    setError(null);
    let previewUrl: string | null = null;

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("请先登录。");

      const compressed = await compressImageFile(file);
      previewUrl = compressed.previewUrl;
      const formData = new FormData();
      formData.append("tripId", tripId);
      formData.append(
        "image",
        new File([compressed.blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
          type: "image/jpeg",
        }),
      );

      const response = await fetch("/api/ai/read-itinerary-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const payload = (await response.json()) as {
        text?: string;
        provider?: string;
        model?: string;
        error?: string;
      };

      if (!response.ok || !payload.text) {
        throw new Error(payload.error || "无法读取图片文字。");
      }

      setRawText((current) => appendTextBlock(current, payload.text ?? ""));
      setInputStatus(
        `图片内容已生成文字，可修改后再解析。${payload.provider ? `来源：${payload.provider}` : ""}${
          payload.model ? ` / ${payload.model}` : ""
        }`,
      );
    } catch (imageError) {
      setError(getErrorMessage(imageError, "图片解析失败。"));
      setInputStatus(null);
    } finally {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setIsReadingImage(false);
    }
  }

  function addQuickEvent(type: QuickAddType) {
    setMessage(null);
    setError(null);

    if (type === "expense") {
      const clientId = makeDraftId("quick-expense");
      setExpenseDrafts((current) => [
        {
          clientId,
          title: "新费用",
          category: "other",
          accounting_mode: "shared",
          expense_date: effectiveImportDate,
          start_date: effectiveImportDate,
          end_date: effectiveImportDate,
          original_amount: null,
          original_currency: ledgerBaseCurrency,
          payer_name: currentJourneyMember?.displayName ?? currentMember?.name ?? null,
          payer_member_id: currentJourneyMember?.id ?? null,
          participant_names: journeyMembers.map((member) => member.displayName),
          participant_member_ids: journeyMembers.map((member) => member.id),
          unmatched_participant_names: [],
          address_text: null,
          linked_stay_title: null,
          linked_stay_location: null,
          linked_stay_start_date: null,
          linked_stay_end_date: null,
          source_excerpt: "快速添加单条费用",
          confidence: 1,
          needs_review: false,
        },
        ...current,
      ]);
      prependDraftQueueItem("expense", clientId);
      setInputStatus("已添加 1 笔费用草稿，可以在下面编辑。");
      return;
    }

    if (
      type === "hotel" ||
      type === "car" ||
      type === "flight" ||
      type === "ferry" ||
      type === "tour" ||
      type === "restaurant"
    ) {
      const reservationType: ItineraryReservationType =
        type === "hotel"
          ? "hotel"
          : type === "car"
            ? "car"
            : type === "flight"
              ? "flight"
              : type === "ferry"
                ? "ferry"
                : type === "tour"
                  ? "tour"
                  : "restaurant";
      const titleByType: Record<Exclude<QuickAddType, "event" | "expense">, string> = {
        hotel: "新住宿",
        car: "新租车",
        flight: "新航班",
        ferry: "新轮渡",
        tour: "新活动预订",
        restaurant: "新餐厅预订",
      };
      const title = titleByType[type];
      const startTime =
        type === "hotel"
          ? "15:00"
          : type === "restaurant"
            ? "19:00"
            : type === "car"
              ? "09:00"
              : "09:00";
      const endDate =
        type === "hotel" && effectiveImportDate
          ? addDateDays(effectiveImportDate, 1)
          : effectiveImportDate;
      const endTime =
        type === "hotel"
          ? "11:00"
          : type === "restaurant"
            ? "21:00"
            : type === "car"
              ? "18:00"
              : "12:00";
      const clientId = makeDraftId(`quick-${type}`);
      const defaultParticipants = reservationMemberOptions();

      setReservationDrafts((current) => [
        {
          clientId,
          reservation_type: reservationType,
          title,
          day_date: effectiveImportDate,
          location_name: "",
          starts_at: localDateTimeIso(effectiveImportDate, startTime),
          ends_at: localDateTimeIso(endDate, endTime),
          participant_names: defaultParticipants.map((member) => member.name),
          matched_participant_user_ids: defaultParticipants
            .map((member) => member.userId)
            .filter((userId): userId is string => Boolean(userId)),
          unmatched_participant_names: [],
          source_excerpt: "快速添加单条预订",
          confidence: 1,
          needs_review: false,
        },
        ...current,
      ]);
      prependDraftQueueItem("reservation", clientId);
      setInputStatus(`已添加 1 个${title}草稿，可以在下面编辑。`);
      return;
    }

    const clientId = makeDraftId("quick-event");
    setDrafts((current) =>
      recomputeWarnings([
        {
          clientId,
          day_date: effectiveImportDate,
          day_title: null,
          day_notes: null,
          title: "新日程",
          description: "",
          event_type: "activity",
          location_name: "",
          planned_start: localDateTimeIso(effectiveImportDate, "09:00"),
          planned_end: localDateTimeIso(effectiveImportDate, "10:00"),
          participant_names: members.map((member) => member.name),
          matched_participant_user_ids: members.map((member) => member.userId),
          unmatched_participant_names: [],
          confidence: 1,
          date_confidence: effectiveImportDate ? 1 : null,
          time_confidence: 0.8,
          participants_confidence: 1,
          location_confidence: null,
          is_estimated_time: true,
          needs_review: false,
          source_excerpt: "快速添加单条行程",
          warnings: [],
          importAnyway: false,
          participantMode: "everyone",
        },
        ...current,
      ]),
    );
    prependDraftQueueItem("event", clientId);
    setInputStatus("已添加 1 个日程草稿，可以在下面编辑。");
  }

  async function parseWithAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsParsing(true);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("请先登录。");
      }

      const response = await fetch("/api/ai/parse-itinerary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tripId, rawText }),
      });
      const body = (await response.json()) as {
        parsed?: AiItineraryResponse;
        error?: string;
      };

      if (!response.ok || !body.parsed) {
        throw new Error(body.error || "无法解析行程。");
      }

      setLastParsedResult(body.parsed);
      const baseParsed = toPlannerDrafts(body.parsed, members, journeyMembers);
      const parsed = withDefaultImportDate(baseParsed);
      setAiWarnings([
        ...baseParsed.warnings,
        ...getReservationValidationNotes(parsed.reservations),
      ]);
      const nextDrafts = addConflictWarnings(parsed.events, existingEvents);
      setDrafts(nextDrafts);
      setReservationDrafts(parsed.reservations);
      setExpenseDrafts(parsed.expenses);
      replaceDraftQueue({
        events: nextDrafts,
        reservations: parsed.reservations,
        expenses: parsed.expenses,
      });
      setEventExtras({});
      setReservationExtras({});
      if (
        nextDrafts.length === 0 &&
        parsed.reservations.length === 0 &&
        parsed.expenses.length === 0
      ) {
        setMessage("没有识别到可导入的行程草稿。可以补充日期、时间、航班号、酒店名或地址后再试。");
      }
    } catch (parseError) {
      setError(getErrorMessage(parseError, "无法解析行程。"));
    } finally {
      setIsParsing(false);
    }
  }

  function openParserUpgrade() {
    window.sessionStorage.setItem(
      "otr:parser-upgrade:draft",
      JSON.stringify({
        source: "planner_import",
        journeyId: tripId,
        originalText: rawText,
        currentParseResult:
          lastParsedResult ?? {
            events: drafts,
            reservations: reservationDrafts,
            expenses: expenseDrafts,
            warnings: aiWarnings,
          },
        language: /[\u4e00-\u9fff]/.test(rawText) ? "zh" : "en",
        contextSnapshot: {
          trip,
          members,
          journeyMembers,
          existingReservations,
          existingEvents,
          ledgerBaseCurrency,
        },
      }),
    );
    router.push("/parser-upgrade?source=planner-import");
  }

  function getParticipantIds(draft: ParsedItineraryDraft) {
    if (draft.participantMode === "everyone") {
      return members.map((member) => member.userId);
    }
    if (draft.participantMode === "only_me") {
      return [currentUserId];
    }
    return draft.matched_participant_user_ids;
  }

  async function saveEventDraft(draft: ParsedItineraryDraft) {
    const hasCritical = draft.warnings.some(
      (warning) => warning.severity === "critical",
    );
    if (hasCritical && !draft.importAnyway) {
      throw new Error("这条行程还有严重提醒。请勾选仍然导入，或先修正草稿。");
    }

    const extra = eventExtras[draft.clientId];
    const dayId = await upsertDayForDate(
      draft.day_date,
      draft.day_title,
      draft.day_notes,
    );

    await createItineraryEvent({
      tripId,
      tripDayId: dayId,
      title: draft.title,
      description: draft.description ?? "",
      eventType: draft.event_type,
      locationName: draft.location_name ?? "",
      plannedStart: draft.planned_start ? toInputDateTime(draft.planned_start) : "",
      plannedEnd: draft.planned_end ? toInputDateTime(draft.planned_end) : "",
      bookingReference: extra?.bookingReference ?? "",
      url: extra?.url ?? "",
      sourceText: draft.source_excerpt,
      confidence: draft.confidence,
      needsReview: draft.needs_review || draft.warnings.length > 0,
      isEstimatedTime: draft.is_estimated_time,
      dateConfidence: draft.date_confidence,
      timeConfidence: draft.time_confidence,
      participantsConfidence: draft.participants_confidence,
      locationConfidence: draft.location_confidence,
      participantUserIds: getParticipantIds(draft),
    });

    removeDraft("event", draft.clientId);
    setMessage(`已添加行程「${draft.title}」。`);
  }

  async function saveReservationDraft(reservation: ParsedReservationDraft) {
    const extra = reservationExtras[reservation.clientId];
    const dayId = await upsertDayForDate(
      reservation.day_date ?? dateValue(reservation.starts_at),
    );
    const createdReservation = await createItineraryReservation({
      tripId,
      tripDayId: dayId,
      reservationType: reservation.reservation_type,
      title: reservation.title,
      provider: extra?.provider || null,
      locationName: reservation.location_name,
      startsAt: reservation.starts_at ? toInputDateTime(reservation.starts_at) : null,
      endsAt: reservation.ends_at ? toInputDateTime(reservation.ends_at) : null,
      confirmationCode: extra?.confirmationCode || null,
      url: extra?.url || null,
      sourceText: reservation.source_excerpt,
      confidence: reservation.confidence,
      needsReview: reservation.needs_review,
      participantUserIds:
        reservation.matched_participant_user_ids.length > 0
          ? reservation.matched_participant_user_ids
          : reservationMemberOptions()
              .map((member) => member.userId)
              .filter((userId): userId is string => Boolean(userId)),
    });

    setExistingReservations((current) => [...current, createdReservation]);
    removeDraft("reservation", reservation.clientId);
    setMessage(`已添加预订「${reservation.title}」。`);
  }

  async function saveExpenseDraft(expense: ParsedExpenseDraft) {
    if (!expense.original_amount) {
      throw new Error(`${expense.title} 缺少金额，无法保存账本。`);
    }
    if (!expense.expense_date) {
      throw new Error(`${expense.title} 缺少日期，无法保存账本。`);
    }
    if (expense.accounting_mode === "shared" && !expense.payer_member_id) {
      throw new Error(`${expense.title} 缺少付款人。`);
    }
    if (
      expense.accounting_mode === "shared" &&
      expense.participant_member_ids.length === 0
    ) {
      throw new Error(`${expense.title} 至少需要 1 个分摊成员。`);
    }

    const rate = await getApproxExchangeRate(
      expense.original_currency,
      ledgerBaseCurrency,
    );
    const linkedReservation = findLinkedReservation(expense, existingReservations);

    await createLedgerEntry({
      journeyId: tripId,
      itineraryReservationId: linkedReservation?.id ?? null,
      title: expense.title,
      description: expense.source_excerpt ?? "",
      category: expense.category,
      accountingMode: expense.accounting_mode,
      expenseDate: expense.expense_date,
      startDate: expense.start_date ?? undefined,
      endDate: expense.end_date ?? undefined,
      originalAmount: expense.original_amount,
      originalCurrency: expense.original_currency,
      baseCurrency: ledgerBaseCurrency,
      exchangeRate: rate.rate,
      payerMemberId: expense.payer_member_id,
      participantMemberIds: expense.participant_member_ids,
      addressText: expense.address_text ?? undefined,
    });

    removeDraft("expense", expense.clientId);
    setMessage(`已保存账本「${expense.title}」。`);
  }

  async function saveOneDraft(item: DraftQueueItem) {
    setError(null);
    setMessage(null);
    setSavingDraftId(item.clientId);

    try {
      if (item.kind === "event") {
        const draft = drafts.find((value) => value.clientId === item.clientId);
        if (!draft) throw new Error("找不到这条行程草稿。");
        await saveEventDraft(draft);
      } else if (item.kind === "reservation") {
        const draft = reservationDrafts.find(
          (value) => value.clientId === item.clientId,
        );
        if (!draft) throw new Error("找不到这条预订草稿。");
        await saveReservationDraft(draft);
      } else {
        const draft = expenseDrafts.find((value) => value.clientId === item.clientId);
        if (!draft) throw new Error("找不到这条账本草稿。");
        await saveExpenseDraft(draft);
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError, "无法保存这条草稿。"));
    } finally {
      setSavingDraftId(null);
    }
  }

  async function importDrafts() {
    setError(null);
    setMessage(null);
    setIsImporting(true);

    try {
      const importable = drafts.filter((draft) => {
        const hasCritical = draft.warnings.some(
          (warning) => warning.severity === "critical",
        );
        return !hasCritical || draft.importAnyway;
      });
      const skipped = drafts.length - importable.length;

      if (
        importable.length === 0 &&
        reservationDrafts.length === 0 &&
        expenseDrafts.length === 0
      ) {
        throw new Error("暂时没有可导入的草稿。请先确认严重提醒，或删除有问题的草稿。");
      }

      const dayInputs = new Map<
        string,
        { title: string | null; notes: string | null }
      >();

      reservationDrafts.forEach((reservation) => {
        const dates = getDatesInRange(reservation.starts_at, reservation.ends_at);
        (dates.length > 0 ? dates : reservation.day_date ? [reservation.day_date] : [])
          .forEach((date) => {
            const existing = dayInputs.get(date);
            dayInputs.set(date, {
              title: existing?.title || null,
              notes: existing?.notes || null,
            });
          });
      });

      expenseDrafts.forEach((expense) => {
        const date = expense.expense_date ?? expense.start_date;
        if (!date) return;
        const existing = dayInputs.get(date);
        dayInputs.set(date, {
          title: existing?.title || null,
          notes: existing?.notes || null,
        });
      });

      importable.forEach((draft) => {
        if (!draft.day_date) return;
        const existing = dayInputs.get(draft.day_date);
        dayInputs.set(draft.day_date, {
          title: draft.day_title || existing?.title || null,
          notes: draft.day_notes || existing?.notes || null,
        });
      });

      const dayEntries = await Promise.all(
        [...dayInputs.entries()].map(async ([date, input]) => {
          const day = await upsertTripDay({
            tripId,
            date,
            title: input.title,
            notes: input.notes,
          });
          return [date, day.id] as const;
        }),
      );
      const dayIdByDate = new Map(dayEntries);

      const createdReservations = await Promise.all(
        reservationDrafts.map(async (reservation) => {
          const createdReservation = await createItineraryReservation({
              tripId,
              tripDayId: reservation.day_date
                ? dayIdByDate.get(reservation.day_date)
                : null,
              reservationType: reservation.reservation_type,
              title: reservation.title,
              locationName: reservation.location_name,
              startsAt: reservation.starts_at
                ? toInputDateTime(reservation.starts_at)
                : null,
              endsAt: reservation.ends_at
                ? toInputDateTime(reservation.ends_at)
                : null,
              sourceText: reservation.source_excerpt,
              confidence: reservation.confidence,
              needsReview: reservation.needs_review,
              participantUserIds:
                reservation.participant_names.length > 0
                  ? reservation.matched_participant_user_ids
                  : reservationMemberOptions()
                      .map((member) => member.userId)
                      .filter((userId): userId is string => Boolean(userId)),
            });
          return createdReservation;
        }),
      );
      const availableReservations = [...existingReservations, ...createdReservations];

      await Promise.all(
        importable.map((draft) =>
            createItineraryEvent({
            tripId,
            tripDayId: draft.day_date ? dayIdByDate.get(draft.day_date) : null,
            title: draft.title,
            description: draft.description ?? "",
            eventType: draft.event_type,
            locationName: draft.location_name ?? "",
            plannedStart: draft.planned_start ? toInputDateTime(draft.planned_start) : "",
            plannedEnd: draft.planned_end ? toInputDateTime(draft.planned_end) : "",
            bookingReference: "",
            url: "",
            sourceText: draft.source_excerpt,
            confidence: draft.confidence,
            needsReview: draft.needs_review || draft.warnings.length > 0,
            isEstimatedTime: draft.is_estimated_time,
            dateConfidence: draft.date_confidence,
            timeConfidence: draft.time_confidence,
            participantsConfidence: draft.participants_confidence,
            locationConfidence: draft.location_confidence,
            participantUserIds: getParticipantIds(draft),
            }),
          ),
      );

      await Promise.all(
        expenseDrafts.map(async (expense) => {
          if (!expense.original_amount) {
            throw new Error(`${expense.title} 缺少金额，无法导入账本。`);
          }
          if (!expense.expense_date) {
            throw new Error(`${expense.title} 缺少日期，无法导入账本。`);
          }

          const rate = await getApproxExchangeRate(
            expense.original_currency,
            ledgerBaseCurrency,
          );
          const linkedReservation = findLinkedReservation(
            expense,
            availableReservations,
          );

          await createLedgerEntry({
            journeyId: tripId,
            itineraryReservationId: linkedReservation?.id ?? null,
            title: expense.title,
            description: expense.source_excerpt ?? "",
            category: expense.category,
            accountingMode: expense.accounting_mode,
            expenseDate: expense.expense_date,
            startDate: expense.start_date ?? undefined,
            endDate: expense.end_date ?? undefined,
            originalAmount: expense.original_amount,
            originalCurrency: expense.original_currency,
            baseCurrency: ledgerBaseCurrency,
            exchangeRate: rate.rate,
            payerMemberId: expense.payer_member_id,
            participantMemberIds: expense.participant_member_ids,
            addressText: expense.address_text ?? undefined,
          });
        }),
      );

      setMessage(
        skipped > 0
          ? `已导入 ${importable.length} 个行程、${reservationDrafts.length} 个预订和 ${expenseDrafts.length} 笔账本。已跳过 ${skipped} 个未确认严重提醒的行程。`
          : `已导入 ${importable.length} 个行程、${reservationDrafts.length} 个预订和 ${expenseDrafts.length} 笔账本。`,
      );
      setTimeout(() => router.push(`/trips/${tripId}/planner`), 900);
    } catch (importError) {
      setError(getErrorMessage(importError, "无法导入行程草稿。"));
    } finally {
      setIsImporting(false);
    }
  }

  if (isLoading) {
    return <div className="rounded-2xl bg-white p-5">正在加载导入工具...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            {trip?.name || "旅程"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-950">
            导入行程
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
            粘贴航班、酒店、租车、聊天记录或粗略计划。系统会先解析成草稿，你确认后才写入行程。
          </p>
        </div>
        {recommendationPlannerDay ? (
          <button
            type="button"
            onClick={() => setIsRecommendationOpen((current) => !current)}
            className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-black text-white shadow-sm"
          >
            最佳行程推荐
          </button>
        ) : null}
      </section>

      {isRecommendationOpen && recommendationPlannerDay ? (
        <AiRouteRecommendationPanel
          tripId={tripId}
          journeyName={trip?.name ?? ""}
          destination={trip?.destination ?? ""}
          plannerDay={recommendationPlannerDay}
          onSaved={() => {
            setMessage("AI 推荐行程已加入当天卡片。");
            void getItineraryEvents(tripId)
              .then(setExistingEvents)
              .catch(() => undefined);
          }}
        />
      ) : null}

      {!canImport ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          只有旅程所有者和管理员可以导入行程。
        </p>
      ) : null}

      <form
        onSubmit={parseWithAi}
        className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">粘贴行程文本</h2>
            {effectiveImportDate ? (
              <p className="mt-1 text-xs font-bold text-emerald-700">
                默认日期：{effectiveImportDate}。文本中写了其他日期时，以文本为准。
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={toggleVoiceRecording}
              disabled={!canImport || isTranscribing || isReadingImage}
              className={`rounded-full px-3 py-2 text-xs font-bold ${
                voiceRecorder.isRecording
                  ? "bg-red-600 text-white"
                  : "bg-stone-100 text-stone-700"
              } disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400`}
            >
              {voiceRecorder.isRecording
                ? "结束录音"
                : isTranscribing
                  ? "正在转写"
                  : "语音录入"}
            </button>
            <label
              className={`cursor-pointer rounded-full px-3 py-2 text-xs font-bold ${
                isReadingImage
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-stone-100 text-stone-700"
              }`}
            >
              {isReadingImage ? "正在读图" : "上传图片识别"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!canImport || isReadingImage || isTranscribing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void readItineraryImage(file);
                }}
              />
            </label>
          </div>
        </div>
        <textarea
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          rows={10}
          placeholder="粘贴航班、酒店预订、租车信息、聊天记录，或按天写的粗略计划..."
          className="w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
        />
        <button
          type="submit"
          disabled={!canImport || isParsing || rawText.trim().length < 10}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {isParsing ? "正在解析..." : "解析行程"}
        </button>
        {inputStatus ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
            {inputStatus}
          </p>
        ) : null}
      </form>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">
              快速添加单条行程
            </p>
            <p className="mt-1 text-sm text-stone-600">
              不想批量解析时，可以直接生成一个可编辑草稿。
              {effectiveImportDate ? ` 默认填入 ${effectiveImportDate}。` : ""}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["hotel", "住宿"],
            ["flight", "航班"],
            ["car", "租车"],
            ["event", "日程"],
            ["expense", "费用"],
            ["restaurant", "餐厅"],
            ["tour", "活动预订"],
            ["ferry", "轮渡"],
          ].map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => addQuickEvent(type as QuickAddType)}
              disabled={!canImport}
              className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {hasDrafts && lastParsedResult ? (
        <section className="flex flex-col gap-3 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-800">已生成解析草稿</p>
            <p className="text-sm text-emerald-900">
              {drafts.length} 个行程、{reservationDrafts.length} 个预订、{expenseDrafts.length} 笔账本。请先检查下面的草稿。
            </p>
          </div>
          <button
            type="button"
            onClick={openParserUpgrade}
            className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm"
          >
            导入结果不对？升级解析器
          </button>
        </section>
      ) : null}

      {!hasDrafts && rawText.trim().length >= 10 && (message || error) ? (
        <section className="flex flex-col gap-3 rounded-3xl border border-amber-100 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-900">解析不满意？</p>
            <p className="text-sm text-amber-900">
              可以把这条失败输入提交给 Parser Upgrade，保存成后续可复用的样本。
            </p>
          </div>
          <button
            type="button"
            onClick={openParserUpgrade}
            className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-amber-900 shadow-sm"
          >
            教它一次
          </button>
        </section>
      ) : null}

      {aiWarnings.length > 0 ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          <p className="font-bold">解析提醒</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {aiWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {orderedDraftQueue.length > 0 ? (
        <section className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">待处理草稿</p>
            <h2 className="text-2xl font-semibold text-stone-950">
              {orderedDraftQueue.length} 条草稿
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              新增的草稿会排在最上方。每条都可以单独保存，不必等待统一导入。
            </p>
          </div>

          {orderedDraftQueue.map((item) => {
            if (item.kind === "event") {
              const draft = drafts.find((value) => value.clientId === item.clientId);
              if (!draft) return null;
              const hasCritical = draft.warnings.some(
                (warning) => warning.severity === "critical",
              );
              const extra = eventExtras[draft.clientId] ?? {
                bookingReference: "",
                url: "",
              };

              return (
                <article
                  key={`${item.kind}-${item.clientId}`}
                  className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="mb-3 text-sm font-bold text-emerald-700">
                        行程草稿
                        {draft.day_date ? ` · ${draft.day_date}` : ""}
                      </p>
                      <input
                        value={draft.title}
                        onChange={(event) =>
                          updateDraft(draft.clientId, { title: event.target.value })
                        }
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-lg font-semibold text-stone-950"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDraft("event", draft.clientId)}
                      className="shrink-0 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700"
                    >
                      删除
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="date"
                      value={draft.day_date ?? ""}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          day_date: event.target.value || null,
                        })
                      }
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    />
                    <input
                      value={draft.day_title ?? ""}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          day_title: event.target.value || null,
                        })
                      }
                      placeholder="当天标题"
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    />
                    <select
                      value={draft.event_type}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          event_type: event.target.value as ItineraryEventType,
                        })
                      }
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    >
                      {eventTypes.map((type) => (
                        <option key={type} value={type}>
                          {eventTypeLabels[type]}
                        </option>
                      ))}
                    </select>
                    <input
                      value={draft.location_name ?? ""}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          location_name: event.target.value || null,
                        })
                      }
                      placeholder="地点"
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    />
                    <input
                      type="datetime-local"
                      value={toInputDateTime(draft.planned_start)}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          planned_start: event.target.value || null,
                        })
                      }
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    />
                    <input
                      type="datetime-local"
                      value={toInputDateTime(draft.planned_end)}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          planned_end: event.target.value || null,
                        })
                      }
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    />
                    <input
                      value={extra.bookingReference}
                      onChange={(event) =>
                        setEventExtras((current) => ({
                          ...current,
                          [draft.clientId]: {
                            ...extra,
                            bookingReference: event.target.value,
                          },
                        }))
                      }
                      placeholder="预订号 / 参考号"
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    />
                    <input
                      value={extra.url}
                      onChange={(event) =>
                        setEventExtras((current) => ({
                          ...current,
                          [draft.clientId]: { ...extra, url: event.target.value },
                        }))
                      }
                      placeholder="链接"
                      className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    />
                  </div>

                  <textarea
                    value={draft.description ?? ""}
                    onChange={(event) =>
                      updateDraft(draft.clientId, {
                        description: event.target.value || null,
                      })
                    }
                    placeholder="说明"
                    rows={4}
                    className="w-full resize-y rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  />

                  <textarea
                    value={draft.day_notes ?? ""}
                    onChange={(event) =>
                      updateDraft(draft.clientId, {
                        day_notes: event.target.value || null,
                      })
                    }
                    placeholder="当天备注"
                    rows={2}
                    className="w-full resize-y rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  />

                  <div className="space-y-3 rounded-2xl bg-emerald-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-emerald-900">参与人</p>
                      <select
                        value={draft.participantMode}
                        onChange={(event) =>
                          updateDraft(draft.clientId, {
                            participantMode: event.target
                              .value as ParsedItineraryDraft["participantMode"],
                          })
                        }
                        className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-sm font-bold text-emerald-900"
                      >
                        <option value="everyone">所有人</option>
                        <option value="only_me">只有我</option>
                        <option value="detected">识别到的参与人</option>
                        <option value="custom">自定义</option>
                      </select>
                    </div>
                    {draft.participantMode === "custom" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {members.map((member) => (
                          <label
                            key={member.userId}
                            className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-stone-800"
                          >
                            <input
                              type="checkbox"
                              checked={draft.matched_participant_user_ids.includes(
                                member.userId,
                              )}
                              onChange={(event) => {
                                const nextIds = event.target.checked
                                  ? [
                                      ...draft.matched_participant_user_ids,
                                      member.userId,
                                    ]
                                  : draft.matched_participant_user_ids.filter(
                                      (userId) => userId !== member.userId,
                                    );
                                updateDraft(draft.clientId, {
                                  matched_participant_user_ids: [
                                    ...new Set(nextIds),
                                  ],
                                });
                              }}
                            />
                            {member.name}
                          </label>
                        ))}
                      </div>
                    ) : null}
                    {draft.participant_names.length > 0 ? (
                      <p className="text-xs text-emerald-900">
                        识别到：{draft.participant_names.join(", ")}
                      </p>
                    ) : null}
                    {draft.unmatched_participant_names.length > 0 ? (
                      <p className="text-xs text-amber-800">
                        未匹配到旅程成员：
                        {draft.unmatched_participant_names.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  {draft.source_excerpt ? (
                    <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
                      来源文本：{draft.source_excerpt}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2 text-xs font-bold text-stone-600">
                    {draft.is_estimated_time ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                        时间为估算
                      </span>
                    ) : null}
                    {draft.confidence !== null ? (
                      <span className="rounded-full bg-stone-100 px-3 py-1">
                        置信度 {Math.round(draft.confidence * 100)}%
                      </span>
                    ) : null}
                  </div>

                  {draft.warnings.length > 0 ? (
                    <div className="space-y-2">
                      {draft.warnings.map((warning, index) => (
                        <p
                          key={`${warning.type}-${index}`}
                          className={`rounded-xl border px-3 py-2 text-sm font-medium ${warningClass(warning.severity)}`}
                        >
                          {warning.message}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {hasCritical ? (
                    <label className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
                      <input
                        type="checkbox"
                        checked={draft.importAnyway}
                        onChange={(event) =>
                          updateDraft(draft.clientId, {
                            importAnyway: event.target.checked,
                          })
                        }
                      />
                      仍然导入
                    </label>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void saveOneDraft(item)}
                    disabled={savingDraftId === draft.clientId}
                    className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {savingDraftId === draft.clientId ? "正在保存..." : "保存这条行程"}
                  </button>
                </article>
              );
            }

            if (item.kind === "reservation") {
              const reservation = reservationDrafts.find(
                (value) => value.clientId === item.clientId,
              );
              if (!reservation) return null;
              const extra = reservationExtras[reservation.clientId] ?? {
                provider: "",
                confirmationCode: "",
                url: "",
              };
              const reservationCopy = reservationFormCopy(
                reservation.reservation_type,
              );
              const participantOptions = reservationMemberOptions();
              const selectedParticipants =
                selectedReservationMemberOptions(reservation);
              const selectedParticipantKeys = new Set(
                selectedParticipants.map((member) => member.key),
              );
              const allSelected =
                participantOptions.length > 0 &&
                participantOptions.every((member) =>
                  selectedParticipantKeys.has(member.key),
                );

              return (
                <article
                  key={`${item.kind}-${item.clientId}`}
                  className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="mb-3 text-sm font-bold text-emerald-700">
                        {reservationCopy.heading}
                        {reservation.day_date ? ` · ${reservation.day_date}` : ""}
                      </p>
                      <label className="mb-1 block text-xs font-bold text-stone-500">
                        {reservationCopy.titleLabel}
                      </label>
                      <input
                        value={reservation.title}
                        onChange={(event) =>
                          updateReservationDraft(reservation.clientId, {
                            title: event.target.value,
                          })
                        }
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-lg font-semibold text-stone-950"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        removeDraft("reservation", reservation.clientId)
                      }
                      className="shrink-0 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700"
                    >
                      删除
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-500">
                        预订类型
                      </span>
                      <select
                        value={reservation.reservation_type}
                        onChange={(event) =>
                          updateReservationDraft(reservation.clientId, {
                            reservation_type: event.target
                              .value as ItineraryReservationType,
                          })
                        }
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      >
                        {reservationTypes.map((type) => (
                          <option key={type} value={type}>
                            {reservationTypeLabels[type]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-500">
                        {reservationCopy.locationLabel}
                      </span>
                      <input
                        value={reservation.location_name ?? ""}
                        onChange={(event) =>
                          updateReservationDraft(reservation.clientId, {
                            location_name: event.target.value || null,
                          })
                        }
                        placeholder={reservationCopy.locationLabel}
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-500">
                        {reservationCopy.startLabel}
                      </span>
                      <input
                        type="datetime-local"
                        value={toInputDateTime(reservation.starts_at)}
                        onChange={(event) =>
                          updateReservationDraft(reservation.clientId, {
                            day_date: event.target.value
                              ? event.target.value.slice(0, 10)
                              : reservation.day_date,
                            starts_at: event.target.value || null,
                          })
                        }
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-500">
                        {reservationCopy.endLabel}
                      </span>
                      <input
                        type="datetime-local"
                        value={toInputDateTime(reservation.ends_at)}
                        onChange={(event) =>
                          updateReservationDraft(reservation.clientId, {
                            ends_at: event.target.value || null,
                          })
                        }
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-500">
                        {reservationCopy.providerLabel}
                      </span>
                      <input
                        value={extra.provider}
                        onChange={(event) =>
                          setReservationExtras((current) => ({
                            ...current,
                            [reservation.clientId]: {
                              ...extra,
                              provider: event.target.value,
                            },
                          }))
                        }
                        placeholder={reservationCopy.providerLabel}
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-500">
                        {reservationCopy.codeLabel}
                      </span>
                      <input
                        value={extra.confirmationCode}
                        onChange={(event) =>
                          setReservationExtras((current) => ({
                            ...current,
                            [reservation.clientId]: {
                              ...extra,
                              confirmationCode: event.target.value,
                            },
                          }))
                        }
                        placeholder={reservationCopy.codeLabel}
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-xs font-bold text-stone-500">
                        {reservationCopy.urlLabel}
                      </span>
                      <input
                        value={extra.url}
                        onChange={(event) =>
                          setReservationExtras((current) => ({
                            ...current,
                            [reservation.clientId]: {
                              ...extra,
                              url: event.target.value,
                            },
                          }))
                        }
                        placeholder={reservationCopy.urlLabel}
                        className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                    </label>
                  </div>

                  <div className="space-y-3 rounded-2xl bg-emerald-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-emerald-900">
                        {reservationCopy.peopleLabel}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          updateReservationParticipants(
                            reservation.clientId,
                            participantOptions,
                          )
                        }
                        className="rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-800"
                      >
                        {allSelected ? "全员已选" : "全员"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {participantOptions.map((member) => {
                        const selected = selectedParticipantKeys.has(member.key);
                        return (
                          <button
                            key={member.key}
                            type="button"
                            onClick={() => {
                              const nextSelected = selected
                                ? selectedParticipants.filter(
                                    (item) => item.key !== member.key,
                                  )
                                : [...selectedParticipants, member];
                              updateReservationParticipants(
                                reservation.clientId,
                                nextSelected,
                              );
                            }}
                            className={`rounded-full px-3 py-2 text-xs font-black transition ${
                              selected
                                ? "bg-emerald-700 text-white shadow-sm"
                                : "bg-white text-stone-700"
                            }`}
                          >
                            {member.name}
                          </button>
                        );
                      })}
                    </div>
                    {reservation.unmatched_participant_names.length > 0 ? (
                      <p className="text-xs text-amber-800">
                        未匹配到旅程成员：
                        {reservation.unmatched_participant_names.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  {reservation.source_excerpt ? (
                    <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
                      来源文本：{reservation.source_excerpt}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => void saveOneDraft(item)}
                    disabled={savingDraftId === reservation.clientId}
                    className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {savingDraftId === reservation.clientId
                      ? "正在保存..."
                      : reservationCopy.saveLabel}
                  </button>
                </article>
              );
            }

            const expense = expenseDrafts.find(
              (value) => value.clientId === item.clientId,
            );
            if (!expense) return null;
            const linkedReservation = findLinkedReservation(expense, [
              ...existingReservations,
              ...reservationDrafts.map((reservation) => ({
                id: reservation.clientId,
                tripId,
                tripDayId: null,
                reservationType: reservation.reservation_type,
                title: reservation.title,
                provider: null,
                locationName: reservation.location_name,
                startsAt: reservation.starts_at,
                endsAt: reservation.ends_at,
                confirmationCode: null,
                url: null,
                sourceText: reservation.source_excerpt,
                confidence: reservation.confidence,
                needsReview: reservation.needs_review,
                status: "planned",
                participants: [],
                createdBy: null,
                createdAt: "",
                updatedAt: "",
              } satisfies ItineraryReservation)),
            ]);
            const linkLabels = reservationLinkLabels(expense);
            const linkStartDate = expense.linked_stay_start_date ?? expense.start_date;
            const linkEndDate = expense.linked_stay_end_date ?? expense.end_date;

            return (
              <article
                key={`${item.kind}-${item.clientId}`}
                className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="mb-3 text-sm font-bold text-emerald-700">
                      账本草稿
                      {expense.expense_date ? ` · ${expense.expense_date}` : ""}
                    </p>
                    <input
                      value={expense.title}
                      onChange={(event) =>
                        updateExpenseDraft(expense.clientId, {
                          title: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-lg font-semibold text-stone-950"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDraft("expense", expense.clientId)}
                    className="shrink-0 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700"
                  >
                    删除
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <select
                    value={expense.category}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        category: event.target.value as LedgerCategory,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  >
                    {ledgerCategories.map((category) => (
                      <option key={category} value={category}>
                        {ledgerCategoryLabels[category]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={expense.original_amount ?? ""}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        original_amount: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    placeholder="金额"
                  />
                  <input
                    value={expense.original_currency}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        original_currency: event.target.value.toUpperCase(),
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    placeholder="币种"
                  />
                  <input
                    type="date"
                    value={expense.expense_date ?? ""}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        expense_date: event.target.value || null,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  />
                  <input
                    type="date"
                    value={expense.start_date ?? ""}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        start_date: event.target.value || null,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  />
                  <input
                    type="date"
                    value={expense.end_date ?? ""}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        end_date: event.target.value || null,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  />
                  <select
                    value={expense.accounting_mode}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        accounting_mode: event.target.value as LedgerAccountingMode,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  >
                    {(["shared", "stats_only"] as LedgerAccountingMode[]).map(
                      (mode) => (
                        <option key={mode} value={mode}>
                          {accountingModeLabels[mode]}
                        </option>
                      ),
                    )}
                  </select>
                  <select
                    value={expense.payer_member_id ?? ""}
                    onChange={(event) => {
                      const payer = journeyMembers.find(
                        (member) => member.id === event.target.value,
                      );
                      updateExpenseDraft(expense.clientId, {
                        payer_member_id: payer?.id ?? null,
                        payer_name: payer?.displayName ?? null,
                      });
                    }}
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  >
                    <option value="">选择付款人</option>
                    {journeyMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                  <input
                    value={expense.address_text ?? ""}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        address_text: event.target.value || null,
                      })
                    }
                    placeholder="地址 / 地点"
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  />
                </div>

                {expense.accounting_mode === "shared" ? (
                  <div className="space-y-3 rounded-2xl bg-emerald-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-emerald-900">分摊成员</p>
                      <button
                        type="button"
                        onClick={() =>
                          updateExpenseDraft(expense.clientId, {
                            participant_names: journeyMembers.map(
                              (member) => member.displayName,
                            ),
                            participant_member_ids: journeyMembers.map(
                              (member) => member.id,
                            ),
                            unmatched_participant_names: [],
                          })
                        }
                        className="rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-800"
                      >
                        全员分摊
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {journeyMembers.map((member) => {
                        const selected = expense.participant_member_ids.includes(
                          member.id,
                        );
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => {
                              const nextIds = selected
                                ? expense.participant_member_ids.filter(
                                    (memberId) => memberId !== member.id,
                                  )
                                : [...expense.participant_member_ids, member.id];
                              const selectedNames = journeyMembers
                                .filter((memberItem) =>
                                  nextIds.includes(memberItem.id),
                                )
                                .map((memberItem) => memberItem.displayName);
                              updateExpenseDraft(expense.clientId, {
                                participant_member_ids: [...new Set(nextIds)],
                                participant_names: selectedNames,
                              });
                            }}
                            className={`rounded-full px-3 py-2 text-xs font-black transition ${
                              selected
                                ? "bg-emerald-700 text-white shadow-sm"
                                : "bg-white text-stone-700"
                            }`}
                          >
                            {member.displayName}
                          </button>
                        );
                      })}
                    </div>
                    {expense.unmatched_participant_names.length > 0 ? (
                      <p className="text-xs text-amber-800">
                        未匹配到旅程成员：
                        {expense.unmatched_participant_names.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <textarea
                  value={expense.source_excerpt ?? ""}
                  onChange={(event) =>
                    updateExpenseDraft(expense.clientId, {
                      source_excerpt: event.target.value || null,
                    })
                  }
                  placeholder="说明 / 来源文本"
                  rows={3}
                  className="w-full resize-y rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />

                <div className="rounded-xl bg-stone-50 p-3 text-sm leading-6 text-stone-700">
                  <p>
                    {linkLabels.label}：
                    <span className="font-bold text-emerald-800">
                      {linkedReservation ? linkedReservation.title : linkLabels.missing}
                    </span>
                  </p>
                  {linkStartDate || linkEndDate ? (
                    <p>
                      {linkLabels.range}：{linkStartDate ?? "?"} →{" "}
                      {linkEndDate ?? "?"}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => void saveOneDraft(item)}
                  disabled={savingDraftId === expense.clientId}
                  className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
                >
                  {savingDraftId === expense.clientId ? "正在保存..." : "保存这笔账本"}
                </button>
              </article>
            );
          })}
        </section>
      ) : null}

      {false && drafts.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-700">行程草稿</p>
              <h2 className="text-2xl font-semibold text-stone-950">
                {drafts.length} 个行程草稿
              </h2>
            </div>
          </div>

          {drafts.map((draft) => {
            const hasCritical = draft.warnings.some(
              (warning) => warning.severity === "critical",
            );

            return (
              <article
                key={draft.clientId}
                className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {draft.day_date || draft.day_title ? (
                      <p className="mb-3 text-sm font-bold text-emerald-700">
                        {draft.day_date ?? "未安排日期"}
                        {draft.day_title ? ` · ${draft.day_title}` : ""}
                      </p>
                    ) : null}
                    <input
                      value={draft.title}
                      onChange={(event) =>
                        updateDraft(draft.clientId, { title: event.target.value })
                      }
                      className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-lg font-semibold text-stone-950"
                    />
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <select
                        value={draft.event_type}
                        onChange={(event) =>
                          updateDraft(draft.clientId, {
                            event_type: event.target.value as ItineraryEventType,
                          })
                        }
                        className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      >
                        {eventTypes.map((type) => (
                          <option key={type} value={type}>
                            {eventTypeLabels[type]}
                          </option>
                        ))}
                      </select>
                      <input
                        value={draft.location_name ?? ""}
                        onChange={(event) =>
                          updateDraft(draft.clientId, {
                            location_name: event.target.value || null,
                          })
                        }
                        placeholder="地点"
                        className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                      <input
                        type="datetime-local"
                        value={toInputDateTime(draft.planned_start)}
                        onChange={(event) =>
                          updateDraft(draft.clientId, {
                            planned_start: event.target.value || null,
                          })
                        }
                        className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                      <input
                        type="datetime-local"
                        value={toInputDateTime(draft.planned_end)}
                        onChange={(event) =>
                          updateDraft(draft.clientId, {
                            planned_end: event.target.value || null,
                          })
                        }
                        className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((current) =>
                        current.filter((item) => item.clientId !== draft.clientId),
                      )
                    }
                  className="shrink-0 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700"
                >
                    删除
                </button>
                </div>

                <textarea
                  value={draft.description ?? ""}
                  onChange={(event) =>
                    updateDraft(draft.clientId, {
                      description: event.target.value || null,
                    })
                  }
                  placeholder="说明"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label className="text-sm font-bold text-stone-800">
                      参与人
                    </label>
                    <select
                      value={draft.participantMode}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          participantMode: event.target
                            .value as ParsedItineraryDraft["participantMode"],
                        })
                      }
                      className="mt-2 w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    >
                      <option value="everyone">所有人</option>
                      <option value="only_me">只有我</option>
                      <option value="detected">识别到的参与人</option>
                      <option value="custom">自定义</option>
                    </select>
                    {draft.participant_names.length > 0 ? (
                      <p className="mt-2 text-xs text-stone-500">
                        识别到：{draft.participant_names.join(", ")}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-stone-500">
                        没有识别到参与人。默认按所有人可见处理。
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    置信度：{" "}
                    <span className="font-bold">
                      {draft.confidence === null
                        ? "未知"
                        : `${Math.round(draft.confidence * 100)}%`}
                    </span>
                  </div>
                </div>

                {draft.day_notes ? (
                  <p className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
                    当日备注：{draft.day_notes}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 text-xs font-bold text-stone-600">
                  {draft.is_estimated_time ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                      时间为估算
                    </span>
                  ) : null}
                  {draft.date_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      日期 {Math.round(draft.date_confidence * 100)}%
                    </span>
                  ) : null}
                  {draft.time_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      时间 {Math.round(draft.time_confidence * 100)}%
                    </span>
                  ) : null}
                  {draft.participants_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      人员 {Math.round(draft.participants_confidence * 100)}%
                    </span>
                  ) : null}
                  {draft.location_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      地点 {Math.round(draft.location_confidence * 100)}%
                    </span>
                  ) : null}
                </div>

                {draft.participantMode === "custom" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {members.map((member) => (
                      <label
                        key={member.userId}
                        className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-800"
                      >
                        <input
                          type="checkbox"
                          checked={draft.matched_participant_user_ids.includes(
                            member.userId,
                          )}
                          onChange={(event) => {
                            const nextIds = event.target.checked
                              ? [
                                  ...draft.matched_participant_user_ids,
                                  member.userId,
                                ]
                              : draft.matched_participant_user_ids.filter(
                                  (userId) => userId !== member.userId,
                                );
                            updateDraft(draft.clientId, {
                              matched_participant_user_ids: [...new Set(nextIds)],
                            });
                          }}
                        />
                        {member.name}
                      </label>
                    ))}
                  </div>
                ) : null}

                {draft.source_excerpt ? (
                  <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
                    来源文本：{draft.source_excerpt}
                  </p>
                ) : null}

                {draft.planned_start ? (
                  <p className="text-sm font-medium text-stone-600">
                    开始：{formatDateTime(draft.planned_start)}
                  </p>
                ) : null}

                {draft.warnings.length > 0 ? (
                  <div className="space-y-2">
                    {draft.warnings.map((warning, index) => (
                      <p
                        key={`${warning.type}-${index}`}
                        className={`rounded-xl border px-3 py-2 text-sm font-medium ${warningClass(warning.severity)}`}
                      >
                        {warning.message}
                      </p>
                    ))}
                  </div>
                ) : null}

                {hasCritical ? (
                  <label className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
                    <input
                      type="checkbox"
                      checked={draft.importAnyway}
                      onChange={(event) =>
                        updateDraft(draft.clientId, {
                          importAnyway: event.target.checked,
                        })
                      }
                    />
                    仍然导入
                  </label>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {false && reservationDrafts.length > 0 ? (
        <section className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">预订草稿</p>
            <h2 className="text-2xl font-semibold text-stone-950">
              {reservationDrafts.length} 个预订草稿
            </h2>
          </div>
          {reservationDrafts.map((reservation) => (
            <article
              key={reservation.clientId}
              className="space-y-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="mb-3 text-sm font-bold text-emerald-700">
                    {reservation.day_date ?? "未安排日期"} · 预订
                  </p>
                  <input
                    value={reservation.title}
                    onChange={(event) =>
                      updateReservationDraft(reservation.clientId, {
                        title: event.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-lg font-semibold text-stone-950"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setReservationDrafts((current) =>
                      current.filter((item) => item.clientId !== reservation.clientId),
                    )
                  }
                  className="shrink-0 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700"
                >
                  删除
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={reservation.reservation_type}
                  onChange={(event) =>
                    updateReservationDraft(reservation.clientId, {
                      reservation_type: event.target.value as ItineraryReservationType,
                    })
                  }
                  className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                >
                  {reservationTypes.map((type) => (
                    <option key={type} value={type}>
                      {reservationTypeLabels[type]}
                    </option>
                  ))}
                </select>
                <input
                  value={reservation.location_name ?? ""}
                  onChange={(event) =>
                    updateReservationDraft(reservation.clientId, {
                      location_name: event.target.value || null,
                    })
                  }
                  placeholder="地点"
                  className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />
                <input
                  type="datetime-local"
                  value={toInputDateTime(reservation.starts_at)}
                  onChange={(event) =>
                    updateReservationDraft(reservation.clientId, {
                      day_date: event.target.value
                        ? event.target.value.slice(0, 10)
                        : reservation.day_date,
                      starts_at: event.target.value || null,
                    })
                  }
                  className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />
                <input
                  type="datetime-local"
                  value={toInputDateTime(reservation.ends_at)}
                  onChange={(event) =>
                    updateReservationDraft(reservation.clientId, {
                      ends_at: event.target.value || null,
                    })
                  }
                  className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />
              </div>
              {reservation.starts_at || reservation.ends_at ? (
                <p className="text-sm font-medium text-stone-600">
                  {reservation.starts_at
                    ? `开始：${formatDateTime(reservation.starts_at)}`
                    : "缺少开始时间"}
                  {reservation.ends_at
                    ? ` · 结束：${formatDateTime(reservation.ends_at)}`
                    : " · 缺少结束时间"}
                </p>
              ) : null}
              {reservation.participant_names.length > 0 ? (
                <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                  <p className="font-bold">入住人</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reservation.participant_names.map((name) => (
                      <span
                        key={name}
                        className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                  {reservation.unmatched_participant_names.length > 0 ? (
                    <p className="mt-2 text-xs text-amber-800">
                      未匹配到旅程成员：{reservation.unmatched_participant_names.join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {reservation.source_excerpt ? (
                <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
                  来源文本：{reservation.source_excerpt}
                </p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {false && expenseDrafts.length > 0 ? (
        <section className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">账本草稿</p>
            <h2 className="text-2xl font-semibold text-stone-950">
              {expenseDrafts.length} 笔账本草稿
            </h2>
          </div>
          {expenseDrafts.map((expense) => {
            const linkedReservation = findLinkedReservation(expense, [
              ...existingReservations,
              ...reservationDrafts.map((reservation) => ({
                id: reservation.clientId,
                tripId,
                tripDayId: null,
                reservationType: reservation.reservation_type,
                title: reservation.title,
                provider: null,
                locationName: reservation.location_name,
                startsAt: reservation.starts_at,
                endsAt: reservation.ends_at,
                confirmationCode: null,
                url: null,
                sourceText: reservation.source_excerpt,
                confidence: reservation.confidence,
                needsReview: reservation.needs_review,
                status: "planned",
                participants: [],
                createdBy: null,
                createdAt: "",
                updatedAt: "",
              } satisfies ItineraryReservation)),
            ]);
            const linkLabels = reservationLinkLabels(expense);
            const linkStartDate = expense.linked_stay_start_date ?? expense.start_date;
            const linkEndDate = expense.linked_stay_end_date ?? expense.end_date;

            return (
              <article
                key={expense.clientId}
                className="space-y-3 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="mb-3 text-sm font-bold text-emerald-700">
                      {expense.expense_date ?? "未安排日期"} · 账本
                    </p>
                    <input
                      value={expense.title}
                      onChange={(event) =>
                        updateExpenseDraft(expense.clientId, {
                          title: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-lg font-semibold text-stone-950"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setExpenseDrafts((current) =>
                        current.filter((item) => item.clientId !== expense.clientId),
                      )
                    }
                    className="shrink-0 rounded-xl bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700"
                  >
                    删除
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <input
                    type="number"
                    value={expense.original_amount ?? ""}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        original_amount: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    placeholder="金额"
                  />
                  <input
                    value={expense.original_currency}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        original_currency: event.target.value.toUpperCase(),
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                    placeholder="币种"
                  />
                  <input
                    type="date"
                    value={expense.expense_date ?? ""}
                    onChange={(event) =>
                      updateExpenseDraft(expense.clientId, {
                        expense_date: event.target.value || null,
                      })
                    }
                    className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                  />
                </div>

                <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                  <p className="font-bold">付款与分摊</p>
                  <p className="mt-1">
                    付款人：{expense.payer_name ?? "未识别"}
                    {expense.payer_member_id ? "" : "（未匹配）"}
                  </p>
                  <p className="mt-1">
                    分摊：{expense.participant_names.join(", ") || "未识别"}
                  </p>
                  {expense.unmatched_participant_names.length > 0 ? (
                    <p className="mt-2 text-xs text-amber-800">
                      未匹配到旅程成员：{expense.unmatched_participant_names.join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-xl bg-stone-50 p-3 text-sm leading-6 text-stone-700">
                  <p>
                    {linkLabels.label}：
                    <span className="font-bold text-emerald-800">
                      {linkedReservation
                        ? linkedReservation.title
                        : linkLabels.missing}
                    </span>
                  </p>
                  {linkStartDate || linkEndDate ? (
                    <p>
                      {linkLabels.range}：{linkStartDate ?? "?"} → {linkEndDate ?? "?"}
                    </p>
                  ) : null}
                  {expense.address_text ? <p>地址：{expense.address_text}</p> : null}
                </div>

                {expense.source_excerpt ? (
                  <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
                    来源文本：{expense.source_excerpt}
                  </p>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {hasDrafts ? (
        <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">准备导入</p>
          <h2 className="mt-1 text-xl font-black text-emerald-950">
            是否确认导入这 {draftCount} 条草稿？
          </h2>
          <p className="mt-2 text-sm text-emerald-900">
            包含 {drafts.length} 个行程、{reservationDrafts.length} 个预订、{expenseDrafts.length} 笔账本。确认后会写入 Journey。
          </p>
          <button
            type="button"
            onClick={importDrafts}
            disabled={isImporting}
            className="mt-4 w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
          >
            {isImporting ? "正在导入..." : `确认导入这 ${draftCount} 条`}
          </button>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => router.push(`/trips/${tripId}/planner`)}
        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700 shadow-sm"
      >
        取消导入，返回行程页面
      </button>

      {message ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function PlannerImportPage() {
  return (
    <AuthGate>
      {(user) => <PlannerImportContent currentUserId={user.id} />}
    </AuthGate>
  );
}
