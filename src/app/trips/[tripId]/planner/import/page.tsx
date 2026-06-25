"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { formatDateTime, toDateTimeLocalValue } from "@/lib/format";
import {
  addConflictWarnings,
  type AiItineraryResponse,
  type ParsedItineraryDraft,
  type ParsedReservationDraft,
  toPlannerDrafts,
} from "@/lib/planner-import";
import {
  createItineraryEvent,
  createItineraryReservation,
  getItineraryEvents,
} from "@/lib/supabase/itinerary";
import { getTripMembers } from "@/lib/supabase/members";
import { upsertTripDay } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import { supabase } from "@/lib/supabase/client";
import type {
  ItineraryEvent,
  ItineraryEventType,
  ItineraryReservationType,
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
          `${reservation.title} starts before ${flight.title} appears to finish.`,
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
  const [existingEvents, setExistingEvents] = useState<ItineraryEvent[]>([]);
  const [rawText, setRawText] = useState("");
  const [drafts, setDrafts] = useState<ParsedItineraryDraft[]>([]);
  const [reservationDrafts, setReservationDrafts] = useState<
    ParsedReservationDraft[]
  >([]);
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
        const [tripData, memberData, eventData] = await Promise.all([
          getTrip(tripId),
          getTripMembers(tripId),
          getItineraryEvents(tripId),
        ]);
        if (isMounted) {
          setTrip(tripData);
          setMembers(memberData);
          setExistingEvents(eventData);
        }
      } catch (contextError) {
        if (isMounted) {
          setError(getErrorMessage(contextError, "Could not load planner context."));
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

  async function parseWithAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsParsing(true);

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        throw new Error("You must be logged in.");
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
        throw new Error(body.error || "Could not parse itinerary.");
      }

      const parsed = toPlannerDrafts(body.parsed, members);
      setAiWarnings([
        ...parsed.warnings,
        ...getReservationValidationNotes(parsed.reservations),
      ]);
      setDrafts(addConflictWarnings(parsed.events, existingEvents));
      setReservationDrafts(parsed.reservations);
    } catch (parseError) {
      setError(getErrorMessage(parseError, "Could not parse itinerary."));
    } finally {
      setIsParsing(false);
    }
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

      if (importable.length === 0 && reservationDrafts.length === 0) {
        throw new Error("No drafts can be imported yet. Confirm critical warnings or delete them.");
      }

      const dayInputs = new Map<
        string,
        { title: string | null; notes: string | null }
      >();

      [...reservationDrafts, ...importable].forEach((draft) => {
        if (!draft.day_date) return;
        const existing = dayInputs.get(draft.day_date);
        dayInputs.set(draft.day_date, {
          title:
            "day_title" in draft
              ? draft.day_title || existing?.title || null
              : existing?.title || null,
          notes:
            "day_notes" in draft
              ? draft.day_notes || existing?.notes || null
              : existing?.notes || null,
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

      await Promise.all(
        [
          ...reservationDrafts.map((reservation) =>
            createItineraryReservation({
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
              participantUserIds: members.map((member) => member.userId),
            }),
          ),
          ...importable.map((draft) =>
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
        ],
      );

      setMessage(
        skipped > 0
          ? `Imported ${importable.length} events and ${reservationDrafts.length} reservations. Skipped ${skipped} events with unconfirmed critical warnings.`
          : `Imported ${importable.length} events and ${reservationDrafts.length} reservations.`,
      );
      setTimeout(() => router.push(`/trips/${tripId}/planner`), 900);
    } catch (importError) {
      setError(getErrorMessage(importError, "Could not import planner drafts."));
    } finally {
      setIsImporting(false);
    }
  }

  if (isLoading) {
    return <div className="rounded-2xl bg-white p-5">Loading import tools...</div>;
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name || "Journey"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Import Plans
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          Paste messy itinerary notes, then review every draft before it reaches
          the planner.
        </p>
      </section>

      {!canImport ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
          Only journey owners and admins can import planner items.
        </p>
      ) : null}

      <form
        onSubmit={parseWithAi}
        className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-xl font-semibold text-stone-950">Paste itinerary text</h2>
        <textarea
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          rows={10}
          placeholder="Paste flights, hotel bookings, car rental notes, chat messages, or a rough day-by-day plan..."
          className="w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
        />
        <button
          type="submit"
          disabled={!canImport || isParsing || rawText.trim().length < 10}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {isParsing ? "Parsing with AI..." : "Parse with AI"}
        </button>
      </form>

      {aiWarnings.length > 0 ? (
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          <p className="font-bold">AI notes</p>
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
              <p className="text-sm font-semibold text-emerald-700">Review</p>
              <h2 className="text-2xl font-semibold text-stone-950">
                {drafts.length} draft events
              </h2>
            </div>
            <button
              type="button"
              onClick={importDrafts}
              disabled={isImporting}
              className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isImporting ? "Importing..." : "Import to Planner"}
            </button>
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
                        {draft.day_date ?? "Unscheduled day"}
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
                            {type}
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
                        placeholder="Location"
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
                    Delete
                  </button>
                </div>

                <textarea
                  value={draft.description ?? ""}
                  onChange={(event) =>
                    updateDraft(draft.clientId, {
                      description: event.target.value || null,
                    })
                  }
                  placeholder="Description"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label className="text-sm font-bold text-stone-800">
                      Participants
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
                      <option value="everyone">Everyone</option>
                      <option value="only_me">Only me</option>
                      <option value="detected">Detected participants</option>
                      <option value="custom">Custom</option>
                    </select>
                    {draft.participant_names.length > 0 ? (
                      <p className="mt-2 text-xs text-stone-500">
                        Detected: {draft.participant_names.join(", ")}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-stone-500">
                        No participants detected. Default is visible as Everyone.
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">
                    Confidence:{" "}
                    <span className="font-bold">
                      {draft.confidence === null
                        ? "unknown"
                        : `${Math.round(draft.confidence * 100)}%`}
                    </span>
                  </div>
                </div>

                {draft.day_notes ? (
                  <p className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
                    Day notes: {draft.day_notes}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 text-xs font-bold text-stone-600">
                  {draft.is_estimated_time ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                      Estimated time
                    </span>
                  ) : null}
                  {draft.date_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      Date {Math.round(draft.date_confidence * 100)}%
                    </span>
                  ) : null}
                  {draft.time_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      Time {Math.round(draft.time_confidence * 100)}%
                    </span>
                  ) : null}
                  {draft.participants_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      People {Math.round(draft.participants_confidence * 100)}%
                    </span>
                  ) : null}
                  {draft.location_confidence !== null ? (
                    <span className="rounded-full bg-stone-100 px-3 py-1">
                      Place {Math.round(draft.location_confidence * 100)}%
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
                    Source: {draft.source_excerpt}
                  </p>
                ) : null}

                {draft.planned_start ? (
                  <p className="text-sm font-medium text-stone-600">
                    Starts {formatDateTime(draft.planned_start)}
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
                    Import anyway
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
            <p className="text-sm font-semibold text-emerald-700">Reservations</p>
            <h2 className="text-2xl font-semibold text-stone-950">
              {reservationDrafts.length} reservation drafts
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
                    {reservation.day_date ?? "Unscheduled"} · Reservation
                  </p>
                  <input
                    value={reservation.title}
                    onChange={(event) =>
                      setReservationDrafts((current) =>
                        current.map((item) =>
                          item.clientId === reservation.clientId
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      )
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
                  Delete
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={reservation.reservation_type}
                  onChange={(event) =>
                    setReservationDrafts((current) =>
                      current.map((item) =>
                        item.clientId === reservation.clientId
                          ? {
                              ...item,
                              reservation_type: event.target
                                .value as ItineraryReservationType,
                            }
                          : item,
                      ),
                    )
                  }
                  className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                >
                  {reservationTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  value={reservation.location_name ?? ""}
                  onChange={(event) =>
                    setReservationDrafts((current) =>
                      current.map((item) =>
                        item.clientId === reservation.clientId
                          ? { ...item, location_name: event.target.value || null }
                          : item,
                      ),
                    )
                  }
                  placeholder="Location"
                  className="rounded-xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-stone-950"
                />
              </div>
              {reservation.source_excerpt ? (
                <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
                  Source: {reservation.source_excerpt}
                </p>
              ) : null}
            </article>
          ))}
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
