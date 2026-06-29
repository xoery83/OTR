"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useI18n } from "@/components/I18nProvider";
import { MemoryEngagementActions } from "@/components/MemoryEngagementActions";
import type { MemoryEntry } from "@/types";
import { formatTime } from "@/lib/format";
import type { MemoryEngagement } from "@/lib/supabase/memories";

export function DayMemoryPreview({
  tripId,
  date,
  memories,
  imageUrls = {},
  onOpenImage,
  onEngagementChange,
}: {
  tripId: string;
  date: string;
  memories: MemoryEntry[];
  imageUrls?: Record<string, string>;
  onOpenImage?: (image: { src: string; alt: string }) => void;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
}) {
  const { t } = useI18n();
  const latestMemories = useMemo(
    () =>
      [...memories]
        .sort(
          (first, second) =>
            new Date(second.createdAt || second.capturedAt).getTime() -
            new Date(first.createdAt || first.capturedAt).getTime(),
        )
        .slice(0, 5),
    [memories],
  );

  return (
    <div className="space-y-3">
      {latestMemories.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-white/70 p-3 text-sm text-stone-500">
          {t("memoryPreview.empty")}
        </p>
      ) : (
        <div className="grid gap-2">
          {latestMemories.map((memory) => {
            const imageUrl = memory.mediaUrl ? imageUrls[memory.mediaUrl] : null;

            return (
              <article
                key={memory.id}
                className="rounded-2xl bg-white/80 p-3 text-sm shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-bold text-stone-800">
                    {memory.contributorName || t("planner.traveler")} ·{" "}
                    {formatTime(memory.capturedAt)}
                  </p>
                  <MemoryEngagementActions
                    memory={memory}
                    onChange={onEngagementChange}
                    compact
                  />
                </div>
                <div className="mt-2 flex items-start gap-3">
                  {imageUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenImage?.({
                          src: imageUrl,
                          alt: memory.content || t("planner.memory.imagePreview"),
                        })
                      }
                      className="size-16 shrink-0 overflow-hidden rounded-xl bg-stone-100 shadow-sm ring-1 ring-stone-100 transition hover:opacity-90"
                      title={t("planner.memory.openImage")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    </button>
                  ) : null}
                  {memory.content ? (
                    <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap text-stone-600">
                      {memory.content}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {date !== "unscheduled" ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/trips/${tripId}/timeline?view=timeline&date=${date}`}
            className="inline-flex rounded-full bg-emerald-700 px-3 py-2 text-sm font-bold text-white shadow-sm"
          >
            {t("memoryPreview.openTimeline")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
