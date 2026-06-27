"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { getApproxExchangeRate } from "@/lib/exchange-rates";
import { formatDateTime, toDateTimeLocalValue } from "@/lib/format";
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
import { getTripMembers } from "@/lib/supabase/members";
import { upsertTripDay } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import { supabase } from "@/lib/supabase/client";
import type {
  ItineraryEvent,
  ItineraryEventType,
  ItineraryReservation,
  ItineraryReservationType,
  JourneyMember,
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

function toInputDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toDateTimeLocalValue(date);
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
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function addDateDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function stayTextMatches(expense: ParsedExpenseDraft, reservation: ItineraryReservation) {
  return (
    textIncludesEither(expense.linked_stay_title, reservation.title) ||
    textIncludesEither(expense.linked_stay_location, reservation.locationName) ||
    textIncludesEither(expense.address_text, reservation.locationName) ||
    textIncludesEither(expense.source_excerpt, reservation.title) ||
    textIncludesEither(expense.source_excerpt, reservation.locationName)
  );
}

function findLinkedStayReservation(
  expense: ParsedExpenseDraft,
  reservations: ItineraryReservation[],
) {
  const startDate = expense.linked_stay_start_date ?? expense.start_date;
  const endDate = expense.linked_stay_end_date ?? expense.end_date;
  const hotels = reservations.filter((reservation) => reservation.reservationType === "hotel");

  return (
    hotels.find((reservation) => {
      const reservationStart = dateValue(reservation.startsAt);
      const reservationEnd = dateValue(reservation.endsAt);
      const dateMatches =
        (!startDate || reservationStart === startDate) &&
        (!endDate || reservationEnd === endDate);
      if (!dateMatches) return false;

      return stayTextMatches(expense, reservation);
    }) ??
    hotels.find((reservation) => stayTextMatches(expense, reservation)) ??
    hotels.find((reservation) => {
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
  const [lastParsedResult, setLastParsedResult] = useState<AiItineraryResponse | null>(
    null,
  );
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const canImport =
    currentMember?.role === "owner" ||
    currentMember?.role === "admin" ||
    trip?.createdBy === currentUserId;
  const hasDrafts =
    drafts.length > 0 || reservationDrafts.length > 0 || expenseDrafts.length > 0;

  function recomputeWarnings(nextDrafts: ParsedItineraryDraft[]) {
    return addConflictWarnings(
      nextDrafts.map((draft) => ({ ...draft, warnings: [] })),
      existingEvents,
    );
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
      const parsed = toPlannerDrafts(body.parsed, members, journeyMembers);
      setAiWarnings([
        ...parsed.warnings,
        ...getReservationValidationNotes(parsed.reservations),
      ]);
      const nextDrafts = addConflictWarnings(parsed.events, existingEvents);
      setDrafts(nextDrafts);
      setReservationDrafts(parsed.reservations);
      setExpenseDrafts(parsed.expenses);
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
                  : members.map((member) => member.userId),
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
          const linkedReservation = findLinkedStayReservation(
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
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name || "旅程"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          导入行程
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          粘贴航班、酒店、租车、聊天记录或粗略计划。系统会先解析成草稿，你确认后才写入行程。
        </p>
      </section>

      {!canImport ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          只有旅程所有者和管理员可以导入行程。
        </p>
      ) : null}

      <form
        onSubmit={parseWithAi}
        className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-xl font-semibold text-stone-950">粘贴行程文本</h2>
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
      </form>

      {hasDrafts ? (
        <section className="flex flex-col gap-3 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-800">已生成草稿</p>
            <p className="text-sm text-emerald-900">
              {drafts.length} 个行程、{reservationDrafts.length} 个预订、{expenseDrafts.length} 笔账本可以导入。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={openParserUpgrade}
              className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm"
            >
              导入结果不对？升级解析器
            </button>
            <button
              type="button"
              onClick={importDrafts}
              disabled={isImporting}
              className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isImporting ? "正在导入..." : "确认导入"}
            </button>
          </div>
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

      {drafts.length > 0 ? (
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
                            planned_start: event.target.value
                              ? new Date(event.target.value).toISOString()
                              : null,
                          })
                        }
                        className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                      />
                      <input
                        type="datetime-local"
                        value={toInputDateTime(draft.planned_end)}
                        onChange={(event) =>
                          updateDraft(draft.clientId, {
                            planned_end: event.target.value
                              ? new Date(event.target.value).toISOString()
                              : null,
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

      {reservationDrafts.length > 0 ? (
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
                      starts_at: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    })
                  }
                  className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />
                <input
                  type="datetime-local"
                  value={toInputDateTime(reservation.ends_at)}
                  onChange={(event) =>
                    updateReservationDraft(reservation.clientId, {
                      ends_at: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
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

      {expenseDrafts.length > 0 ? (
        <section className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">账本草稿</p>
            <h2 className="text-2xl font-semibold text-stone-950">
              {expenseDrafts.length} 笔账本草稿
            </h2>
          </div>
          {expenseDrafts.map((expense) => {
            const linkedReservation = findLinkedStayReservation(expense, [
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
                    关联住宿：
                    <span className="font-bold text-emerald-800">
                      {linkedReservation
                        ? linkedReservation.title
                        : "未找到匹配住宿，导入后不会挂到住宿卡片"}
                    </span>
                  </p>
                  {expense.linked_stay_start_date || expense.linked_stay_end_date ? (
                    <p>
                      住宿范围：{expense.linked_stay_start_date ?? "?"} →{" "}
                      {expense.linked_stay_end_date ?? "?"}
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
