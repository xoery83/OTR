import { getDefaultCapturedAt } from "@/lib/format";
import { getApproxExchangeRate } from "@/lib/exchange-rates";
import type { CompressedImage } from "@/lib/images";
import { createRawCaptureEvent } from "@/lib/supabase/capture-events";
import {
  createItineraryEvent,
  createItineraryReservation,
} from "@/lib/supabase/itinerary";
import { createLedgerEntry, getLedgerData } from "@/lib/supabase/ledger";
import {
  createPhotoMemory,
  createTextMemory,
} from "@/lib/supabase/memories";
import type { LedgerCategory } from "@/types";
import type {
  CaptureActionGraphNode,
  CaptureEngineOptions,
  CaptureIntentDetection,
} from "./types";

export type ExecuteCaptureActionInput = {
  tripId: string;
  text: string;
  intent: CaptureIntentDetection | null;
  compressedImage?: CompressedImage | null;
  originalPhotoFile?: File | null;
  photoFileName?: string;
  engineOptions?: CaptureEngineOptions;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nodeDetail(node: CaptureActionGraphNode, label: string) {
  return node.details.find((detail) => detail.label === label)?.value ?? "";
}

function resolveDate(value: unknown, capturedAt: string) {
  const raw = stringValue(value).toLocaleLowerCase();
  const captured = new Date(capturedAt);

  if (!raw || raw === "today" || raw === "tonight" || raw === "今天" || raw === "今晚") {
    return capturedAt.slice(0, 10);
  }
  if (raw === "tomorrow" || raw === "明天") {
    captured.setDate(captured.getDate() + 1);
    return captured.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  return capturedAt.slice(0, 10);
}

function isoAt(date: string, time = "18:00") {
  return `${date}T${time}:00`;
}

function addDays(date: string, days: number, time = "10:00") {
  const result = new Date(`${date}T00:00:00`);
  result.setDate(result.getDate() + days);
  const nextDate = result.toISOString().slice(0, 10);
  return `${nextDate}T${time}:00`;
}

function ledgerCategory(value: unknown): LedgerCategory {
  const category = stringValue(value).toLocaleLowerCase();
  if (category === "accommodation" || category === "lodging") return "hotel";
  if (
    [
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
    ].includes(category)
  ) {
    return category as LedgerCategory;
  }
  return "other";
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function lockedMemoryContext(input: ExecuteCaptureActionInput) {
  const context = input.engineOptions?.lockedContext ?? {};
  const itineraryEventId = stringValue(context.itineraryEventId);
  const itineraryReservationId =
    stringValue(context.itineraryReservationId) ||
    stringValue(context.reservationId);
  const plannerItemId = stringValue(context.plannerItemId);
  const itemType = stringValue(context.itemType);

  return {
    dayDate: stringValue(context.dayDate) || stringValue(context.date) || "",
    tripDayId:
      stringValue(context.tripDayId) ||
      stringValue(context.dayId) ||
      null,
    itineraryEventId:
      itineraryEventId ||
      (!itineraryReservationId && itemType !== "reservation" ? plannerItemId : "") ||
      null,
    itineraryReservationId:
      itineraryReservationId ||
      (!itineraryEventId && itemType === "reservation" ? plannerItemId : "") ||
      null,
    locationName:
      stringValue(context.locationName) ||
      stringValue(context.location) ||
      "",
  };
}

function capturedAtForInput(input: ExecuteCaptureActionInput) {
  const dayDate = lockedMemoryContext(input).dayDate;
  return dayDate && dayDate !== "unscheduled"
    ? getDefaultCapturedAt(dayDate)
    : getDefaultCapturedAt();
}

async function executeActionGraph(input: ExecuteCaptureActionInput, capturedAt: string) {
  const intent = input.intent;
  if (!intent?.actionGraph.nodes.length) return { executed: false };

  const ledgerData = await getLedgerData(input.tripId);
  const baseCurrency = ledgerData.ledger.baseCurrency || "NZD";
  const createdByNode = new Map<
    string,
    { itineraryReservationId?: string; itineraryEventId?: string }
  >();
  const results: string[] = [];

  for (const node of intent.actionGraph.nodes) {
    if (node.intent === "planner_update") {
      const payload = node.payload ?? {};
      const lockedContext = lockedMemoryContext(input);
      const date = resolveDate(payload.date || lockedContext.dayDate, capturedAt);
      const nights = numberValue(payload.nights) ?? 1;
      const startTime = stringValue(payload.time) || "18:00";
      const location =
        stringValue(payload.locationName) ||
        stringValue(payload.location) ||
        stringValue(payload.area) ||
        nodeDetail(node, "地点");
      const sourceTitle = input.text.trim().split(/\n/)[0]?.slice(0, 80);
      const title =
        stringValue(payload.title) ||
        stringValue(payload.name) ||
        (node.type.includes("hotel") || node.type.includes("accommodation")
          ? location
            ? `${location} Hotel`
            : "Hotel stay"
          : sourceTitle || node.title);

      if (node.type.includes("hotel") || node.type.includes("accommodation")) {
        const reservation = await createItineraryReservation({
          tripId: input.tripId,
          tripDayId: lockedContext.tripDayId,
          reservationType: "hotel",
          title,
          provider: stringValue(payload.provider),
          locationName: location,
          startsAt: isoAt(date, startTime),
          endsAt: addDays(date, nights, "10:00"),
          confirmationCode: stringValue(payload.bookingReference),
          url: stringValue(payload.url),
          sourceText: input.text,
          confidence: intent.confidence,
          needsReview: false,
        });
        createdByNode.set(node.id, { itineraryReservationId: reservation.id });
        results.push("planner_reservation");
      } else {
        const event = await createItineraryEvent({
          tripId: input.tripId,
          tripDayId: lockedContext.tripDayId,
          title,
          description: node.summary || input.text,
          eventType: "other",
          locationName: location,
          plannedStart: isoAt(date, "18:00"),
          plannedEnd: "",
          bookingReference: "",
          url: "",
          sourceText: input.text,
          confidence: intent.confidence,
          needsReview: false,
          isEstimatedTime: true,
        });
        createdByNode.set(node.id, { itineraryEventId: event.id });
        results.push("planner_event");
      }
    }
  }

  for (const node of intent.actionGraph.nodes) {
    if (node.intent !== "expense") continue;

    const payload = node.payload ?? {};
    const amount = numberValue(payload.amount);
    if (!amount) continue;

    const currency =
      stringValue(payload.currency).toUpperCase() ||
      stringValue(intent.entities?.currency).toUpperCase() ||
      baseCurrency;
    const category = ledgerCategory(payload.category || node.type);
    const linkedPlannerNode = intent.actionGraph.relations.find(
      (relation) =>
        relation.from === node.id &&
        (relation.type === "belongs_to" || relation.type === "related_to"),
    )?.to;
    const lockedContext = lockedMemoryContext(input);
    const linked = linkedPlannerNode ? createdByNode.get(linkedPlannerNode) : undefined;
    const date = resolveDate(payload.date || lockedContext.dayDate, capturedAt);
    const rate =
      currency === baseCurrency
        ? 1
        : (await getApproxExchangeRate(currency, baseCurrency)).rate;

    await createLedgerEntry({
      journeyId: input.tripId,
      itineraryReservationId:
        linked?.itineraryReservationId ?? lockedContext.itineraryReservationId,
      itineraryEventId: linked?.itineraryEventId ?? lockedContext.itineraryEventId,
      title:
        stringValue(payload.title) ||
        node.title ||
        (category === "hotel" ? "Accommodation expense" : "Capture expense"),
      description: node.summary || input.text,
      category,
      accountingMode:
        stringValue(payload.accountingMode) === "stats_only"
          ? "stats_only"
          : "shared",
      expenseDate: date,
      startDate: date,
      endDate: date,
      originalAmount: amount,
      originalCurrency: currency,
      baseCurrency,
      exchangeRate: rate,
      payerMemberId: stringValue(payload.payerMemberId) || null,
      participantMemberIds: stringArrayValue(payload.participantMemberIds),
      addressText:
        stringValue(payload.locationName) ||
        stringValue(payload.location) ||
        stringValue(payload.area),
    });
    results.push("ledger_entry");
  }

  return { executed: results.length > 0, results };
}

export async function executeCaptureAction(input: ExecuteCaptureActionInput) {
  const capturedAt = capturedAtForInput(input);
  const trimmed = input.text.trim();

  if (input.intent && input.intent.intent !== "memory") {
    await createRawCaptureEvent({
      tripId: input.tripId,
      inputType: input.compressedImage ? "photo" : "text",
      originalInput: trimmed,
      capturedAt,
      metadata: {
        source: "capture_modal",
        intent: input.intent,
        engineOptions: input.engineOptions ?? {},
      },
    });
    const result = await executeActionGraph(input, capturedAt);
    window.dispatchEvent(
      new CustomEvent("otr:capture-intent-confirmed", {
        detail: { intent: input.intent, result },
      }),
    );
    window.dispatchEvent(new CustomEvent("otr:capture-completed"));
    return { executed: result.executed, intent: input.intent.intent };
  }

  const metadata = {
    source: "capture_modal",
    intent: input.intent,
    engineOptions: input.engineOptions ?? {},
  };

  if (trimmed) {
    const memoryContext = lockedMemoryContext(input);
    await createRawCaptureEvent({
      tripId: input.tripId,
      inputType: "text",
      originalInput: trimmed,
      capturedAt,
      metadata,
    });
    await createTextMemory(input.tripId, trimmed, {
      capturedAt,
      locationName: memoryContext.locationName,
      tripDayId: memoryContext.tripDayId,
      itineraryEventId: memoryContext.itineraryEventId,
      itineraryReservationId: memoryContext.itineraryReservationId,
    });
  }

  if (input.compressedImage) {
    const memoryContext = lockedMemoryContext(input);
    await createRawCaptureEvent({
      tripId: input.tripId,
      inputType: "photo",
      originalInput: trimmed,
      capturedAt,
      metadata: {
        ...metadata,
        fileName: input.photoFileName,
        fileSize: input.originalPhotoFile?.size ?? null,
      },
    });
    await createPhotoMemory(
      input.tripId,
      input.compressedImage,
      input.photoFileName || "capture-photo.jpg",
      trimmed,
      {
        capturedAt,
        locationName: memoryContext.locationName,
        tripDayId: memoryContext.tripDayId,
        itineraryEventId: memoryContext.itineraryEventId,
        itineraryReservationId: memoryContext.itineraryReservationId,
      },
      input.originalPhotoFile ?? null,
    );
  }

  window.dispatchEvent(new CustomEvent("otr:capture-completed"));
  return { executed: true, intent: "memory" };
}
