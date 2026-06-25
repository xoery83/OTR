import Link from "next/link";
import type { JourneyStatus, Trip } from "@/types";
import { formatDateRange } from "@/lib/format";

type TripCardProps = {
  trip: Trip;
  memoryCount: number;
  photoCount?: number;
  memberCount?: number;
  status?: JourneyStatus;
  actionLabel?: string;
  href?: string;
};

export function TripCard({
  trip,
  memoryCount,
  photoCount,
  memberCount,
  status,
  actionLabel = "Open Journey",
  href,
}: TripCardProps) {
  const coverImageUrl =
    trip.coverImageUrl ||
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80";

  return (
    <Link
      href={href ?? `/trips/${trip.id}`}
      className="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div
        className="h-40 bg-cover bg-center"
        style={{ backgroundImage: `url(${coverImageUrl})` }}
      />
      <div className="space-y-4 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            {status ? `${status} journey` : trip.destination || "Destination TBD"}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-stone-950">
            {trip.name}
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            {formatDateRange(trip.startDate, trip.endDate)}
          </p>
          {trip.destination ? (
            <p className="mt-2 text-sm text-stone-600">{trip.destination}</p>
          ) : null}
        </div>
        <div className="space-y-3 border-t border-stone-100 pt-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-stone-100 px-3 py-1 font-semibold text-stone-700">
              {memoryCount} memories
            </span>
            {typeof photoCount === "number" ? (
              <span className="rounded-full bg-stone-100 px-3 py-1 font-semibold text-stone-700">
                {photoCount} photos
              </span>
            ) : null}
            {typeof memberCount === "number" ? (
              <span className="rounded-full bg-stone-100 px-3 py-1 font-semibold text-stone-700">
                {memberCount} travelers
              </span>
            ) : null}
          </div>
          <p className="font-bold text-emerald-800">{actionLabel}</p>
        </div>
      </div>
    </Link>
  );
}
