"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useI18n } from "@/components/I18nProvider";
import type { MemoryEntry } from "@/types";
import { formatTime } from "@/lib/format";

export function DayMemoryPreview({
  tripId,
  date,
  memories,
}: {
  tripId: string;
  date: string;
  memories: MemoryEntry[];
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
        .slice(0, 3),
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
          {latestMemories.map((memory) => (
            <article
              key={memory.id}
              className="rounded-2xl bg-white/80 p-3 text-sm shadow-sm"
            >
              <p className="font-bold text-stone-800">
                {memory.type === "photo"
                  ? t("memoryPreview.photo")
                  : t("memoryPreview.note")}{" "}
                ·{" "}
                {formatTime(memory.capturedAt)}
              </p>
              {memory.content ? (
                <p className="mt-2 line-clamp-2 text-stone-600">
                  {memory.content}
                </p>
              ) : null}
            </article>
          ))}
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
