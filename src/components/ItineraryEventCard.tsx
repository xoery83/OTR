import type { ItineraryEvent } from "@/types";
import { formatTime } from "@/lib/format";

export function ItineraryEventCard({ event }: { event: ItineraryEvent }) {
  return (
    <article className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
            {event.eventType}
          </span>
          <h3 className="mt-3 text-base font-semibold text-stone-950">
            {event.title}
          </h3>
          {event.locationName ? (
            <p className="mt-1 text-sm text-stone-600">{event.locationName}</p>
          ) : null}
        </div>
        {event.plannedStart ? (
          <p className="shrink-0 text-sm font-bold text-emerald-800">
            {formatTime(event.plannedStart)}
          </p>
        ) : null}
      </div>
      {event.description ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {event.description}
        </p>
      ) : null}
      {event.bookingReference || event.url ? (
        <div className="mt-3 space-y-1 text-xs text-stone-500">
          {event.bookingReference ? <p>Ref: {event.bookingReference}</p> : null}
          {event.url ? <p className="truncate">{event.url}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
