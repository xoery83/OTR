import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";
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
  actionLabel,
  href,
}: TripCardProps) {
  const { t } = useI18n();
  const coverImageUrl =
    trip.coverImageUrl ||
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80";
  const statusLabel =
    status === "active"
      ? t("tripCard.status.active")
      : status === "upcoming"
        ? t("tripCard.status.upcoming")
        : status === "completed"
          ? t("tripCard.status.completed")
          : null;

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
            {statusLabel
              ? t("tripCard.statusJourney", { status: statusLabel })
              : trip.destination || t("tripCard.destinationTbd")}
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
              {t("tripCard.memories", { count: memoryCount })}
            </span>
            {typeof photoCount === "number" ? (
              <span className="rounded-full bg-stone-100 px-3 py-1 font-semibold text-stone-700">
                {t("tripCard.photos", { count: photoCount })}
              </span>
            ) : null}
            {typeof memberCount === "number" ? (
              <span className="rounded-full bg-stone-100 px-3 py-1 font-semibold text-stone-700">
                {t("tripCard.travelers", { count: memberCount })}
              </span>
            ) : null}
          </div>
          <p className="font-bold text-emerald-800">
            {actionLabel ?? t("trips.action.openJourney")}
          </p>
        </div>
      </div>
    </Link>
  );
}
