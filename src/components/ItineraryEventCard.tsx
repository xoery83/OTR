import type { ItineraryEvent } from "@/types";
import { formatJourneyTime } from "@/lib/format";

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
            {formatJourneyTime(event.plannedStart)}
          </p>
        ) : null}
      </div>
      {event.description ? (
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {event.description}
        </p>
      ) : null}
      {event.participants.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {event.participants.map((participant) => (
            <span
              key={participant.id}
              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-stone-700"
            >
              {participant.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={participant.avatarUrl}
                  alt=""
                  className="size-5 rounded-full object-cover"
                />
              ) : null}
              {participant.name}
            </span>
          ))}
        </div>
      ) : null}
      {event.needsReview || event.confidence !== null ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          {event.needsReview ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
              Needs review
            </span>
          ) : null}
          {event.confidence !== null ? (
            <span className="rounded-full bg-white px-3 py-1 text-stone-600">
              {Math.round(event.confidence * 100)}% confidence
            </span>
          ) : null}
        </div>
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
