import type { MemoryEntry } from "@/types";
import { formatTime } from "@/lib/format";
import type { MemoryEngagement } from "@/lib/supabase/memories";
import { MemoryEngagementActions } from "./MemoryEngagementActions";

const typeLabels: Record<MemoryEntry["type"], string> = {
  text: "Text note",
  photo: "Photo",
  voice: "Voice note",
  location: "Location",
};

type MemoryCardProps = {
  memory: MemoryEntry;
  displayUrl?: string;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
};

export function MemoryCard({
  memory,
  displayUrl,
  onEngagementChange,
}: MemoryCardProps) {
  const imageUrl = displayUrl ?? memory.mediaUrl;
  const contributor = memory.contributorName || "Traveler";

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      {memory.type === "photo" && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={memory.content || "Trip photo memory"}
          className="h-auto max-h-[460px] w-full object-cover"
        />
      ) : null}
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
            {typeLabels[memory.type]}
          </span>
          <MemoryEngagementActions
            memory={memory}
            onChange={onEngagementChange}
            compact
          />
        </div>
        <div className="flex items-center gap-3 text-xs font-semibold text-stone-500">
          <div className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-emerald-100 text-emerald-800">
            {memory.contributorAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={memory.contributorAvatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              contributor.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-stone-700">
              {contributor} · {formatTime(memory.capturedAt)}
            </p>
            {memory.locationName ? (
              <p className="truncate text-stone-500">{memory.locationName}</p>
            ) : null}
          </div>
        </div>
        {memory.content ? (
          <p className="text-sm leading-6 text-stone-700">{memory.content}</p>
        ) : memory.type === "photo" ? (
          <p className="text-sm leading-6 text-stone-500">Photo memory</p>
        ) : null}
      </div>
    </article>
  );
}
