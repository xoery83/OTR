import type { ItineraryReservation } from "@/types";
import { formatDateTime, formatJourneyTime } from "@/lib/format";

const reservationLabels: Record<ItineraryReservation["reservationType"], string> = {
  flight: "Flight",
  hotel: "Hotel",
  car: "Car",
  ferry: "Ferry",
  tour: "Tour",
  restaurant: "Restaurant",
  other: "Reservation",
};

function timeRange(start: string | null, end: string | null) {
  if (start && end) return `${formatJourneyTime(start)} - ${formatJourneyTime(end)}`;
  if (start) return formatDateTime(start);
  if (end) return `Until ${formatDateTime(end)}`;
  return null;
}

function guestNamesFromSourceText(value: string | null) {
  if (!value) return [];
  const match = value.match(/(?:^|\n)\s*Guests?\s*[:：]\s*([^\n]+)/i);
  if (!match?.[1]) return [];

  return match[1]
    .split(/\s*(?:,|，|、|\/|和|及|与)\s*/g)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function ReservationCard({
  reservation,
}: {
  reservation: ItineraryReservation;
}) {
  const range = timeRange(reservation.startsAt, reservation.endsAt);
  const allParticipantNames =
    reservation.participants.length > 0
      ? reservation.participants.map((participant) => participant.name)
      : guestNamesFromSourceText(reservation.sourceText);
  const participantNames = allParticipantNames.slice(0, 3).join(", ");
  const extraCount = Math.max(0, allParticipantNames.length - 3);

  return (
    <article className="group rounded-2xl border border-amber-100 bg-amber-50/70 p-3 transition hover:border-amber-200 hover:bg-amber-50">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="min-w-0 space-y-1">
          <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">
            {reservationLabels[reservation.reservationType]}
          </span>
          <h3 className="truncate text-sm font-semibold text-stone-950">
            {reservation.title}
          </h3>
          {reservation.locationName ? (
            <p className="truncate text-xs text-stone-600">
              {reservation.locationName}
            </p>
          ) : null}
        </div>
        {range ? (
          <p className="shrink-0 text-right text-xs font-bold text-amber-900">
            {range}
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <div className="min-w-0 text-stone-500">
          {reservation.confirmationCode ? (
            <span className="font-semibold">Ref {reservation.confirmationCode}</span>
          ) : participantNames ? (
            <span className="truncate">
              {participantNames}
              {extraCount ? ` +${extraCount}` : ""}
            </span>
          ) : (
            <span>No participants</span>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full bg-white px-3 py-1 font-bold text-amber-900 shadow-sm"
        >
          Memory
        </button>
      </div>
    </article>
  );
}
