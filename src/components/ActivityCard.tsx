import type { ItineraryEvent } from "@/types";
import { formatJourneyTime } from "@/lib/format";
import { TranslatedText } from "./TranslatedText";

export function ActivityCard({ activity }: { activity: ItineraryEvent }) {
  const participantNames = activity.participants
    .slice(0, 3)
    .map((participant) => participant.name)
    .join(", ");
  const extraCount = Math.max(0, activity.participants.length - 3);

  return (
    <article className="group rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 transition hover:border-emerald-200 hover:bg-emerald-50">
      <div className="grid grid-cols-[auto_1fr_auto] gap-3">
        <div className="w-12 pt-1 text-xs font-bold text-emerald-800">
          {activity.plannedStart ? formatJourneyTime(activity.plannedStart) : "Any"}
        </div>
        <div className="min-w-0 space-y-1">
          <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            {activity.eventType}
          </span>
          <h3 className="truncate text-sm font-semibold text-stone-950">
            {activity.title}
          </h3>
          {activity.locationName ? (
            <p className="truncate text-xs text-stone-600">
              {activity.locationName}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="h-fit shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-900 shadow-sm"
        >
          Memory
        </button>
      </div>

      {activity.description ? (
        <TranslatedText
          className="mt-3 line-clamp-2 text-xs leading-5 text-stone-600"
          protectedEntities={[activity.title, activity.locationName]}
          sourceField="description"
          sourceId={activity.id}
          sourceType="plan_item"
          text={activity.description}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
        {participantNames ? (
          <span className="rounded-full bg-white px-3 py-1 text-stone-600">
            {participantNames}
            {extraCount ? ` +${extraCount}` : ""}
          </span>
        ) : null}
        {activity.isEstimatedTime ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
            Estimated
          </span>
        ) : null}
        {activity.confidence !== null ? (
          <span className="rounded-full bg-white px-3 py-1 text-stone-600">
            {Math.round(activity.confidence * 100)}%
          </span>
        ) : null}
        {activity.needsReview ? (
          <span className="rounded-full bg-white px-3 py-1 text-amber-800">
            Needs review
          </span>
        ) : null}
      </div>
    </article>
  );
}
