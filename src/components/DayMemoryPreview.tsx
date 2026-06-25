"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";
import type { MemoryEntry } from "@/types";
import { formatTime, getDefaultCapturedAt } from "@/lib/format";
import { getErrorMessage } from "@/lib/errors";
import { createTextMemory } from "@/lib/supabase/memories";

export function DayMemoryPreview({
  tripId,
  date,
  tripDayId,
  memories,
}: {
  tripId: string;
  date: string;
  tripDayId?: string | null;
  memories: MemoryEntry[];
}) {
  const [localMemories, setLocalMemories] = useState<MemoryEntry[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestMemories = useMemo(
    () =>
      [...localMemories, ...memories]
        .sort(
          (first, second) =>
            new Date(second.createdAt || second.capturedAt).getTime() -
            new Date(first.createdAt || first.capturedAt).getTime(),
        )
        .slice(0, 3),
    [localMemories, memories],
  );

  async function submitMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = content.trim();
    if (!text || isSaving || date === "unscheduled") return;

    setIsSaving(true);
    setError(null);

    try {
      const saved = await createTextMemory(tripId, text, {
        capturedAt: getDefaultCapturedAt(date),
        locationName: "",
        tripDayId: tripDayId?.startsWith("synthetic-") ? null : tripDayId,
      });
      setLocalMemories((current) => [saved, ...current]);
      setContent("");
      setIsAdding(false);
    } catch (memoryError) {
      setError(getErrorMessage(memoryError, "Could not save memory."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {latestMemories.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-white/70 p-3 text-sm text-stone-500">
          No memories captured for this day yet.
        </p>
      ) : (
        <div className="grid gap-2">
          {latestMemories.map((memory) => (
            <article
              key={memory.id}
              className="rounded-2xl bg-white/80 p-3 text-sm shadow-sm"
            >
              <p className="font-bold text-stone-800">
                {memory.type === "photo" ? "Photo" : "Note"} ·{" "}
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
        <div className="space-y-3">
          {isAdding ? (
            <form
              onSubmit={submitMemory}
              className="rounded-3xl border border-emerald-100 bg-white p-2 shadow-sm"
            >
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-100 text-lg font-semibold text-stone-500"
                  title="Attach file"
                >
                  +
                </button>
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={1}
                  placeholder="Add a day memory..."
                  className="min-h-9 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-stone-950 outline-none focus:border-emerald-300"
                />
                <button
                  type="button"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-100 text-xs font-bold text-stone-500"
                  title="Voice input"
                >
                  Mic
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !content.trim()}
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-700 text-xs font-bold text-white disabled:bg-stone-300"
                  title="Save memory"
                >
                  {isSaving ? "..." : "Go"}
                </button>
              </div>
              {error ? (
                <p className="mt-2 text-xs font-medium text-red-700">{error}</p>
              ) : null}
            </form>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsAdding((current) => !current)}
              className="inline-flex rounded-full bg-emerald-700 px-3 py-2 text-sm font-bold text-white shadow-sm"
            >
              Add memory
            </button>
          <Link
            href={`/trips/${tripId}/days/${date}`}
            className="inline-flex rounded-full bg-white px-3 py-2 text-sm font-bold text-emerald-800 shadow-sm"
          >
            Open timeline
          </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
