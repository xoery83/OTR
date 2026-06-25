import type {
  ItineraryEvent,
  ItineraryEventType,
  ItineraryReservationType,
  TripMember,
} from "@/types";

export type PlannerImportWarningType =
  | "time_overlap"
  | "participant_conflict"
  | "duplicate"
  | "missing_info"
  | "timezone_uncertain";

export type PlannerImportWarningSeverity = "info" | "warning" | "critical";

export type PlannerImportWarning = {
  type: PlannerImportWarningType;
  severity: PlannerImportWarningSeverity;
  message: string;
  conflicting_event_id: string | null;
  conflicting_event_title: string | null;
};

export type ParsedItineraryDraft = {
  clientId: string;
  day_date: string | null;
  day_title: string | null;
  day_notes: string | null;
  title: string;
  description: string | null;
  event_type: ItineraryEventType;
  location_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  participant_names: string[];
  matched_participant_user_ids: string[];
  unmatched_participant_names: string[];
  confidence: number | null;
  date_confidence: number | null;
  time_confidence: number | null;
  participants_confidence: number | null;
  location_confidence: number | null;
  is_estimated_time: boolean;
  needs_review: boolean;
  source_excerpt: string | null;
  warnings: PlannerImportWarning[];
  importAnyway: boolean;
  participantMode: "detected" | "everyone" | "only_me" | "custom";
};

export type ParsedReservationDraft = {
  clientId: string;
  reservation_type: ItineraryReservationType;
  title: string;
  day_date: string | null;
  location_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  source_excerpt: string | null;
  confidence: number | null;
  needs_review: boolean;
};

export type ParsedItineraryResponse = {
  events: ParsedItineraryDraft[];
  reservations: ParsedReservationDraft[];
  warnings: string[];
};

type AiDraftEvent = {
  day_date?: string | null;
  day_title?: string | null;
  day_notes?: string | null;
  title?: string | null;
  description?: string | null;
  event_type?: ItineraryEventType | null;
  location_name?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  participant_names?: string[] | null;
  confidence?: number | null;
  date_confidence?: number | null;
  time_confidence?: number | null;
  participants_confidence?: number | null;
  location_confidence?: number | null;
  is_estimated_time?: boolean | null;
  needs_review?: boolean | null;
  source_excerpt?: string | null;
};

export type AiItineraryResponse = {
  events?: AiDraftEvent[] | null;
  days?: {
    date?: string | null;
    title?: string | null;
    notes?: string | null;
  }[] | null;
  reservations?: {
    reservation_type?: string | null;
    title?: string | null;
    day_date?: string | null;
    location_name?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    source_excerpt?: string | null;
    confidence?: number | null;
    needs_review?: boolean | null;
  }[] | null;
  warnings?: string[] | null;
};

const validReservationTypes: ItineraryReservationType[] = [
  "flight",
  "hotel",
  "car",
  "ferry",
  "tour",
  "restaurant",
  "other",
];

const validEventTypes: ItineraryEventType[] = [
  "flight",
  "hotel",
  "car",
  "activity",
  "meal",
  "transport",
  "note",
  "other",
];

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildMemberLookup(members: TripMember[]) {
  return new Map(members.map((member) => [normalizeName(member.name), member]));
}

export function toPlannerDrafts(
  aiResponse: AiItineraryResponse,
  members: TripMember[],
): ParsedItineraryResponse {
  const memberLookup = buildMemberLookup(members);

  return {
    events: (aiResponse.events ?? []).map((event, index) => {
      const participantNames = (event.participant_names ?? [])
        .map((name) => name.trim())
        .filter(Boolean);
      const matched = participantNames
        .map((name) => memberLookup.get(normalizeName(name))?.userId)
        .filter((userId): userId is string => Boolean(userId));
      const unmatched = participantNames.filter(
        (name) => !memberLookup.has(normalizeName(name)),
      );
      const eventType = validEventTypes.includes(event.event_type ?? "other")
        ? (event.event_type ?? "other")
        : "other";

      return {
        clientId: crypto.randomUUID(),
        day_date: event.day_date || null,
        day_title: event.day_title?.trim() || null,
        day_notes: event.day_notes?.trim() || null,
        title: event.title?.trim() || `Imported event ${index + 1}`,
        description: event.description?.trim() || null,
        event_type: eventType,
        location_name: event.location_name?.trim() || null,
        planned_start: event.planned_start || null,
        planned_end: event.planned_end || null,
        participant_names: participantNames,
        matched_participant_user_ids: [...new Set(matched)],
        unmatched_participant_names: unmatched,
        confidence: event.confidence ?? null,
        date_confidence: event.date_confidence ?? null,
        time_confidence: event.time_confidence ?? null,
        participants_confidence: event.participants_confidence ?? null,
        location_confidence: event.location_confidence ?? null,
        is_estimated_time: event.is_estimated_time ?? false,
        needs_review: event.needs_review ?? true,
        source_excerpt: event.source_excerpt?.trim() || null,
        warnings: [],
        importAnyway: false,
        participantMode: matched.length > 0 ? "detected" : "everyone",
      };
    }),
    reservations: (aiResponse.reservations ?? []).map((reservation, index) => {
      const reservationType = validReservationTypes.includes(
        reservation.reservation_type as ItineraryReservationType,
      )
        ? (reservation.reservation_type as ItineraryReservationType)
        : "other";

      return {
        clientId: crypto.randomUUID(),
        reservation_type: reservationType,
        title: reservation.title?.trim() || `Imported reservation ${index + 1}`,
        day_date: reservation.day_date || null,
        location_name: reservation.location_name?.trim() || null,
        starts_at: reservation.starts_at || null,
        ends_at: reservation.ends_at || null,
        source_excerpt: reservation.source_excerpt?.trim() || null,
        confidence: reservation.confidence ?? null,
        needs_review: reservation.needs_review ?? true,
      };
    }),
    warnings: aiResponse.warnings ?? [],
  };
}

function parseTime(value: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function getEndTime(start: number | null, end: number | null) {
  if (!start) return null;
  if (end && end > start) return end;
  return start + 60 * 60 * 1000;
}

function overlaps(
  firstStartValue: string | null,
  firstEndValue: string | null,
  secondStartValue: string | null,
  secondEndValue: string | null,
) {
  const firstStart = parseTime(firstStartValue);
  const secondStart = parseTime(secondStartValue);
  if (!firstStart || !secondStart) return false;

  const firstEnd = getEndTime(firstStart, parseTime(firstEndValue));
  const secondEnd = getEndTime(secondStart, parseTime(secondEndValue));
  if (!firstEnd || !secondEnd) return false;

  return firstStart < secondEnd && secondStart < firstEnd;
}

function sameDate(first: string | null, second: string | null) {
  return Boolean(first && second && first.slice(0, 10) === second.slice(0, 10));
}

function similarText(first: string | null, second: string | null) {
  if (!first || !second) return false;
  const a = normalizeName(first);
  const b = normalizeName(second);
  return a.includes(b) || b.includes(a);
}

function withinMinutes(first: string | null, second: string | null, minutes: number) {
  const firstTime = parseTime(first);
  const secondTime = parseTime(second);
  if (!firstTime || !secondTime) return false;
  return Math.abs(firstTime - secondTime) <= minutes * 60 * 1000;
}

export function addConflictWarnings(
  drafts: ParsedItineraryDraft[],
  existingEvents: ItineraryEvent[],
) {
  return drafts.map((draft) => {
    const warnings: PlannerImportWarning[] = [...draft.warnings];

    if (!draft.planned_start) {
      warnings.push({
        type: "missing_info",
        severity: "warning",
        message: "Date or start time is missing.",
        conflicting_event_id: null,
        conflicting_event_title: null,
      });
    }

    if (draft.unmatched_participant_names.length > 0) {
      warnings.push({
        type: "missing_info",
        severity: "warning",
        message: `Unknown participant: ${draft.unmatched_participant_names.join(", ")}.`,
        conflicting_event_id: null,
        conflicting_event_title: null,
      });
    }

    if (draft.participant_names.length === 0) {
      warnings.push({
        type: "missing_info",
        severity: "info",
        message: "No participants detected. Review the participant option before importing.",
        conflicting_event_id: null,
        conflicting_event_title: null,
      });
    }

    if (draft.planned_start && !/[zZ]|[+-]\d{2}:\d{2}$/.test(draft.planned_start)) {
      warnings.push({
        type: "timezone_uncertain",
        severity: "info",
        message: "Timezone was not explicit in the parsed start time.",
        conflicting_event_id: null,
        conflicting_event_title: null,
      });
    }

    existingEvents.forEach((existing) => {
      const hasOverlap = overlaps(
        draft.planned_start,
        draft.planned_end,
        existing.plannedStart,
        existing.plannedEnd,
      );
      const sharedParticipants = existing.participants
        .map((participant) => participant.userId)
        .filter((userId) => draft.matched_participant_user_ids.includes(userId));

      if (hasOverlap && sharedParticipants.length > 0) {
        warnings.push({
          type: "participant_conflict",
          severity: "critical",
          message: `Participant conflict with ${existing.title}.`,
          conflicting_event_id: existing.id,
          conflicting_event_title: existing.title,
        });
      } else if (hasOverlap) {
        warnings.push({
          type: "time_overlap",
          severity: "warning",
          message: `Time overlaps with ${existing.title}.`,
          conflicting_event_id: existing.id,
          conflicting_event_title: existing.title,
        });
      }

      if (
        sameDate(draft.planned_start, existing.plannedStart) &&
        withinMinutes(draft.planned_start, existing.plannedStart, 60) &&
        (similarText(draft.title, existing.title) ||
          similarText(draft.location_name, existing.locationName))
      ) {
        warnings.push({
          type: "duplicate",
          severity: "warning",
          message: `Possible duplicate of ${existing.title}.`,
          conflicting_event_id: existing.id,
          conflicting_event_title: existing.title,
        });
      }

      if (
        existing.eventType === "flight" &&
        draft.planned_start &&
        existing.plannedEnd &&
        parseTime(existing.plannedEnd)! > parseTime(draft.planned_start)! &&
        ["hotel", "car", "activity", "meal", "transport"].includes(draft.event_type)
      ) {
        warnings.push({
          type: "time_overlap",
          severity: "warning",
          message: `${draft.event_type} starts before ${existing.title} ends.`,
          conflicting_event_id: existing.id,
          conflicting_event_title: existing.title,
        });
      }
    });

    return { ...draft, warnings };
  });
}
