"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { ItineraryEventCard } from "@/components/ItineraryEventCard";
import { getErrorMessage } from "@/lib/errors";
import { formatDayLabel } from "@/lib/format";
import {
  createItineraryEvent,
  getItineraryEvents,
} from "@/lib/supabase/itinerary";
import { getTrip } from "@/lib/supabase/trips";
import type { ItineraryEvent, ItineraryEventType, Trip } from "@/types";

const eventTypes: ItineraryEventType[] = [
  "flight",
  "hotel",
  "car",
  "activity",
  "meal",
  "transport",
  "note",
  "other",
];

function dateKey(value: string | null) {
  if (!value) {
    return "unscheduled";
  }
  return value.slice(0, 10);
}

function PlannerContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [events, setEvents] = useState<ItineraryEvent[]>([]);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<ItineraryEventType>("activity");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [locationName, setLocationName] = useState("");
  const [description, setDescription] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadPlanner() {
      try {
        const [tripData, eventData] = await Promise.all([
          getTrip(tripId),
          getItineraryEvents(tripId),
        ]);
        if (isMounted) {
          setTrip(tripData);
          setEvents(eventData);
        }
      } catch (plannerError) {
        if (isMounted) {
          setError(getErrorMessage(plannerError, "Could not load planner."));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadPlanner();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const groups = useMemo(() => {
    return events.reduce<Record<string, ItineraryEvent[]>>((acc, event) => {
      const key = dateKey(event.plannedStart);
      acc[key] = [...(acc[key] ?? []), event];
      return acc;
    }, {});
  }, [events]);

  async function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const created = await createItineraryEvent({
        tripId,
        title,
        eventType,
        plannedStart,
        plannedEnd,
        locationName,
        description,
        bookingReference,
        url,
      });
      setEvents((current) => [...current, created]);
      setTitle("");
      setDescription("");
      setLocationName("");
      setBookingReference("");
      setUrl("");
      setPlannedStart("");
      setPlannedEnd("");
    } catch (eventError) {
      setError(getErrorMessage(eventError, "Could not add plan item."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <div className="rounded-2xl bg-white p-5">Loading planner...</div>;
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name || "Journey"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Journey Planner
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Planned route, bookings, and scheduled activities.
        </p>
      </section>

      <form
        onSubmit={addEvent}
        className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
      >
        <h2 className="text-xl font-semibold text-stone-950">Add Plan Item</h2>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          placeholder="Dinner in Reykjavik"
          className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={eventType}
            onChange={(event) => setEventType(event.target.value as ItineraryEventType)}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          >
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <input
            value={locationName}
            onChange={(event) => setLocationName(event.target.value)}
            placeholder="Location"
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          />
          <input
            type="datetime-local"
            value={plannedStart}
            onChange={(event) => setPlannedStart(event.target.value)}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          />
          <input
            type="datetime-local"
            value={plannedEnd}
            onChange={(event) => setPlannedEnd(event.target.value)}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          />
        </div>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Notes"
          rows={3}
          className="w-full resize-none rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={bookingReference}
            onChange={(event) => setBookingReference(event.target.value)}
            placeholder="Booking reference"
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="URL"
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting || !title.trim()}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          Add Plan Item
        </button>
        {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
      </form>

      <section className="space-y-5">
        {events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm text-stone-600">
            No planned events yet.
          </div>
        ) : (
          Object.keys(groups)
            .sort()
            .map((date) => (
              <div key={date} className="space-y-3">
                <h2 className="text-lg font-semibold text-stone-950">
                  {date === "unscheduled" ? "Unscheduled" : formatDayLabel(date)}
                </h2>
                {groups[date].map((event) => (
                  <ItineraryEventCard key={event.id} event={event} />
                ))}
              </div>
            ))
        )}
      </section>
    </div>
  );
}

export default function PlannerPage() {
  return <AuthGate>{() => <PlannerContent />}</AuthGate>;
}
