"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useI18n } from "@/components/I18nProvider";
import { MemoryEngagementActions } from "@/components/MemoryEngagementActions";
import type { MemoryEntry, PhotoAssetWithMemory } from "@/types";
import { formatTime } from "@/lib/format";
import type { MemoryEngagement } from "@/lib/supabase/memories";

type PreviewGroup =
  | {
      type: "album";
      memories: MemoryEntry[];
    }
  | {
      type: "card";
      memory: MemoryEntry;
    };

export function DayMemoryPreview({
  tripId,
  date,
  memories,
  imageUrls = {},
  imageUrlCandidatesByMemoryId = {},
  mediaAssetsByMemoryId = {},
  onOpenImage,
  onEngagementChange,
}: {
  tripId: string;
  date: string;
  memories: MemoryEntry[];
  imageUrls?: Record<string, string>;
  imageUrlCandidatesByMemoryId?: Record<string, string[]>;
  mediaAssetsByMemoryId?: Record<string, PhotoAssetWithMemory>;
  onOpenImage?: (image: {
    src: string;
    alt: string;
    memoryId: string;
    fallbackSrcs?: string[];
  }) => void;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
}) {
  const { t } = useI18n();
  const mediaAssetForMemory = (memory: MemoryEntry) =>
    mediaAssetsByMemoryId[memory.id] ?? null;
  const videoPosterForMemory = (memory: MemoryEntry) => {
    const asset = mediaAssetForMemory(memory);
    if (asset?.assetType !== "video") return null;

    return (
      asset.displayUrl ??
      asset.thumbnailUrl ??
      asset.providerThumbnailUrl ??
      asset.thumbnailDriveWebUrl ??
      asset.displayFallbackUrl ??
      `/api/media/assets/${asset.id}/thumbnail`
    );
  };
  const imageCandidatesForMemory = (memory: MemoryEntry) => {
    const videoPoster = videoPosterForMemory(memory);
    const candidates = [
      videoPoster,
      ...(imageUrlCandidatesByMemoryId[memory.id] ?? []),
      memory.mediaUrl ? imageUrls[memory.mediaUrl] : null,
    ].filter((value): value is string => Boolean(value));

    return [...new Set(candidates)];
  };
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
  const previewGroups = useMemo(() => {
    return latestMemories.reduce<PreviewGroup[]>((groups, memory) => {
      const isPurePhoto =
        memory.type === "photo" &&
        imageCandidatesForMemory(memory).length > 0 &&
        !memory.content.trim();

      if (!isPurePhoto) {
        groups.push({ type: "card", memory });
        return groups;
      }

      const previous = groups[groups.length - 1];
      if (previous?.type === "album") {
        previous.memories.push(memory);
      } else {
        groups.push({ type: "album", memories: [memory] });
      }

      return groups;
    }, []);
  }, [imageUrlCandidatesByMemoryId, imageUrls, latestMemories, mediaAssetsByMemoryId]);

  return (
    <div className="space-y-3">
      {latestMemories.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-white/70 p-3 text-sm text-stone-500">
          {t("memoryPreview.empty")}
        </p>
      ) : (
        <div className="grid gap-2">
          {previewGroups.map((group) => {
            if (group.type === "album") {
              return (
                <div
                  key={group.memories.map((memory) => memory.id).join("-")}
                  className="grid grid-cols-3 gap-1"
                >
                  {group.memories.map((memory) => {
                    const imageCandidates = imageCandidatesForMemory(memory);
                    const imageUrl = imageCandidates[0] ?? null;
                    const isVideo =
                      mediaAssetForMemory(memory)?.assetType === "video";
                    if (!imageUrl) return null;

                    return (
                      <button
                        type="button"
                        key={memory.id}
                        onClick={() =>
                          onOpenImage?.({
                            src: imageUrl,
                            alt: t("planner.memory.imagePreview"),
                            memoryId: memory.id,
                            fallbackSrcs: imageCandidates.slice(1),
                          })
                        }
                        className="group relative aspect-square overflow-hidden rounded-xl bg-stone-100 text-left shadow-sm transition hover:opacity-90"
                        title={t("planner.memory.openImage")}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <FallbackImage
                          sources={imageCandidates}
                          className="h-full w-full object-cover"
                        />
                        {isVideo ? <VideoPlayBadge /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            }

            const memory = group.memory;
            const imageCandidates = imageCandidatesForMemory(memory);
            const imageUrl = imageCandidates[0] ?? null;
            const isVideo = mediaAssetForMemory(memory)?.assetType === "video";

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
                          memoryId: memory.id,
                          fallbackSrcs: imageCandidates.slice(1),
                        })
                      }
                      className="size-16 shrink-0 overflow-hidden rounded-xl bg-stone-100 shadow-sm ring-1 ring-stone-100 transition hover:opacity-90"
                      title={t("planner.memory.openImage")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <FallbackImage
                        sources={imageCandidates}
                        className="size-full object-cover"
                      />
                      {isVideo ? <VideoPlayBadge compact /> : null}
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

function VideoPlayBadge({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span
          className={`grid place-items-center rounded-full bg-stone-950/70 font-black text-white shadow-lg ${
            compact ? "size-8 text-xs" : "size-10 text-sm"
          }`}
        >
          ▶
        </span>
      </span>
      {!compact ? (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-stone-950/75 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
          VIDEO
        </span>
      ) : null}
    </>
  );
}

function FallbackImage({
  sources,
  className,
}: {
  sources: string[];
  className: string;
}) {
  const firstSource = sources[0];
  if (!firstSource) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={sources.join("|")}
      src={firstSource}
      alt=""
      className={className}
      onError={(event) => {
        const nextIndex = Number(event.currentTarget.dataset.nextIndex ?? "1");
        const nextSource = sources[nextIndex];
        if (nextSource) {
          event.currentTarget.dataset.nextIndex = String(nextIndex + 1);
          event.currentTarget.src = nextSource;
          return;
        }

        event.currentTarget.style.display = "none";
      }}
    />
  );
}
