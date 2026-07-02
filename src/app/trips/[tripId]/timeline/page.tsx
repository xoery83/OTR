"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";
import type { User } from "@supabase/supabase-js";
import type { CSSProperties, FormEvent, PointerEvent, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { MemoryEngagementActions } from "@/components/MemoryEngagementActions";
import { createBackgroundJob } from "@/lib/background-jobs/client";
import { executeCaptureAction } from "@/lib/capture-ai/actions";
import { detectCaptureIntent } from "@/lib/capture-ai/client";
import { getErrorMessage } from "@/lib/errors";
import { formatDayLabel, formatJourneyTime } from "@/lib/format";
import { useJourneyCachedResource } from "@/hooks/useJourneyCachedResource";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { compressImageFile, type CompressedImage } from "@/lib/images";
import {
  journeyResourceKey,
  loadJourneyTimelineResource,
} from "@/lib/journey-resources";
import {
  getMediaAssetDisplayUrl,
  getMediaAssetDriveUrl,
  getMediaAssetLegacySignedUrlById,
  getMediaAssetPreviewUrl,
  getMediaAssetsByMemoryIds,
  getPhotoFacesForAssets,
  getTripVideoAssets,
  deleteMediaAsset,
  repairCurrentUserOrphanPhotoMemories,
  requestDriveThumbnailRepairForAssets,
  requestFaceConfirmation,
  requestVoiceTranscription,
} from "@/lib/supabase/media-assets";
import {
  createPhotoMemory,
  createTextMemory,
  deleteMemoryEntry,
  getSignedMemoryImageUrls,
  getTripMemoriesPage,
  type TripMemorySummary,
  type MemoryEngagement,
  updateMemoryEntry,
} from "@/lib/supabase/memories";
import { supabase } from "@/lib/supabase/client";
import type { PlannerV2Data } from "@/lib/supabase/planner-v2";
import type {
  JourneyMember,
  MemoryEntry,
  PhotoAssetWithMemory,
  PhotoFace,
} from "@/types";

type TimelineView = "timeline" | "album" | "favorites" | "debug";
type TimelineOrder = "captured" | "uploaded";

type TimelineSessionState = {
  view?: TimelineView;
  timelineOrder?: TimelineOrder;
  query?: string;
  selectedMemberIds?: string[];
  scrollY?: number;
  scrollByView?: Partial<Record<TimelineView, number>>;
};

type AlbumDeepLink = {
  assetId: string;
  reviewFaces: boolean;
  returnTo: string | null;
};

type ImagePixelSize = {
  width: number;
  height: number;
};

function getTimelineSessionKey(tripId: string) {
  return `otr:timeline:${tripId}`;
}

function readTimelineSession(tripId: string): TimelineSessionState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(getTimelineSessionKey(tripId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as TimelineSessionState;
  } catch {
    return null;
  }
}

function writeTimelineSession(tripId: string, state: TimelineSessionState) {
  if (typeof window === "undefined") return;

  const current = readTimelineSession(tripId) ?? {};
  window.sessionStorage.setItem(
    getTimelineSessionKey(tripId),
    JSON.stringify({
      ...current,
      ...state,
      scrollByView:
        current.scrollByView || state.scrollByView
          ? { ...current.scrollByView, ...state.scrollByView }
          : undefined,
    }),
  );
}

function parseTimelineView(value: string | null): TimelineView {
  if (
    value === "timeline" ||
    value === "album" ||
    value === "favorites" ||
    value === "debug"
  ) {
    return value;
  }

  return "album";
}

function normalizeReturnPath(value: string | null) {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

type TimelineItem = {
  id: string;
  memory: MemoryEntry;
  photo: PhotoAssetWithMemory | null;
  assetOnly?: boolean;
  faces: PhotoFace[];
  uploadedAt: string;
  capturedAt: string;
  dateKey: string;
  searchText: string;
  peopleNames: string[];
  hasUnassignedFaces: boolean;
  linkedPlannerItem: LinkedPlannerItem | null;
  replies: TimelineItem[];
};

type LinkedPlannerItem = {
  href: string;
  dayLabel: string;
  timeLabel: string | null;
  title: string;
};

const TIMELINE_MEMORY_PAGE_SIZE = 60;

function getLocalDateKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatBytes(value: number | null) {
  if (!value) return "n/a";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getAiSummary(asset: PhotoAssetWithMemory) {
  const summary = asset.aiMetadata?.summary;
  return typeof summary === "string" && summary.trim() ? summary : null;
}

function getAiError(asset: PhotoAssetWithMemory) {
  const error = asset.aiMetadata?.error;
  return typeof error === "string" && error.trim() ? error : null;
}

function isVideoAsset(asset?: PhotoAssetWithMemory | null) {
  return asset?.assetType === "video" || asset?.mimeType?.startsWith("video/");
}

function mediaAssetTitle(asset: PhotoAssetWithMemory | null, fallback: string) {
  if (!asset) return fallback;
  const capture2 = asset.aiMetadata?.capture2;
  if (capture2 && typeof capture2 === "object") {
    const fileName = (capture2 as { fileName?: unknown }).fileName;
    if (typeof fileName === "string" && fileName.trim()) return fileName;
  }
  return asset.originalFilePath || fallback;
}

function videoThumbnailUrls(asset: PhotoAssetWithMemory | null) {
  const video = asset?.aiMetadata?.video;
  if (!video || typeof video !== "object") return [];
  const thumbnails = (video as { thumbnails?: unknown }).thumbnails;
  if (!Array.isArray(thumbnails)) return [];
  return [
    ...new Set(
      thumbnails
        .map((item) =>
          item && typeof item === "object" && "url" in item
            ? (item as { url?: unknown }).url
            : null,
        )
        .filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  ];
}

function videoFaceReviewUrls(
  asset: PhotoAssetWithMemory | null,
  faces: PhotoFace[],
) {
  if (!asset || !isVideoAsset(asset)) return [];
  return [
    ...new Set(
      [
        ...faces.map(getFaceSourceUrl),
        ...videoThumbnailUrls(asset),
        asset.thumbnailUrl,
        asset.providerThumbnailUrl,
        asset.thumbnailDriveWebUrl,
        asset.displayUrl,
      ].filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  ];
}

function getFaceSourceUrl(face?: PhotoFace | null) {
  const sourceUrl = face?.boundingBox.sourceUrl ?? face?.boundingBox.source_url;
  return typeof sourceUrl === "string" && sourceUrl.trim()
    ? sourceUrl.trim()
    : null;
}

function videoFaceReviewImageUrl(
  asset?: PhotoAssetWithMemory | null,
  face?: PhotoFace | null,
  preferredUrl?: string | null,
) {
  if (!asset || !isVideoAsset(asset)) return null;

  const video = getRecord(asset.aiMetadata?.video);
  const thumbnail = getRecord(video?.thumbnail);
  const metadataThumbnailUrl = getMetadataString(thumbnail, "url");
  const faceSourceUrl = getFaceSourceUrl(face);

  return (
    preferredUrl ??
    faceSourceUrl ??
    asset.thumbnailUrl ??
    metadataThumbnailUrl ??
    asset.providerThumbnailUrl ??
    asset.thumbnailDriveWebUrl ??
    asset.displayUrl ??
    null
  );
}

function shouldShowFaceOnReviewImage(face: PhotoFace, reviewImageUrl: string | null) {
  const sourceUrl = getFaceSourceUrl(face);
  return !reviewImageUrl || !sourceUrl || sourceUrl === reviewImageUrl;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getMetadataNumber(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function getMetadataString(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getMetadataBoolean(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function getVideoRotation(asset: PhotoAssetWithMemory | null | undefined) {
  if (!asset || !isVideoAsset(asset)) return 0;
  const video = getRecord(asset.aiMetadata?.video);
  const metadata = getRecord(video?.metadata);
  const rotation = getMetadataNumber(metadata, "rotation");
  if (rotation === null) return 0;
  return ((Math.round(rotation) % 360) + 360) % 360;
}

function shouldSwapVideoDimensions(asset: PhotoAssetWithMemory | null | undefined) {
  const rotation = getVideoRotation(asset);
  return rotation === 90 || rotation === 270;
}

function getDisplayDimensions(
  photo: PhotoAssetWithMemory,
  loadedImageSize?: ImagePixelSize | null,
) {
  let width =
    loadedImageSize?.width && loadedImageSize.width > 0
      ? loadedImageSize.width
      : photo.width && photo.width > 0
        ? photo.width
        : 4;
  let height =
    loadedImageSize?.height && loadedImageSize.height > 0
      ? loadedImageSize.height
      : photo.height && photo.height > 0
        ? photo.height
        : 3;

  if (!loadedImageSize && shouldSwapVideoDimensions(photo)) {
    [width, height] = [height, width];
  }

  return { width, height };
}

function formatFileSize(bytes: number | null | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatBitrate(bitsPerSecond: number | null | undefined) {
  if (
    typeof bitsPerSecond !== "number" ||
    !Number.isFinite(bitsPerSecond) ||
    bitsPerSecond <= 0
  ) {
    return null;
  }
  return bitsPerSecond >= 1_000_000
    ? `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
    : `${Math.round(bitsPerSecond / 1000)} Kbps`;
}

function processingStatusLabel(status: PhotoAssetWithMemory["processingStatus"]) {
  if (status === "ready") return "已生成";
  if (status === "processing") return "处理中";
  if (status === "pending") return "等待处理";
  if (status === "failed") return "处理失败";
  if (status === "legacy") return "旧数据";
  return null;
}

function stringifyAiMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyAiMetadataValue(item)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "name", "description", "label", "value", "title", "content"]) {
      const nested = stringifyAiMetadataValue(record[key]);
      if (nested) return nested;
    }
    return JSON.stringify(record);
  }
  return String(value).trim();
}

function getLocationHints(asset: PhotoAssetWithMemory) {
  const hints = asset.aiMetadata?.locationHints;
  return Array.isArray(hints)
    ? hints.map((hint) => stringifyAiMetadataValue(hint)).filter(Boolean)
    : [];
}

function getAiModelInfo(asset: PhotoAssetWithMemory) {
  const metadata = asset.aiMetadata ?? {};
  const provider =
    typeof metadata.provider === "string" && metadata.provider.trim()
      ? metadata.provider
      : null;
  const modelUsed =
    typeof metadata.modelUsed === "string" && metadata.modelUsed.trim()
      ? metadata.modelUsed
      : typeof metadata.model_used === "string" && metadata.model_used.trim()
        ? metadata.model_used
        : null;
  const model =
    typeof metadata.model === "string" && metadata.model.trim()
      ? metadata.model
      : typeof metadata.modelVersion === "string" && metadata.modelVersion.trim()
        ? metadata.modelVersion
        : typeof metadata.model_version === "string" && metadata.model_version.trim()
          ? metadata.model_version
          : null;
  const confidence =
    typeof metadata.confidence === "number"
      ? metadata.confidence
      : typeof metadata.qualityScore === "number"
        ? metadata.qualityScore
        : null;

  if (!provider && !modelUsed && !model && confidence === null) return null;

  return { provider, modelUsed, model, confidence };
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} · ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function formatPlannerDayText(value: string) {
  if (value === "unscheduled") return "任意日期";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatPlannerTimeText(value: string | null | undefined) {
  if (!value) return null;
  return formatJourneyTime(value, "zh-CN") || null;
}

function buildPlannerLinkIndex(
  plannerData: PlannerV2Data | null,
  tripId: string,
) {
  const index = new Map<string, LinkedPlannerItem>();
  if (!plannerData) return index;

  plannerData.days.forEach((plannerDay) => {
    const dayDate = plannerDay.day.dayDate;
    const dayLabel = formatPlannerDayText(dayDate);

    plannerDay.activities.forEach((activity) => {
      index.set(`event:${activity.id}`, {
        href: `/trips/${tripId}/planner?date=${dayDate}&item=activity-${activity.id}`,
        dayLabel,
        timeLabel: formatPlannerTimeText(activity.plannedStart),
        title: activity.title,
      });
    });

    plannerDay.reservations.forEach((reservation) => {
      index.set(`reservation:${reservation.id}`, {
        href: `/trips/${tripId}/planner?date=${dayDate}&item=reservation-${reservation.id}`,
        dayLabel,
        timeLabel: formatPlannerTimeText(reservation.startsAt),
        title: reservation.title,
      });
    });
  });

  return index;
}

function toDateTimeLocalValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function getNearestDate(dates: string[]) {
  if (dates.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return [...dates].sort((left, right) => {
    const leftDistance = Math.abs(
      new Date(`${left}T00:00:00`).getTime() - today.getTime(),
    );
    const rightDistance = Math.abs(
      new Date(`${right}T00:00:00`).getTime() - today.getTime(),
    );
    return leftDistance - rightDistance;
  })[0];
}

function getTimelineItems(input: {
  memories: MemoryEntry[];
  photoAssets: PhotoAssetWithMemory[];
  facesByAssetId: Record<string, PhotoFace[]>;
  imageUrls: Record<string, string>;
  members: JourneyMember[];
  plannerLinks: Map<string, LinkedPlannerItem>;
}) {
  const photoByMemoryId = new Map(
    input.photoAssets
      .filter((photo) => photo.memoryEntryId)
      .map((photo) => [photo.memoryEntryId, photo]),
  );

  function toTimelineItem(memory: MemoryEntry): TimelineItem {
    const photo = photoByMemoryId.get(memory.id) ?? null;
    const faces = photo ? input.facesByAssetId[photo.id] ?? [] : [];
    const memberFaceNames = faces
      .filter((face) => face.journeyMemberId)
      .map((face) => face.recognizedName)
      .filter((name): name is string => Boolean(name));
    const guestFaceNames = faces
      .filter((face) => !face.journeyMemberId)
      .map((face) => face.recognizedName)
      .filter((name): name is string => Boolean(name));
    const memberNames = input.members
      .filter((member) => {
        const haystack = `${memory.content} ${memory.locationName ?? ""}`.toLowerCase();
        const displayName = member.displayName.toLowerCase();
        return (
          haystack.includes(displayName) ||
          faces.some((face) => face.journeyMemberId === member.id) ||
          memberFaceNames.some((name) => name.toLowerCase() === displayName)
        );
      })
      .map((member) => member.displayName);
    const normalizedMemberNames = new Set(
      memberNames.map((name) => name.trim().toLowerCase()),
    );
    const displayGuestFaceNames = guestFaceNames.map((name) =>
      normalizedMemberNames.has(name.trim().toLowerCase()) ? `${name} (guest)` : name,
    );
    const peopleNames = [...new Set([...memberNames, ...displayGuestFaceNames])];
    const sceneTags = photo?.sceneTags ?? [];
    const locationHints = photo ? getLocationHints(photo) : [];
    const summary = photo ? getAiSummary(photo) : null;
    const uploadedAt = photo?.createdAt ?? memory.createdAt;
    const displayUrl = photo?.displayUrl ?? (memory.mediaUrl ? input.imageUrls[memory.mediaUrl] : undefined);
    const linkedPlannerItem =
      (memory.itineraryEventId
        ? input.plannerLinks.get(`event:${memory.itineraryEventId}`)
        : null) ??
      (memory.itineraryReservationId
        ? input.plannerLinks.get(`reservation:${memory.itineraryReservationId}`)
        : null) ??
      null;

    return {
      id: memory.id,
      memory,
      photo: photo && displayUrl ? { ...photo, displayUrl } : photo,
      assetOnly: false,
      faces,
      uploadedAt,
      capturedAt: memory.capturedAt,
      dateKey: getLocalDateKey(memory.capturedAt),
      searchText: normalizeSearch(
        [
          memory.content,
          memory.locationName,
          memory.contributorName,
          linkedPlannerItem?.title,
          linkedPlannerItem?.dayLabel,
          summary,
          photo?.ocrText,
          sceneTags.join(" "),
          locationHints.join(" "),
          peopleNames.join(" "),
        ]
          .filter(Boolean)
          .join(" "),
      ),
      peopleNames,
      hasUnassignedFaces: faces.some(
        (face) => face.recognitionStatus !== "confirmed",
      ),
      linkedPlannerItem,
      replies: [],
    } satisfies TimelineItem;
  }

  const allItems = input.memories.map(toTimelineItem);
  const visibleMemoryIds = new Set(input.memories.map((memory) => memory.id));
  for (const asset of input.photoAssets) {
    const hasVisibleMemory = asset.memoryEntryId
      ? visibleMemoryIds.has(asset.memoryEntryId)
      : false;
    if (hasVisibleMemory) continue;
    if (asset.memory) {
      allItems.push(toTimelineItem(asset.memory));
      continue;
    }

    const capturedAt = asset.takenAt ?? asset.createdAt;
    const isVideo = isVideoAsset(asset);
    const title = mediaAssetTitle(asset, isVideo ? "Video" : "Photo");
    const faces = input.facesByAssetId[asset.id] ?? [];
    const peopleNames = [
      ...new Set(
        faces
          .map((face) => face.recognizedName)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    const virtualMemory: MemoryEntry = {
      id: `asset:${asset.id}`,
      tripId: asset.tripId,
      userId: asset.userId,
      type: "photo",
      content: title,
      mediaUrl:
        asset.thumbnailUrl ??
        asset.providerThumbnailUrl ??
        asset.displayUrl ??
        null,
      mediaAssetId: asset.id,
      locationName: null,
      capturedAt,
      createdAt: asset.createdAt,
      contributorName: undefined,
      contributorAvatarUrl: null,
    };

    allItems.push({
      id: virtualMemory.id,
      memory: virtualMemory,
      photo: asset,
      assetOnly: true,
      faces,
      uploadedAt: asset.createdAt,
      capturedAt,
      dateKey: getLocalDateKey(capturedAt),
      searchText: normalizeSearch(
        [
          title,
          asset.ocrText,
          asset.sceneTags?.join(" "),
          getLocationHints(asset).join(" "),
          peopleNames.join(" "),
        ]
          .filter(Boolean)
          .join(" "),
      ),
      peopleNames,
      hasUnassignedFaces: faces.some(
        (face) => face.recognitionStatus !== "confirmed",
      ),
      linkedPlannerItem: null,
      replies: [],
    });
  }
  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const rootItems: TimelineItem[] = [];

  allItems.forEach((item) => {
    const parentId = item.memory.parentMemoryId;
    const parent = parentId ? itemsById.get(parentId) : null;
    if (parent) {
      parent.replies.push(item);
    } else {
      rootItems.push(item);
    }
  });

  allItems.forEach((item) => {
    item.replies.sort(
      (left, right) =>
        new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime(),
    );
  });

  return rootItems;
}

function getFilteredItems(input: {
  items: TimelineItem[];
  query: string;
  mineOnly: boolean;
  selectedMemberIds: string[];
  currentUser: User;
  members: JourneyMember[];
}) {
  const query = normalizeSearch(input.query);
  const currentMember = input.members.find(
    (member) => member.userId === input.currentUser.id,
  );

  return input.items.filter((item) => {
    const replySearchText = item.replies
      .map((reply) => reply.searchText)
      .join(" ");
    const matchedMembers = input.members.filter((member) => {
      const nameHit = `${item.searchText} ${replySearchText}`.includes(
        member.displayName.toLowerCase(),
      );
      const faceHit = item.faces.some(
        (face) => face.journeyMemberId === member.id,
      );
      return nameHit || faceHit;
    });
    const matchedMemberIds = matchedMembers.map((member) => member.id);
    const isMine =
      item.memory.userId === input.currentUser.id ||
      (currentMember ? matchedMemberIds.includes(currentMember.id) : false);
    const memberFilterPassed =
      input.selectedMemberIds.length === 0 ||
      input.selectedMemberIds.some((memberId) =>
        matchedMemberIds.includes(memberId),
      );

    return (
      (!query || `${item.searchText} ${replySearchText}`.includes(query)) &&
      (!input.mineOnly || isMine) &&
      memberFilterPassed
    );
  });
}

function ItemMeta({
  item,
  hidePlannerLink = false,
}: {
  item: TimelineItem;
  hidePlannerLink?: boolean;
}) {
  const timeLabel =
    item.memory.type === "text" || item.memory.type === "voice"
      ? "说话时间"
      : "拍摄时间";
  const plannerLabel = item.linkedPlannerItem
    ? [
        item.linkedPlannerItem.dayLabel,
        item.linkedPlannerItem.timeLabel,
        item.linkedPlannerItem.title,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-[11px] font-bold text-stone-600">
      <span className="max-w-full truncate rounded-full bg-stone-100 px-2 py-1">
        {timeLabel} {formatShortDateTime(item.capturedAt)}
      </span>
      {item.linkedPlannerItem && !hidePlannerLink ? (
        <Link
          href={item.linkedPlannerItem.href}
          title={plannerLabel}
          className="max-w-full truncate rounded-full bg-emerald-50 px-2 py-1 text-emerald-900 underline decoration-emerald-200 underline-offset-2 sm:max-w-[32rem]"
        >
          {plannerLabel}
        </Link>
      ) : null}
      {item.memory.locationName ? (
        <span
          title={item.memory.locationName}
          className="max-w-full truncate rounded-full bg-stone-100 px-2 py-1 sm:max-w-[28rem]"
        >
          {item.memory.locationName}
        </span>
      ) : null}
      {item.memory.contributorName && item.memory.type !== "text" ? (
        <span className="rounded-full bg-stone-100 px-2 py-1">
          By {item.memory.contributorName}
        </span>
      ) : null}
      {item.peopleNames.slice(0, 4).map((name) => (
        <span
          key={name}
          className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900"
        >
          {name}
        </span>
      ))}
      {item.hasUnassignedFaces ? (
        <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">
          认脸
        </span>
      ) : null}
    </div>
  );
}

function PhotoPlainMeta({ item }: { item: TimelineItem }) {
  const plannerLabel = item.linkedPlannerItem
    ? [
        item.linkedPlannerItem.dayLabel,
        item.linkedPlannerItem.timeLabel,
        item.linkedPlannerItem.title,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="mt-1 flex min-w-0 flex-wrap justify-end gap-x-2 gap-y-1 text-right text-xs font-semibold leading-5 text-stone-600">
      <span>{formatShortDateTime(item.capturedAt)}</span>
      {item.memory.contributorName ? (
        <span>By {item.memory.contributorName}</span>
      ) : null}
      {item.linkedPlannerItem ? (
        <Link
          href={item.linkedPlannerItem.href}
          title={plannerLabel}
          className="max-w-full truncate text-emerald-800 underline decoration-emerald-200 underline-offset-2"
        >
          {plannerLabel}
        </Link>
      ) : null}
    </div>
  );
}

function MicrophoneIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}

function looksLikeExpenseReply(value: string) {
  return /(?:\b(?:paid|cost|receipt|invoice|expense)\b|费用|花了|付款|收据|发票|门票|票|酒店|餐|油|停车|租车|[$¥€£]|(?:NZD|AUD|CHF|CNY|EUR|DKK|USD|ISK|GBP)\s*\d|\d+(?:\.\d{1,2})?\s*(?:NZD|AUD|CHF|CNY|EUR|DKK|USD|ISK|GBP|元|欧|刀))/i.test(
    value,
  );
}

function ReplyBubble({
  reply,
  tripId,
  onEngagementChange,
  onOpenPhoto,
}: {
  reply: TimelineItem;
  tripId: string;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
  onOpenPhoto?: (item: TimelineItem) => void;
}) {
  const { t } = useI18n();
  const requestRepair = useDriveThumbnailRepair(tripId);

  return (
    <div className="border-t border-stone-100 pt-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-bold text-stone-500">
            {reply.memory.contributorName || "旅伴"} 说
          </p>
          <MemoryEngagementActions
            memory={reply.memory}
            onChange={onEngagementChange}
            compact
          />
        </div>
        <div className="text-sm leading-6 text-stone-800">
          {reply.memory.type === "photo" && reply.photo?.displayUrl ? (
            <button
              type="button"
              onClick={() => onOpenPhoto?.(reply)}
              className="mb-2 block overflow-hidden rounded-xl text-left"
              aria-label={t("planner.memory.openImage")}
            >
              <FallbackPhotoImage
                src={reply.photo.displayUrl}
                fallbackSrc={reply.photo.displayFallbackUrl}
                alt={reply.memory.content || "Reply photo"}
                className="max-h-56 cursor-zoom-in object-cover"
                onPrimaryError={() => requestRepair(reply.photo)}
              />
            </button>
          ) : null}
          {reply.memory.content ? (
            <p className="whitespace-pre-wrap">{reply.memory.content}</p>
          ) : null}
        </div>
        <ItemMeta item={reply} />
      </div>
    </div>
  );
}

function CompactMemoryCard({
  item,
  tripId,
  currentUserId,
  onSave,
  onDelete,
  onDeleteAsset,
  onReplyCreated,
  onEngagementChange,
  onOpenPhoto,
}: {
  item: TimelineItem;
  tripId: string;
  currentUserId: string;
  onSave: (
    memoryId: string,
    input: { content: string; locationName: string; capturedAt: string },
  ) => Promise<void>;
  onDelete: (memoryId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onReplyCreated: () => Promise<void>;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
  onOpenPhoto?: (item: TimelineItem) => void;
}) {
  const isPhoto = item.memory.type === "photo" && item.photo?.displayUrl;
  const isVideo = isVideoAsset(item.photo);
  const canManageMemory = !item.assetOnly && item.memory.userId === currentUserId;
  const canManageAsset = Boolean(
    item.assetOnly && item.photo?.userId === currentUserId,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [contentDraft, setContentDraft] = useState(item.memory.content);
  const [locationDraft, setLocationDraft] = useState(item.memory.locationName ?? "");
  const [capturedAtDraft, setCapturedAtDraft] = useState(
    toDateTimeLocalValue(item.memory.capturedAt),
  );
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyImage, setReplyImage] = useState<{
    file: File;
    compressedImage: CompressedImage;
    previewUrl: string;
  } | null>(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const { t } = useI18n();
  const [isSavingReply, setIsSavingReply] = useState(false);
  const [isTranscribingReply, setIsTranscribingReply] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const requestRepair = useDriveThumbnailRepair(tripId);

  const replyRecorder = useVoiceRecorder({
    onRecordingComplete: async (file) => {
      setIsTranscribingReply(true);
      setCardError(null);
      try {
        const result = await requestVoiceTranscription({ tripId, audio: file });
        setReplyText((current) =>
          [current.trim(), result.transcript].filter(Boolean).join("\n"),
        );
      } catch (voiceError) {
        setCardError(
          voiceError instanceof Error
            ? voiceError.message
            : t("timeline.error.transcribeVoice"),
        );
      } finally {
        setIsTranscribingReply(false);
      }
    },
    onError: (voiceError) => {
      setCardError(voiceError.message);
    },
  });

  async function prepareReplyImage(file: File | null) {
    if (!file) return;
    setIsPreparingImage(true);
    setCardError(null);
    try {
      const compressedImage = await compressImageFile(file);
      setReplyImage({
        file,
        compressedImage,
        previewUrl: compressedImage.previewUrl,
      });
    } catch (imageError) {
      setCardError(
        imageError instanceof Error
          ? imageError.message
          : t("timeline.error.prepareImage"),
      );
    } finally {
      setIsPreparingImage(false);
    }
  }

  async function maybeCreateReplyExpense(text: string, image: typeof replyImage) {
    if (!looksLikeExpenseReply(text) && !image) return;

    const result = await detectCaptureIntent({
      tripId,
      text: text || "Uploaded expense image",
      engineOptions: {
        entryPoint: "timeline_reply",
        intentBias: "expense",
        intentLock: "expense",
        lockedContext: {
          journeyId: tripId,
          dayDate: getLocalDateKey(item.memory.capturedAt),
          tripDayId: item.memory.tripDayId ?? null,
          itineraryEventId: item.memory.itineraryEventId ?? null,
          itineraryReservationId: item.memory.itineraryReservationId ?? null,
          locationName: item.memory.locationName ?? "",
        },
      },
      inputTypes: [
        ...(text.trim() ? (["text"] as const) : []),
        ...(image ? (["image"] as const) : []),
      ],
    });

    if (result.intent !== "expense") return;

    await executeCaptureAction({
      tripId,
      text,
      intent: result,
      compressedImage: image?.compressedImage ?? null,
      originalPhotoFile: image?.file ?? null,
      photoFileName: image?.file.name ?? "",
      engineOptions: {
        entryPoint: "timeline_reply",
        intentBias: "expense",
        intentLock: "expense",
        lockedContext: {
          journeyId: tripId,
          dayDate: getLocalDateKey(item.memory.capturedAt),
          tripDayId: item.memory.tripDayId ?? null,
          itineraryEventId: item.memory.itineraryEventId ?? null,
          itineraryReservationId: item.memory.itineraryReservationId ?? null,
          locationName: item.memory.locationName ?? "",
        },
      },
    });
  }

  async function saveReply() {
    const text = replyText.trim();
    if (!text && !replyImage) return;

    setIsSavingReply(true);
    setCardError(null);
    try {
      const input = {
        capturedAt: new Date().toISOString(),
        locationName: item.memory.locationName ?? "",
        tripDayId: item.memory.tripDayId ?? null,
        parentMemoryId: item.memory.id,
        itineraryEventId: item.memory.itineraryEventId ?? null,
        itineraryReservationId: item.memory.itineraryReservationId ?? null,
      };

      if (replyImage) {
        await createPhotoMemory(
          tripId,
          replyImage.compressedImage,
          replyImage.file.name,
          text,
          input,
          replyImage.file,
        );
      } else {
        await createTextMemory(tripId, text, input);
      }

      await maybeCreateReplyExpense(text, replyImage);
      setReplyText("");
      setReplyImage(null);
      setIsReplying(false);
      await onReplyCreated();
    } catch (replyError) {
      setCardError(getErrorMessage(replyError, t("timeline.error.saveReply")));
    } finally {
      setIsSavingReply(false);
    }
  }

  async function saveEdit() {
    setIsWorking(true);
    setCardError(null);
    try {
      await onSave(item.memory.id, {
        content: contentDraft,
        locationName: locationDraft,
        capturedAt: capturedAtDraft,
      });
      setIsEditing(false);
    } catch (saveError) {
      setCardError(
        saveError instanceof Error ? saveError.message : t("timeline.error.saveMemory"),
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function deleteItem() {
    const confirmed = window.confirm(t("timeline.confirm.deleteMemory"));
    if (!confirmed) return;

    setIsWorking(true);
    setCardError(null);
    try {
      if (item.assetOnly && item.photo) {
        await onDeleteAsset(item.photo.id);
      } else {
        await onDelete(item.memory.id);
      }
    } catch (deleteError) {
      setCardError(
        deleteError instanceof Error
          ? deleteError.message
          : t("timeline.error.deleteMemory"),
      );
      setIsWorking(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {isPhoto ? (
        <div className="relative overflow-hidden">
          <button
            type="button"
            onClick={() => onOpenPhoto?.(item)}
            className="block w-full overflow-hidden text-left"
            aria-label={t("planner.memory.openImage")}
          >
            <MediaAssetPoster
              asset={item.photo!}
              alt={item.memory.content || t("timeline.photo.alt")}
              className="h-auto w-full cursor-zoom-in object-cover transition duration-200 hover:scale-[1.01]"
              onPrimaryError={() => requestRepair(item.photo)}
            />
          </button>
          {isVideo ? <VideoPlayBadge /> : null}
          {!item.assetOnly ? (
          <div className="pointer-events-auto absolute bottom-2 right-2 z-10">
            <MemoryEngagementActions
              memory={item.memory}
              onChange={onEngagementChange}
              compact
              variant="overlay"
            />
          </div>
          ) : null}
        </div>
      ) : (
        <div className="px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-black text-stone-900">
              {t("timeline.memory.said", {
                name: item.memory.contributorName || t("timeline.traveler"),
              })}
            </p>
            <p className="mt-1 text-xs font-black text-stone-600">
              {formatShortDateTime(item.capturedAt)}
            </p>
            {item.linkedPlannerItem ? (
              <Link
                href={item.linkedPlannerItem.href}
                title={[
                  item.linkedPlannerItem.dayLabel,
                  item.linkedPlannerItem.timeLabel,
                  item.linkedPlannerItem.title,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                className="mt-2 inline-block max-w-full truncate rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-900 underline decoration-emerald-200 underline-offset-2"
              >
                {[
                  item.linkedPlannerItem.dayLabel,
                  item.linkedPlannerItem.timeLabel,
                  item.linkedPlannerItem.title,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Link>
            ) : null}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-xl font-black leading-9 tracking-normal text-stone-950">
            {item.memory.content || t("timeline.memory.textFallback")}
          </p>
        </div>
      )}
      <div className="p-3 sm:p-4">
        {!isPhoto ? (
          <div className="flex justify-end">
            <MemoryEngagementActions
              memory={item.memory}
              onChange={onEngagementChange}
              compact
            />
          </div>
        ) : null}
        {isEditing ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={contentDraft}
              onChange={(event) => setContentDraft(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-900 outline-none focus:border-emerald-500"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={locationDraft}
                onChange={(event) => setLocationDraft(event.target.value)}
                placeholder={t("planner.field.location")}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-900 outline-none focus:border-emerald-500"
              />
              <input
                type="datetime-local"
                value={capturedAtDraft}
                onChange={(event) => setCapturedAtDraft(event.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-900 outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={isWorking}
                className="rounded-full bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={isWorking}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-black text-stone-700 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        ) : item.memory.content && isPhoto ? (
          <h3 className="mt-2 text-base font-semibold text-stone-950">
            {item.memory.content}
          </h3>
        ) : null}
        {cardError ? (
          <p className="mt-2 text-xs font-semibold text-red-600">{cardError}</p>
        ) : null}
        {isPhoto ? (
          <PhotoPlainMeta item={item} />
        ) : (
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-stone-600">
            {item.memory.locationName ? (
              <span className="rounded-full bg-stone-100 px-2 py-1">
                {item.memory.locationName}
              </span>
            ) : null}
            {item.peopleNames.slice(0, 4).map((name) => (
              <span
                key={name}
                className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900"
              >
                {name}
              </span>
            ))}
          </div>
        )}
        {item.replies.length > 0 ? (
          <div className="mt-4 space-y-3 rounded-2xl bg-stone-50 p-3">
            {item.replies.map((reply) => (
              <ReplyBubble
                key={reply.id}
                reply={reply}
                tripId={tripId}
                onEngagementChange={onEngagementChange}
                onOpenPhoto={onOpenPhoto}
              />
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {canManageMemory ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing((current) => !current)}
                  disabled={isWorking}
                  className="rounded-full bg-stone-100 px-3 py-2 text-xs font-black text-stone-700 disabled:opacity-50"
                >
                  {isEditing ? "取消" : "修改"}
                </button>
                <button
                  type="button"
                  onClick={deleteItem}
                  disabled={isWorking}
                  className="rounded-full bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50"
                >
                  删除
                </button>
              </>
            ) : null}
            {canManageAsset ? (
              <button
                type="button"
                onClick={deleteItem}
                disabled={isWorking}
                className="rounded-full bg-red-50 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50"
              >
                {isVideo ? "删除视频" : "删除媒体"}
              </button>
            ) : null}
          </div>
          {!item.assetOnly ? (
            <button
              type="button"
              onClick={() => setIsReplying((current) => !current)}
              className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800"
            >
              {isReplying ? "取消回复" : "回复"}
            </button>
          ) : null}
        </div>
        {isReplying && !item.assetOnly ? (
          <div className="mt-3 rounded-3xl border border-emerald-100 bg-[#fffdf8] p-3">
            <textarea
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              rows={2}
              placeholder="写回复、记录费用，或用语音输入..."
              className="w-full resize-none rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm leading-6 text-stone-950 outline-none focus:border-emerald-300"
            />
            {replyImage ? (
              <div className="mt-2 flex items-center gap-3 rounded-2xl bg-emerald-50 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={replyImage.previewUrl}
                  alt=""
                  className="size-14 rounded-xl object-cover"
                />
                <p className="min-w-0 flex-1 truncate text-xs font-bold text-stone-700">
                  {replyImage.file.name}
                </p>
                <button
                  type="button"
                  onClick={() => setReplyImage(null)}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-stone-500"
                >
                  移除
                </button>
              </div>
            ) : null}
            {looksLikeExpenseReply(replyText) || replyImage ? (
              <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                保存后会按“费用”解析，不会新增行程。
              </p>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <label className="grid size-9 cursor-pointer place-items-center rounded-full bg-stone-100 text-xs font-black text-stone-600">
                IMG
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    void prepareReplyImage(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  replyRecorder.isRecording
                    ? replyRecorder.stop()
                    : void replyRecorder.start()
                }
                disabled={isTranscribingReply}
                className={`grid size-9 place-items-center rounded-full ${
                  replyRecorder.isRecording
                    ? "bg-red-600 text-white"
                    : "bg-stone-100 text-stone-600"
                } disabled:text-stone-300`}
                title="语音输入"
              >
                {isTranscribingReply ? (
                  <span className="text-xs font-bold">...</span>
                ) : (
                  <MicrophoneIcon />
                )}
              </button>
              <button
                type="button"
                onClick={saveReply}
                disabled={
                  isSavingReply ||
                  isPreparingImage ||
                  (!replyText.trim() && !replyImage)
                }
                className="ml-auto rounded-full bg-emerald-700 px-4 py-2 text-xs font-black text-white disabled:bg-stone-300"
              >
                {isSavingReply ? "保存中" : "发送"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function flattenTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items.flatMap((item) => [item, ...flattenTimelineItems(item.replies)]);
}

function canCurrentUserManagePhoto(item: TimelineItem, currentUserId: string) {
  return (
    item.memory.userId === currentUserId ||
    item.photo?.userId === currentUserId
  );
}

function TimelinePhotoLightbox({
  item,
  members,
  tripId,
  currentUserId,
  onClose,
  onDelete,
  onDeleteAsset,
  onFaceConfirmed,
  onEngagementChange,
}: {
  item: TimelineItem | null;
  members: JourneyMember[];
  tripId: string;
  currentUserId: string;
  onClose: () => void;
  onDelete: (memoryId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onFaceConfirmed: (assetId: string, face: PhotoFace) => void;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
}) {
  const { t } = useI18n();
  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null);
  const [selectedFace, setSelectedFace] = useState<{
    assetId: string;
    face: PhotoFace;
  } | null>(null);
  const [confirmingFaceId, setConfirmingFaceId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [viewerImageSize, setViewerImageSize] = useState<ImagePixelSize | null>(
    null,
  );
  const [faceReviewImageOverride, setFaceReviewImageOverride] = useState<
    string | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestRepair = useDriveThumbnailRepair(tripId);

  useEffect(() => {
    setSelectedPersonName(null);
    setSelectedFace(null);
    setConfirmError(null);
    setDeleteError(null);
    setIsDeleting(false);
    setViewerImageSize(null);
    setFaceReviewImageOverride(null);
  }, [item?.id]);

  if (!item || !item.photo || !item.photo.displayUrl) return null;
  const activeItem = item;
  const activePhoto = item.photo;

  const isVideo = isVideoAsset(activePhoto);
  const driveUrl = getMediaAssetDriveUrl(activePhoto);
  const showDeleteAction = canCurrentUserManagePhoto(activeItem, currentUserId);
  const memoryId = activeItem.memory.id;
  const faceReviewImageUrl = videoFaceReviewImageUrl(
    activePhoto,
    selectedFace?.face,
    faceReviewImageOverride,
  );
  const faceReviewImageUrls = videoFaceReviewUrls(activePhoto, item.faces);
  const showFaceReviewStill =
    isVideo &&
    Boolean(faceReviewImageUrl) &&
    (selectedFace?.assetId === activePhoto.id || Boolean(selectedPersonName));
  const canRenderFaceBoxes = !isVideo || showFaceReviewStill;
  const isFaceAssignmentOpen = selectedFace?.assetId === activePhoto.id;

  function openFaceAssignment() {
    if (!item?.photo) return;
    const unassignedFace = item.faces.find(
      (face) => face.recognitionStatus !== "confirmed",
    );
    if (!unassignedFace) return;

    setSelectedPersonName(null);
    setSelectedFace({
      assetId: item.photo.id,
      face: unassignedFace,
    });
    setFaceReviewImageOverride(
      videoFaceReviewImageUrl(item.photo, unassignedFace),
    );
    setConfirmError(null);
  }

  function closeFaceAssignment() {
    setSelectedFace(null);
    setConfirmError(null);
    setFaceReviewImageOverride(null);
  }

  function switchFaceReviewFrame(direction: -1 | 1) {
    if (!item?.photo || faceReviewImageUrls.length <= 1) return;
    const currentIndex = Math.max(0, faceReviewImageUrls.indexOf(faceReviewImageUrl ?? ""));
    const nextIndex =
      (currentIndex + direction + faceReviewImageUrls.length) %
      faceReviewImageUrls.length;
    const nextUrl = faceReviewImageUrls[nextIndex];
    const nextFace =
      item.faces.find(
        (face) =>
          face.recognitionStatus !== "confirmed" &&
          shouldShowFaceOnReviewImage(face, nextUrl),
      ) ??
      item.faces.find((face) => shouldShowFaceOnReviewImage(face, nextUrl)) ??
      null;

    setFaceReviewImageOverride(nextUrl);
    setViewerImageSize(null);
    if (nextFace) {
      setSelectedPersonName(null);
      setSelectedFace({ assetId: item.photo.id, face: nextFace });
    }
    setConfirmError(null);
  }

  function toggleFaceAssignment() {
    if (isFaceAssignmentOpen) {
      closeFaceAssignment();
      return;
    }
    openFaceAssignment();
  }

  async function confirmFace(member: JourneyMember) {
    if (!selectedFace) return;

    setConfirmingFaceId(selectedFace.face.id);
    setConfirmError(null);

    try {
      const updated = await requestFaceConfirmation({
        faceId: selectedFace.face.id,
        tripId,
        journeyMemberId: member.id,
      });
      onFaceConfirmed(selectedFace.assetId, updated);
      setSelectedFace(null);
    } catch (error) {
      setConfirmError(
        error instanceof Error
          ? error.message
          : t("timeline.debug.error.confirmFace"),
      );
    } finally {
      setConfirmingFaceId(null);
    }
  }

  async function confirmGuestFace(name: string) {
    if (!selectedFace) return false;

    setConfirmingFaceId(selectedFace.face.id);
    setConfirmError(null);

    try {
      const updated = await requestFaceConfirmation({
        faceId: selectedFace.face.id,
        tripId,
        recognizedName: name,
      });
      onFaceConfirmed(selectedFace.assetId, updated);
      setSelectedFace(null);
      return true;
    } catch (error) {
      setConfirmError(
        error instanceof Error
          ? error.message
          : t("timeline.debug.error.confirmFace"),
      );
      return false;
    } finally {
      setConfirmingFaceId(null);
    }
  }

  async function deletePhoto() {
    if (!showDeleteAction || isDeleting) return;
    const confirmed = window.confirm(t("timeline.confirm.deleteMemory"));
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      if (activeItem.assetOnly) {
        await onDeleteAsset(activePhoto.id);
      } else {
        await onDelete(memoryId);
      }
      onClose();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : t("timeline.error.deleteMemory"),
      );
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2147482400] bg-stone-950/92 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full max-w-6xl flex-col gap-3 overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-white">
            <p className="truncate text-sm font-black">
              {item.memory.content || item.memory.locationName || t("timeline.photo.fallback")}
            </p>
            <p className="mt-0.5 truncate text-xs font-semibold text-white/65">
              {formatShortDateTime(item.capturedAt)}
              {item.memory.locationName ? ` · ${item.memory.locationName}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!item.assetOnly ? (
              <MemoryEngagementActions
                memory={item.memory}
                onChange={onEngagementChange}
                compact
                className="rounded-full bg-white/10 px-1 py-1 text-white"
              />
            ) : null}
            {driveUrl ? (
              <a
                href={driveUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white px-3 py-2 text-xs font-black text-stone-950"
              >
                {t("timeline.album.openDrive")}
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white/15 px-3 py-2 text-xs font-black text-white"
            >
              {t("common.close")}
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(15rem,36svh)] gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]">
          <div
            className="otr-photo-viewer-frame relative mx-auto grid min-h-0 max-h-full max-w-full place-items-center overflow-hidden rounded-3xl bg-black"
            style={getPhotoViewerFrameStyle(item.photo, viewerImageSize)}
          >
            {showFaceReviewStill && faceReviewImageUrl ? (
              <FallbackPhotoImage
                src={faceReviewImageUrl}
                fallbackSrc={[item.photo.displayUrl, item.photo.displayFallbackUrl]}
                alt={item.memory.content || t("timeline.photo.alt")}
                className="h-full w-full object-contain"
                onPrimaryError={() => requestRepair(item.photo)}
                onLoad={(event) =>
                  setViewerImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
            ) : isVideo && item.photo.displayPreviewUrl ? (
              <video
                src={item.photo.displayPreviewUrl}
                poster={item.photo.displayUrl}
                className="h-full w-full object-contain"
                autoPlay
                playsInline
                onClick={(event) => {
                  const video = event.currentTarget;
                  if (video.paused) {
                    void video.play();
                  } else {
                    video.pause();
                  }
                }}
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  if (video.videoWidth > 0 && video.videoHeight > 0) {
                    setViewerImageSize({
                      width: video.videoWidth,
                      height: video.videoHeight,
                    });
                  }
                }}
              />
            ) : (
              <FallbackPhotoImage
                src={item.photo.displayPreviewUrl ?? item.photo.displayUrl}
                fallbackSrc={[item.photo.displayUrl, item.photo.displayFallbackUrl]}
                alt={item.memory.content || t("timeline.photo.alt")}
                className="h-full w-full object-contain"
                onPrimaryError={() => requestRepair(item.photo)}
                onLoad={(event) =>
                  setViewerImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
            )}
            {canRenderFaceBoxes
              ? item.faces.map((face) => {
                  const boxStyle = getFaceBoxStyle(
                    face,
                    item.photo!,
                    viewerImageSize,
                    { preferLoadedSize: !isVideo || showFaceReviewStill },
                  );
                  if (!boxStyle) return null;

                  const isSelected =
                    selectedFace?.assetId === item.photo!.id &&
                    selectedFace.face.id === face.id;
                  const isPersonSelected =
                    Boolean(selectedPersonName) &&
                    face.recognizedName === selectedPersonName;
                  const isReviewCandidate =
                    showFaceReviewStill &&
                    face.recognitionStatus !== "confirmed" &&
                    shouldShowFaceOnReviewImage(face, faceReviewImageUrl);
                  const matchesReviewFrame =
                    !showFaceReviewStill ||
                    shouldShowFaceOnReviewImage(face, faceReviewImageUrl);
                  if (
                    !matchesReviewFrame ||
                    (!isSelected && !isPersonSelected && !isReviewCandidate)
                  ) {
                    return null;
                  }

                  const faceName =
                    face.recognizedName || t("timeline.debug.confirmFace");
                  const showFaceLabel =
                    isSelected || isPersonSelected || Boolean(face.recognizedName);

                  return (
                    <button
                      type="button"
                      key={face.id}
                      onClick={() =>
                        face.recognitionStatus === "confirmed"
                          ? setSelectedPersonName(face.recognizedName ?? null)
                          : setSelectedFace({
                              assetId: item.photo!.id,
                              face,
                            })
                      }
                      aria-label={t("timeline.debug.selectFace", {
                        name: faceName,
                      })}
                      className={`absolute rounded-xl border-2 transition ${
                        isSelected
                          ? "border-amber-300 bg-amber-300/20"
                          : isReviewCandidate
                            ? "border-white/90 bg-black/10"
                            : "border-emerald-300 bg-emerald-300/15"
                      }`}
                      style={boxStyle}
                    >
                      {showFaceLabel ? (
                        <span
                          className={`absolute left-1 top-1 max-w-28 truncate rounded-full px-2 py-1 text-[11px] font-black shadow-sm ${
                            isSelected
                              ? "bg-amber-300 text-stone-950"
                              : "bg-emerald-600 text-white"
                          }`}
                        >
                          {faceName}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              : null}
            {showFaceReviewStill && faceReviewImageUrls.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => switchFaceReviewFrame(-1)}
                  className="absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-2xl font-black text-white shadow-sm"
                  aria-label="Previous frame"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => switchFaceReviewFrame(1)}
                  className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-2xl font-black text-white shadow-sm"
                  aria-label="Next frame"
                >
                  ›
                </button>
              </>
            ) : null}
          </div>

          <aside className="min-h-0 overflow-y-auto rounded-3xl bg-white p-3 md:p-4">
            <div className="space-y-4">
              {isVideo ? (
                <div className="flex items-start justify-between gap-3 rounded-2xl bg-stone-50 p-2">
                  <div className="min-w-0 flex flex-wrap items-center gap-2">
                    {item.peopleNames.length > 0 ? (
                      item.peopleNames.map((name) => {
                        const active = selectedPersonName === name;

                        return (
                          <button
                            type="button"
                            key={name}
                            onClick={() => {
                              setSelectedFace(null);
                              setConfirmError(null);
                              setSelectedPersonName((current) =>
                                current === name ? null : name,
                              );
                            }}
                            className={`rounded-full px-3 py-1 text-xs font-black ${
                              active
                                ? "bg-emerald-700 text-white"
                                : "bg-emerald-100 text-emerald-900"
                            }`}
                          >
                            {name}
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-sm font-semibold text-stone-500">
                        {t("timeline.album.noPeople")}
                      </span>
                    )}
                    {item.hasUnassignedFaces ? (
                      <button
                        type="button"
                        onClick={toggleFaceAssignment}
                        aria-pressed={isFaceAssignmentOpen}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${
                          isFaceAssignmentOpen
                            ? "bg-stone-950 text-white"
                            : "bg-amber-300 text-stone-950"
                        }`}
                      >
                        {isFaceAssignmentOpen
                          ? t("common.close")
                          : t("timeline.album.assignFaces")}
                      </button>
                    ) : null}
                  </div>
                  {showDeleteAction ? (
                    <button
                      type="button"
                      onClick={deletePhoto}
                      disabled={isDeleting}
                      className="shrink-0 rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50"
                    >
                      {isDeleting ? "删除中" : "删除视频"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {isVideo && !showFaceReviewStill ? (
                <VideoInfoPanel asset={activePhoto} />
              ) : null}

              {!isVideo ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                      {t("timeline.album.people")}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {item.peopleNames.length > 0 ? (
                        item.peopleNames.map((name) => {
                          const active = selectedPersonName === name;

                          return (
                            <button
                              type="button"
                              key={name}
                              onClick={() => {
                                setSelectedFace(null);
                                setConfirmError(null);
                                setSelectedPersonName((current) =>
                                  current === name ? null : name,
                                );
                              }}
                              className={`rounded-full px-3 py-1 text-xs font-black ${
                                active
                                  ? "bg-emerald-700 text-white"
                                  : "bg-emerald-100 text-emerald-900"
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })
                      ) : (
                        <span className="text-sm font-semibold text-stone-500">
                          {t("timeline.album.noPeople")}
                        </span>
                      )}
                      {item.hasUnassignedFaces ? (
                        <button
                          type="button"
                          onClick={toggleFaceAssignment}
                          aria-pressed={isFaceAssignmentOpen}
                          className={`rounded-full px-3 py-1.5 text-xs font-black ${
                            isFaceAssignmentOpen
                              ? "bg-stone-950 text-white"
                              : "bg-amber-300 text-stone-950"
                          }`}
                        >
                          {isFaceAssignmentOpen
                            ? t("common.close")
                            : t("timeline.album.assignFaces")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {showDeleteAction ? (
                    <button
                      type="button"
                      onClick={deletePhoto}
                      disabled={isDeleting}
                      className="shrink-0 rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50"
                    >
                      {isDeleting ? "删除中" : "删除图片"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {deleteError ? (
                <p className="text-xs font-semibold text-red-700">
                  {deleteError}
                </p>
              ) : null}

              {isFaceAssignmentOpen ? (
                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                        {t("timeline.debug.confirmFace")}
                      </p>
                      <h4 className="mt-1 text-lg font-semibold text-stone-950">
                        {t("timeline.debug.whoIsThis")}
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={closeFaceAssignment}
                      className="rounded-full bg-white px-3 py-2 text-xs font-black text-stone-700 shadow-sm"
                    >
                      {t("common.close")}
                    </button>
                  </div>
                  {confirmError ? (
                    <p className="mt-2 text-xs font-semibold text-red-700">
                      {confirmError}
                    </p>
                  ) : null}
                  <FaceMemberChooser
                    members={members}
                    selectedFaceId={selectedFace.face.id}
                    confirmingFaceId={confirmingFaceId}
                    onConfirm={confirmFace}
                  />
                  <GuestFaceNameForm
                    faceId={selectedFace.face.id}
                    confirmingFaceId={confirmingFaceId}
                    onSubmit={confirmGuestFace}
                  />
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function GuestFaceNameForm({
  faceId,
  confirmingFaceId,
  onSubmit,
}: {
  faceId: string;
  confirmingFaceId: string | null;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const isSaving = confirmingFaceId === faceId;
  const trimmedName = name.trim();

  useEffect(() => {
    setName("");
  }, [faceId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || isSaving) return;

    const didSave = await onSubmit(trimmedName);
    if (didSave) {
      setName("");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 rounded-2xl border border-dashed border-emerald-200 bg-white/70 p-3"
    >
      <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-800">
        {t("timeline.debug.nonMemberTitle")}
      </p>
      <p className="mt-1 text-xs font-semibold leading-5 text-stone-600">
        {t("timeline.debug.nonMemberHelp")}
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("timeline.debug.nonMemberPlaceholder")}
          className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-950 outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={!trimmedName || isSaving}
          className="shrink-0 rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
        >
          {isSaving ? t("common.saving") : t("timeline.debug.saveNonMember")}
        </button>
      </div>
    </form>
  );
}

function FaceMemberChooser({
  members,
  selectedFaceId,
  confirmingFaceId,
  onConfirm,
}: {
  members: JourneyMember[];
  selectedFaceId: string;
  confirmingFaceId: string | null;
  onConfirm: (member: JourneyMember) => void;
}) {
  return (
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {members.map((member) => (
        <button
          type="button"
          key={member.id}
          onClick={() => onConfirm(member)}
          disabled={confirmingFaceId === selectedFaceId}
          className="flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-black text-stone-900 shadow-sm disabled:opacity-60"
        >
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.avatarUrl}
              alt=""
              className="size-7 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-7 place-items-center rounded-full bg-emerald-100 text-xs text-emerald-900">
              {member.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="max-w-28 truncate">{member.displayName}</span>
        </button>
      ))}
    </div>
  );
}

function useTimelineMasonryColumnCount() {
  const [columnCount, setColumnCount] = useState(2);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setColumnCount(query.matches ? 3 : 2);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return columnCount;
}

function TimelineMasonryGrid({
  items,
  tripId,
  currentUserId,
  onSaveMemory,
  onDeleteMemory,
  onDeleteAsset,
  onReplyCreated,
  onEngagementChange,
  onOpenPhoto,
}: {
  items: TimelineItem[];
  tripId: string;
  currentUserId: string;
  onSaveMemory: (
    memoryId: string,
    input: { content: string; locationName: string; capturedAt: string },
  ) => Promise<void>;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onReplyCreated: () => Promise<void>;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
  onOpenPhoto?: (item: TimelineItem) => void;
}) {
  const columnCount = useTimelineMasonryColumnCount();
  const columns = useMemo(() => {
    const next = Array.from({ length: columnCount }, () => [] as TimelineItem[]);
    items.forEach((item, index) => {
      next[index % columnCount]?.push(item);
    });
    return next;
  }, [columnCount, items]);

  return (
    <section className="-mx-4 grid grid-cols-2 items-start gap-2 sm:mx-0 sm:gap-3 xl:grid-cols-3">
      {columns.map((column, columnIndex) => (
        <div
          key={columnIndex}
          className="flex min-w-0 flex-col gap-2 sm:gap-3"
        >
          {column.map((item) => (
            <CompactMemoryCard
              key={item.id}
              item={item}
              tripId={tripId}
              currentUserId={currentUserId}
              onSave={onSaveMemory}
              onDelete={onDeleteMemory}
              onDeleteAsset={onDeleteAsset}
              onReplyCreated={onReplyCreated}
              onEngagementChange={onEngagementChange}
              onOpenPhoto={onOpenPhoto}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

function UploadFeedView({
  items,
  tripId,
  currentUserId,
  onSaveMemory,
  onDeleteMemory,
  onDeleteAsset,
  onReplyCreated,
  onEngagementChange,
  onOpenPhoto,
}: {
  items: TimelineItem[];
  tripId: string;
  currentUserId: string;
  onSaveMemory: (
    memoryId: string,
    input: { content: string; locationName: string; capturedAt: string },
  ) => Promise<void>;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onReplyCreated: () => Promise<void>;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
  onOpenPhoto?: (item: TimelineItem) => void;
}) {
  const sorted = [...items].sort(
    (left, right) =>
      new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime(),
  );

  return (
    <TimelineMasonryGrid
      items={sorted}
      tripId={tripId}
      currentUserId={currentUserId}
      onSaveMemory={onSaveMemory}
      onDeleteMemory={onDeleteMemory}
      onDeleteAsset={onDeleteAsset}
      onReplyCreated={onReplyCreated}
      onEngagementChange={onEngagementChange}
      onOpenPhoto={onOpenPhoto}
    />
  );
}

function TrueTimelineView({
  items,
  tripId,
  currentUserId,
  initialDate,
  hideDateStrip = false,
  onFilterInteraction,
  onSaveMemory,
  onDeleteMemory,
  onDeleteAsset,
  onReplyCreated,
  onEngagementChange,
  onOpenPhoto,
  isSearchActive,
}: {
  items: TimelineItem[];
  tripId: string;
  currentUserId: string;
  initialDate?: string | null;
  hideDateStrip?: boolean;
  onFilterInteraction?: () => void;
  onSaveMemory: (
    memoryId: string,
    input: { content: string; locationName: string; capturedAt: string },
  ) => Promise<void>;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onReplyCreated: () => Promise<void>;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
  onOpenPhoto?: (item: TimelineItem) => void;
  isSearchActive?: boolean;
}) {
  const { t } = useI18n();
  const dates = useMemo(
    () =>
      [
        ...new Set(
          [initialDate, ...items.map((item) => item.dateKey)].filter(
            (date): date is string => Boolean(date),
          ),
        ),
      ].sort((left, right) => right.localeCompare(left)) as string[],
    [initialDate, items],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate ?? null);
  const dateStripRef = useRef<HTMLDivElement | null>(null);
  const dateSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const groupedItems = useMemo(
    () =>
      dates.map((date) => ({
        date,
        items: items
          .filter((item) => item.dateKey === date)
          .sort(
            (left, right) =>
              new Date(right.capturedAt).getTime() -
              new Date(left.capturedAt).getTime(),
          ),
      })),
    [dates, items],
  );
  const activeDate =
    selectedDate && dates.includes(selectedDate)
      ? selectedDate
      : getNearestDate(dates);
  const visibleGroups = groupedItems;

  useEffect(() => {
    if (hideDateStrip) return;
    if (!activeDate) return;
    const target = dateSectionRefs.current[activeDate];
    if (!target) return;

    const timer = window.setTimeout(() => {
      const toolbarBottom =
        document
          .querySelector<HTMLElement>(".otr-timeline-toolbar")
          ?.getBoundingClientRect().bottom ?? 0;
      const dateStripBottom =
        document
          .querySelector<HTMLElement>(".otr-timeline-date-strip")
          ?.getBoundingClientRect().bottom ?? 0;
      const stickyBottom = Math.max(toolbarBottom, dateStripBottom);
      const targetTop = target.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: Math.max(0, targetTop - stickyBottom - 12),
        behavior: "smooth",
      });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [activeDate, hideDateStrip, visibleGroups.length]);

  function selectDate(date: string) {
    onFilterInteraction?.();
    setSelectedDate(date);
  }

  if (!activeDate) return null;

  return (
    <section className="space-y-4">
      {!hideDateStrip ? (
        <div
          ref={dateStripRef}
          className={`otr-timeline-date-strip overflow-hidden border-x border-b border-stone-200 bg-white px-3 py-2 shadow-sm backdrop-blur ${
            isSearchActive
              ? "fixed inset-x-0 top-[7.75rem] z-[2147482500] md:sticky md:top-[8.25rem]"
              : "sticky z-20 rounded-b-3xl"
          }`}
        >
          <div className="overflow-x-auto px-0.5 pb-1">
            <div className="flex gap-2">
            {dates.map((date) => {
              const active = activeDate === date;
              const isToday = date === getLocalDateKey(new Date().toISOString());
              const itemCount =
                groupedItems.find((group) => group.date === date)?.items.length ?? 0;

              return (
                <button
                  type="button"
                  key={date}
                  onClick={() => selectDate(date)}
                  className={`min-w-[4.85rem] shrink-0 rounded-xl border px-3 py-2 text-left shadow-sm transition ${
                    active
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : isToday
                        ? "border-amber-300 bg-amber-50 text-amber-900 ring-2 ring-amber-200"
                        : "border-stone-100 bg-white text-stone-700"
                  } ${active && isToday ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-stone-50" : ""}`}
                >
                  <p className="text-[11px] font-black uppercase leading-none tracking-wide">
                    {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="mt-1 text-xs font-black leading-none">
                    {itemCount} 条
                  </p>
                </button>
              );
            })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-7">
        {visibleGroups.map((group) => (
          <section
            key={group.date}
            ref={(element) => {
              dateSectionRefs.current[group.date] = element;
            }}
            className="space-y-3"
          >
            <div className="px-1 pb-1 pt-3 sm:px-2">
              <h2 className="text-2xl font-semibold tracking-tight text-stone-950">
                {formatDayLabel(group.date)}
              </h2>
              <p className="mt-1 text-sm font-medium text-stone-500">
                {t("timeline.true.count", { count: group.items.length })}
              </p>
            </div>

            <TimelineMasonryGrid
              items={group.items}
              tripId={tripId}
              currentUserId={currentUserId}
              onSaveMemory={onSaveMemory}
              onDeleteMemory={onDeleteMemory}
              onDeleteAsset={onDeleteAsset}
              onReplyCreated={onReplyCreated}
              onEngagementChange={onEngagementChange}
              onOpenPhoto={onOpenPhoto}
            />
          </section>
        ))}
      </div>
    </section>
  );
}

function UploadedTimelineView({
  items,
  tripId,
  currentUserId,
  onSaveMemory,
  onDeleteMemory,
  onDeleteAsset,
  onReplyCreated,
  onEngagementChange,
  onOpenPhoto,
}: {
  items: TimelineItem[];
  tripId: string;
  currentUserId: string;
  onSaveMemory: (
    memoryId: string,
    input: { content: string; locationName: string; capturedAt: string },
  ) => Promise<void>;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onReplyCreated: () => Promise<void>;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
  onOpenPhoto?: (item: TimelineItem) => void;
}) {
  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (left, right) =>
          new Date(right.uploadedAt).getTime() -
          new Date(left.uploadedAt).getTime(),
      ),
    [items],
  );

  return (
    <TimelineMasonryGrid
      items={sortedItems}
      tripId={tripId}
      currentUserId={currentUserId}
      onSaveMemory={onSaveMemory}
      onDeleteMemory={onDeleteMemory}
      onDeleteAsset={onDeleteAsset}
      onReplyCreated={onReplyCreated}
      onEngagementChange={onEngagementChange}
      onOpenPhoto={onOpenPhoto}
    />
  );
}

function AlbumView({
  items,
  members,
  tripId,
  currentUserId,
  initialAssetId,
  autoOpenFaceAssignment,
  returnTo,
  onInitialAssetConsumed,
  onInitialAssetClosed,
  onFaceConfirmed,
  onDeleteMemory,
  onDeleteAsset,
  onEngagementChange,
}: {
  items: TimelineItem[];
  members: JourneyMember[];
  tripId: string;
  currentUserId: string;
  initialAssetId?: string | null;
  autoOpenFaceAssignment?: boolean;
  returnTo?: string | null;
  onInitialAssetConsumed?: () => void;
  onInitialAssetClosed?: () => void;
  onFaceConfirmed: (assetId: string, face: PhotoFace) => void;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
  onEngagementChange?: (memoryId: string, engagement: MemoryEngagement) => void;
}) {
  const { t } = useI18n();
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null);
  const [selectedFace, setSelectedFace] = useState<{
    assetId: string;
    face: PhotoFace;
  } | null>(null);
  const [confirmingFaceId, setConfirmingFaceId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [activeImageSize, setActiveImageSize] = useState<ImagePixelSize | null>(
    null,
  );
  const [activeFaceReviewImageOverride, setActiveFaceReviewImageOverride] =
    useState<string | null>(null);
  const [isDeletingPhoto, setIsDeletingPhoto] = useState(false);
  const [deletePhotoError, setDeletePhotoError] = useState<string | null>(null);
  const requestRepair = useDriveThumbnailRepair(tripId);
  const photoItems = items
    .filter((item) => item.memory.type === "photo" && item.photo?.displayUrl)
    .sort(
      (left, right) =>
        new Date(right.uploadedAt).getTime() -
        new Date(left.uploadedAt).getTime(),
    );
  const activeItem = photoItems.find((item) => item.id === activeItemId) ?? null;
  const activeDriveUrl = activeItem?.photo
    ? getMediaAssetDriveUrl(activeItem.photo)
    : null;
  const canDeleteActivePhoto = activeItem
    ? canCurrentUserManagePhoto(activeItem, currentUserId)
    : false;
  const activeIsVideo = isVideoAsset(activeItem?.photo);
  const activeFaceReviewImageUrl = videoFaceReviewImageUrl(
    activeItem?.photo,
    selectedFace?.face,
    activeFaceReviewImageOverride,
  );
  const activeFaceReviewImageUrls = videoFaceReviewUrls(
    activeItem?.photo ?? null,
    activeItem?.faces ?? [],
  );
  const showActiveFaceReviewStill =
    activeIsVideo &&
    Boolean(activeFaceReviewImageUrl) &&
    Boolean(activeItem?.photo) &&
    (selectedFace?.assetId === activeItem?.photo?.id ||
      Boolean(selectedPersonName));
  const canRenderActiveFaceBoxes = !activeIsVideo || showActiveFaceReviewStill;
  const isActiveFaceAssignmentOpen =
    Boolean(activeItem?.photo) && selectedFace?.assetId === activeItem?.photo?.id;
  const openedInitialAssetIdRef = useRef<string | null>(null);
  const returnToRef = useRef(returnTo);
  const initialViewerOpenRef = useRef(false);

  useEffect(() => {
    returnToRef.current = returnTo;
  }, [returnTo]);

  useEffect(() => {
    setActiveImageSize(null);
    setIsDeletingPhoto(false);
    setDeletePhotoError(null);
    setActiveFaceReviewImageOverride(null);
  }, [activeItem?.photo?.id]);

  useEffect(() => {
    if (!initialAssetId) return;
    if (openedInitialAssetIdRef.current === initialAssetId) return;

    const targetItem = photoItems.find((item) => item.photo?.id === initialAssetId);
    if (!targetItem?.photo) return;

    openedInitialAssetIdRef.current = initialAssetId;
    returnToRef.current = returnTo;
    initialViewerOpenRef.current = true;
    setActiveItemId(targetItem.id);
    setSelectedPersonName(null);
    setConfirmError(null);

    if (autoOpenFaceAssignment) {
      const unassignedFace = targetItem.faces.find(
        (face) => face.recognitionStatus !== "confirmed",
      );
      setSelectedFace(
        unassignedFace
          ? {
              assetId: targetItem.photo.id,
              face: unassignedFace,
            }
          : null,
      );
      setActiveFaceReviewImageOverride(
        unassignedFace
          ? videoFaceReviewImageUrl(targetItem.photo, unassignedFace)
          : null,
      );
    } else {
      setSelectedFace(null);
      setActiveFaceReviewImageOverride(null);
    }
    onInitialAssetConsumed?.();
  }, [
    autoOpenFaceAssignment,
    initialAssetId,
    onInitialAssetConsumed,
    photoItems,
    returnTo,
  ]);

  function closeViewer() {
    const returnPath = returnToRef.current;
    const shouldCloseInitialViewer = initialViewerOpenRef.current;

    returnToRef.current = null;
    openedInitialAssetIdRef.current = null;
    initialViewerOpenRef.current = false;

    if (shouldCloseInitialViewer) {
      onInitialAssetClosed?.();
    }

    if (returnPath) {
      window.location.assign(returnPath);
      return;
    }

    setActiveItemId(null);
    setSelectedPersonName(null);
    setSelectedFace(null);
    setConfirmError(null);
    setActiveFaceReviewImageOverride(null);
    setDeletePhotoError(null);
  }

  async function deleteActivePhoto() {
    if (!activeItem || !canDeleteActivePhoto || isDeletingPhoto) return;
    const confirmed = window.confirm(t("timeline.confirm.deleteMemory"));
    if (!confirmed) return;

    setIsDeletingPhoto(true);
    setDeletePhotoError(null);
    try {
      if (activeItem.assetOnly && activeItem.photo) {
        await onDeleteAsset(activeItem.photo.id);
      } else {
        await onDeleteMemory(activeItem.memory.id);
      }
      closeViewer();
    } catch (error) {
      setDeletePhotoError(
        error instanceof Error ? error.message : t("timeline.error.deleteMemory"),
      );
      setIsDeletingPhoto(false);
    }
  }

  function openFaceAssignment() {
    if (!activeItem?.photo) return;
    const unassignedFace = activeItem.faces.find(
      (face) => face.recognitionStatus !== "confirmed",
    );
    if (!unassignedFace) return;

    setSelectedPersonName(null);
    setSelectedFace({
      assetId: activeItem.photo.id,
      face: unassignedFace,
    });
    setActiveFaceReviewImageOverride(
      videoFaceReviewImageUrl(activeItem.photo, unassignedFace),
    );
    setConfirmError(null);
  }

  function closeFaceAssignment() {
    setSelectedFace(null);
    setConfirmError(null);
    setActiveFaceReviewImageOverride(null);
  }

  function switchActiveFaceReviewFrame(direction: -1 | 1) {
    if (!activeItem?.photo || activeFaceReviewImageUrls.length <= 1) return;
    const currentIndex = Math.max(
      0,
      activeFaceReviewImageUrls.indexOf(activeFaceReviewImageUrl ?? ""),
    );
    const nextIndex =
      (currentIndex + direction + activeFaceReviewImageUrls.length) %
      activeFaceReviewImageUrls.length;
    const nextUrl = activeFaceReviewImageUrls[nextIndex];
    const nextFace =
      activeItem.faces.find(
        (face) =>
          face.recognitionStatus !== "confirmed" &&
          shouldShowFaceOnReviewImage(face, nextUrl),
      ) ??
      activeItem.faces.find((face) => shouldShowFaceOnReviewImage(face, nextUrl)) ??
      null;

    setActiveFaceReviewImageOverride(nextUrl);
    setActiveImageSize(null);
    if (nextFace) {
      setSelectedPersonName(null);
      setSelectedFace({ assetId: activeItem.photo.id, face: nextFace });
    }
    setConfirmError(null);
  }

  function toggleFaceAssignment() {
    if (isActiveFaceAssignmentOpen) {
      closeFaceAssignment();
      return;
    }
    openFaceAssignment();
  }

  async function confirmFace(member: JourneyMember) {
    if (!selectedFace) return;

    setConfirmingFaceId(selectedFace.face.id);
    setConfirmError(null);

    try {
      const updated = await requestFaceConfirmation({
        faceId: selectedFace.face.id,
        tripId,
        journeyMemberId: member.id,
      });
      onFaceConfirmed(selectedFace.assetId, updated);
      setSelectedFace(null);
    } catch (error) {
      setConfirmError(
        error instanceof Error
          ? error.message
          : t("timeline.debug.error.confirmFace"),
      );
    } finally {
      setConfirmingFaceId(null);
    }
  }

  async function confirmGuestFace(name: string) {
    if (!selectedFace) return false;

    setConfirmingFaceId(selectedFace.face.id);
    setConfirmError(null);

    try {
      const updated = await requestFaceConfirmation({
        faceId: selectedFace.face.id,
        tripId,
        recognizedName: name,
      });
      onFaceConfirmed(selectedFace.assetId, updated);
      setSelectedFace(null);
      return true;
    } catch (error) {
      setConfirmError(
        error instanceof Error
          ? error.message
          : t("timeline.debug.error.confirmFace"),
      );
      return false;
    } finally {
      setConfirmingFaceId(null);
    }
  }

  return (
    <>
      <section className="-mx-4 grid grid-cols-3 gap-0.5 sm:mx-0 sm:grid-cols-4 sm:gap-1 lg:grid-cols-6">
        {photoItems.map((item, index) => (
          <button
            type="button"
            key={item.id}
            onClick={() => {
              setActiveItemId(item.id);
              setSelectedPersonName(null);
              setSelectedFace(null);
              setConfirmError(null);
            }}
            className="group relative aspect-square overflow-hidden bg-stone-100 text-left"
          >
            <MediaAssetPoster
              asset={item.photo!}
              alt={item.memory.content || t("timeline.photo.alt")}
              className="h-full w-full object-cover"
              loading={index < 12 ? "eager" : "lazy"}
              fetchPriority={index < 12 ? "high" : "auto"}
              onPrimaryError={() => requestRepair(item.photo)}
            />
            {isVideoAsset(item.photo) ? <VideoPlayBadge /> : null}
            <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-stone-950/80 via-stone-950/20 to-transparent p-2 text-white opacity-0 transition group-hover:opacity-100">
              <p className="line-clamp-2 text-xs font-bold">
                {item.memory.content ||
                  item.memory.locationName ||
                  t("timeline.photo.fallback")}
              </p>
              <p className="mt-1 text-[10px] font-semibold opacity-80">
                {formatShortDateTime(item.capturedAt)}
              </p>
              {item.hasUnassignedFaces ? (
                <span className="mt-2 w-fit rounded-full bg-amber-300 px-2 py-1 text-[10px] font-black text-stone-950">
                  {t("timeline.album.assignFaces")}
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </section>

      {activeItem?.photo?.displayUrl ? (
        <div
          className="fixed inset-0 z-[2147482400] bg-stone-950/92 p-3 backdrop-blur-sm sm:p-6"
          onClick={closeViewer}
        >
          <div
            className="mx-auto flex h-full max-w-6xl flex-col gap-3 overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-white">
                <p className="truncate text-sm font-black">
                  {activeItem.memory.content || t("timeline.photo.fallback")}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-white/65">
                  {formatShortDateTime(activeItem.capturedAt)}
                  {activeItem.memory.locationName
                    ? ` · ${activeItem.memory.locationName}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!activeItem.assetOnly ? (
                  <MemoryEngagementActions
                    memory={activeItem.memory}
                    onChange={onEngagementChange}
                    compact
                    className="rounded-full bg-white/10 px-1 py-1 text-white"
                  />
                ) : null}
                {activeDriveUrl ? (
                  <a
                    href={activeDriveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-white px-3 py-2 text-xs font-black text-stone-950"
                  >
                    {t("timeline.album.openDrive")}
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={closeViewer}
                  className="rounded-full bg-white/15 px-3 py-2 text-xs font-black text-white"
                >
                  {t("common.close")}
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(15rem,36svh)] gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]">
              <div
                className="otr-photo-viewer-frame relative mx-auto grid min-h-0 max-h-full max-w-full place-items-center overflow-hidden rounded-3xl bg-black"
                style={getPhotoViewerFrameStyle(activeItem.photo, activeImageSize)}
              >
                {showActiveFaceReviewStill && activeFaceReviewImageUrl ? (
                  <FallbackPhotoImage
                    src={activeFaceReviewImageUrl}
                    fallbackSrc={[
                      activeItem.photo.displayUrl,
                      activeItem.photo.displayFallbackUrl,
                    ]}
                    alt={activeItem.memory.content || t("timeline.photo.alt")}
                    className="h-full w-full object-contain"
                    onPrimaryError={() => requestRepair(activeItem.photo)}
                    onLoad={(event) =>
                      setActiveImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                ) : activeIsVideo && activeItem.photo.displayPreviewUrl ? (
                  <video
                    src={activeItem.photo.displayPreviewUrl}
                    poster={activeItem.photo.displayUrl}
                    className="h-full w-full object-contain"
                    autoPlay
                    playsInline
                    onClick={(event) => {
                      const video = event.currentTarget;
                      if (video.paused) {
                        void video.play();
                      } else {
                        video.pause();
                      }
                    }}
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      if (video.videoWidth > 0 && video.videoHeight > 0) {
                        setActiveImageSize({
                          width: video.videoWidth,
                          height: video.videoHeight,
                        });
                      }
                    }}
                  />
                ) : (
                  <FallbackPhotoImage
                    src={activeItem.photo.displayPreviewUrl ?? activeItem.photo.displayUrl}
                    fallbackSrc={[
                      activeItem.photo.displayUrl,
                      activeItem.photo.displayFallbackUrl,
                    ]}
                    alt={activeItem.memory.content || t("timeline.photo.alt")}
                    className="h-full w-full object-contain"
                    onPrimaryError={() => requestRepair(activeItem.photo)}
                    onLoad={(event) =>
                      setActiveImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                )}
                {canRenderActiveFaceBoxes
                  ? activeItem.faces.map((face) => {
                      const boxStyle = getFaceBoxStyle(
                        face,
                        activeItem.photo!,
                        activeImageSize,
                        { preferLoadedSize: !activeIsVideo || showActiveFaceReviewStill },
                      );
                      if (!boxStyle) return null;

                      const isSelected =
                        selectedFace?.assetId === activeItem.photo!.id &&
                        selectedFace.face.id === face.id;
                      const isPersonSelected =
                        Boolean(selectedPersonName) &&
                        face.recognizedName === selectedPersonName;
                      const isReviewCandidate =
                        showActiveFaceReviewStill &&
                        face.recognitionStatus !== "confirmed" &&
                        shouldShowFaceOnReviewImage(face, activeFaceReviewImageUrl);
                      const matchesReviewFrame =
                        !showActiveFaceReviewStill ||
                        shouldShowFaceOnReviewImage(face, activeFaceReviewImageUrl);
                      if (
                        !matchesReviewFrame ||
                        (!isSelected && !isPersonSelected && !isReviewCandidate)
                      ) {
                        return null;
                      }

                      const faceName =
                        face.recognizedName || t("timeline.debug.confirmFace");
                      const showFaceLabel =
                        isSelected || isPersonSelected || Boolean(face.recognizedName);

                      return (
                        <button
                          type="button"
                          key={face.id}
                          onClick={() =>
                            face.recognitionStatus === "confirmed"
                              ? setSelectedPersonName(face.recognizedName ?? null)
                              : setSelectedFace({
                                  assetId: activeItem.photo!.id,
                                  face,
                                })
                          }
                          aria-label={t("timeline.debug.selectFace", {
                            name: faceName,
                          })}
                          className={`absolute rounded-xl border-2 transition ${
                            isSelected
                              ? "border-amber-300 bg-amber-300/20"
                              : isReviewCandidate
                                ? "border-white/90 bg-black/10"
                                : "border-emerald-300 bg-emerald-300/15"
                          }`}
                          style={boxStyle}
                        >
                          {showFaceLabel ? (
                            <span
                              className={`absolute left-1 top-1 max-w-28 truncate rounded-full px-2 py-1 text-[11px] font-black shadow-sm ${
                                isSelected
                                  ? "bg-amber-300 text-stone-950"
                                  : "bg-emerald-600 text-white"
                              }`}
                            >
                              {faceName}
                            </span>
                          ) : null}
                        </button>
                      );
                    })
                  : null}
                {showActiveFaceReviewStill && activeFaceReviewImageUrls.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => switchActiveFaceReviewFrame(-1)}
                      className="absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-2xl font-black text-white shadow-sm"
                      aria-label="Previous frame"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => switchActiveFaceReviewFrame(1)}
                      className="absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-2xl font-black text-white shadow-sm"
                      aria-label="Next frame"
                    >
                      ›
                    </button>
                  </>
                ) : null}
              </div>

              <aside className="min-h-0 overflow-y-auto rounded-3xl bg-white p-3 md:p-4">
                <div className="space-y-4">
                  {activeIsVideo ? (
                    <div className="flex items-start justify-between gap-3 rounded-2xl bg-stone-50 p-2">
                      <div className="min-w-0 flex flex-wrap items-center gap-2">
                        {activeItem.peopleNames.length > 0 ? (
                          activeItem.peopleNames.map((name) => {
                            const active = selectedPersonName === name;

                            return (
                              <button
                                type="button"
                                key={name}
                                onClick={() => {
                                  setSelectedFace(null);
                                  setConfirmError(null);
                                  setSelectedPersonName((current) =>
                                    current === name ? null : name,
                                  );
                                }}
                                className={`rounded-full px-3 py-1 text-xs font-black ${
                                  active
                                    ? "bg-emerald-700 text-white"
                                    : "bg-emerald-100 text-emerald-900"
                                }`}
                              >
                                {name}
                              </button>
                            );
                          })
                        ) : (
                          <span className="text-sm font-semibold text-stone-500">
                            {t("timeline.album.noPeople")}
                          </span>
                        )}
                        {activeItem.hasUnassignedFaces ? (
                          <button
                            type="button"
                            onClick={toggleFaceAssignment}
                            aria-pressed={isActiveFaceAssignmentOpen}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black ${
                              isActiveFaceAssignmentOpen
                                ? "bg-stone-950 text-white"
                                : "bg-amber-300 text-stone-950"
                            }`}
                          >
                            {isActiveFaceAssignmentOpen
                              ? t("common.close")
                              : t("timeline.album.assignFaces")}
                          </button>
                        ) : null}
                      </div>
                      {canDeleteActivePhoto ? (
                        <button
                          type="button"
                          onClick={deleteActivePhoto}
                          disabled={isDeletingPhoto}
                          className="shrink-0 rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50"
                        >
                          {isDeletingPhoto ? "删除中" : "删除视频"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {activeIsVideo && !showActiveFaceReviewStill ? (
                    <VideoInfoPanel asset={activeItem.photo} />
                  ) : null}

                  {!activeIsVideo ? (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                          {t("timeline.album.people")}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {activeItem.peopleNames.length > 0 ? (
                            activeItem.peopleNames.map((name) => {
                              const active = selectedPersonName === name;

                              return (
                                <button
                                  type="button"
                                  key={name}
                                  onClick={() => {
                                    setSelectedFace(null);
                                    setConfirmError(null);
                                    setSelectedPersonName((current) =>
                                      current === name ? null : name,
                                    );
                                  }}
                                  className={`rounded-full px-3 py-1 text-xs font-black ${
                                    active
                                      ? "bg-emerald-700 text-white"
                                      : "bg-emerald-100 text-emerald-900"
                                  }`}
                                >
                                  {name}
                                </button>
                              );
                            })
                          ) : (
                            <span className="text-sm font-semibold text-stone-500">
                              {t("timeline.album.noPeople")}
                            </span>
                          )}
                          {activeItem.hasUnassignedFaces ? (
                            <button
                              type="button"
                              onClick={toggleFaceAssignment}
                              aria-pressed={isActiveFaceAssignmentOpen}
                              className={`rounded-full px-3 py-1.5 text-xs font-black ${
                                isActiveFaceAssignmentOpen
                                  ? "bg-stone-950 text-white"
                                  : "bg-amber-300 text-stone-950"
                              }`}
                            >
                              {isActiveFaceAssignmentOpen
                                ? t("common.close")
                                : t("timeline.album.assignFaces")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {canDeleteActivePhoto ? (
                        <button
                          type="button"
                          onClick={deleteActivePhoto}
                          disabled={isDeletingPhoto}
                          className="shrink-0 rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50"
                        >
                          {isDeletingPhoto ? "删除中" : "删除图片"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {deletePhotoError ? (
                    <p className="text-xs font-semibold text-red-700">
                      {deletePhotoError}
                    </p>
                  ) : null}

                  {isActiveFaceAssignmentOpen && selectedFace ? (
                    <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                          {t("timeline.debug.confirmFace")}
                        </p>
                        <h4 className="mt-1 text-lg font-semibold text-stone-950">
                          {t("timeline.debug.whoIsThis")}
                        </h4>
                        </div>
                        <button
                          type="button"
                          onClick={closeFaceAssignment}
                          className="rounded-full bg-white px-3 py-2 text-xs font-black text-stone-700 shadow-sm"
                        >
                          {t("common.close")}
                        </button>
                      </div>
                        {confirmError ? (
                          <p className="mt-2 text-xs font-semibold text-red-700">
                            {confirmError}
                          </p>
                        ) : null}
                        <FaceMemberChooser
                          members={members}
                          selectedFaceId={selectedFace.face.id}
                          confirmingFaceId={confirmingFaceId}
                          onConfirm={confirmFace}
                        />
                        <GuestFaceNameForm
                          faceId={selectedFace.face.id}
                          confirmingFaceId={confirmingFaceId}
                          onSubmit={confirmGuestFace}
                        />
                      </div>
                    ) : null}
                  </div>
                </aside>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function getFaceBoxStyle(
  face: PhotoFace,
  photo: PhotoAssetWithMemory,
  loadedImageSize?: ImagePixelSize | null,
  options?: { preferLoadedSize?: boolean },
): CSSProperties | null {
  const sourceWidth =
    (options?.preferLoadedSize ? loadedImageSize?.width : null) ??
    getBoundingBoxNumber(face.boundingBox, "sourceWidth", "source_width") ??
    loadedImageSize?.width ??
    photo.width ??
    0;
  const sourceHeight =
    (options?.preferLoadedSize ? loadedImageSize?.height : null) ??
    getBoundingBoxNumber(face.boundingBox, "sourceHeight", "source_height") ??
    loadedImageSize?.height ??
    photo.height ??
    0;
  const x = getBoundingBoxNumber(face.boundingBox, "x");
  const y = getBoundingBoxNumber(face.boundingBox, "y");
  const width = getBoundingBoxNumber(face.boundingBox, "width");
  const height = getBoundingBoxNumber(face.boundingBox, "height");

  if (
    !sourceWidth ||
    !sourceHeight ||
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const left = clampPercent((x / sourceWidth) * 100);
  const top = clampPercent((y / sourceHeight) * 100);
  const boxWidth = Math.max(0, Math.min(100 - left, (width / sourceWidth) * 100));
  const boxHeight = Math.max(
    0,
    Math.min(100 - top, (height / sourceHeight) * 100),
  );

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${boxWidth}%`,
    height: `${boxHeight}%`,
  };
}

function getBoundingBoxNumber(
  boundingBox: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = boundingBox[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function getPhotoViewerFrameStyle(
  photo: PhotoAssetWithMemory,
  loadedImageSize?: ImagePixelSize | null,
): CSSProperties {
  const { width, height } = getDisplayDimensions(photo, loadedImageSize);

  return {
    aspectRatio: `${width} / ${height}`,
    "--otr-photo-ratio": String(width / height),
  } as CSSProperties;
}

function FallbackPhotoImage({
  src,
  fallbackSrc,
  alt,
  className,
  loading = "lazy",
  fetchPriority,
  onPrimaryError,
  onLoad,
}: {
  src: string;
  fallbackSrc?: string | (string | null | undefined)[];
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  onPrimaryError?: () => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  const sources = useMemo(
    () =>
      [
        src,
        ...(Array.isArray(fallbackSrc) ? fallbackSrc : [fallbackSrc]),
      ].filter((value, index, values): value is string =>
        Boolean(value) && values.indexOf(value) === index,
      ),
    [fallbackSrc, src],
  );
  const sourceKey = sources.join("\n");
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [sourceKey]);

  if (!sources[sourceIndex]) {
    return (
      <div className="grid h-full w-full place-items-center bg-stone-100 text-sm font-semibold text-stone-400">
        No preview
      </div>
    );
  }

  const currentSrc = sources[sourceIndex];

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={currentSrc}
      alt={alt}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      className={className}
      onLoad={onLoad}
      onError={() => {
        if (sourceIndex === 0) {
          onPrimaryError?.();
        }
        setSourceIndex((index) => index + 1);
      }}
    />
  );
}

function MediaAssetPoster({
  asset,
  alt,
  className,
  loading = "lazy",
  fetchPriority,
  onPrimaryError,
  onLoad,
}: {
  asset: PhotoAssetWithMemory;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  onPrimaryError?: () => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  const thumbnailUrls = videoThumbnailUrls(asset);
  const [thumbnailIndex, setThumbnailIndex] = useState(0);
  const isVideo = isVideoAsset(asset);
  const posterSrc =
    isVideo && thumbnailUrls.length > 0
      ? thumbnailUrls[thumbnailIndex % thumbnailUrls.length]
      : asset.displayUrl;

  useEffect(() => {
    if (!isVideo || thumbnailUrls.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setThumbnailIndex((current) => (current + 1) % thumbnailUrls.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [isVideo, thumbnailUrls.length]);

  if (!posterSrc) {
    return (
      <div className="grid h-full w-full place-items-center bg-stone-100 text-3xl">
        {isVideo ? "VIDEO" : "PHOTO"}
      </div>
    );
  }

  return (
    <FallbackPhotoImage
      src={posterSrc}
      fallbackSrc={[asset.displayUrl, asset.displayFallbackUrl]}
      alt={alt}
      className={className}
      loading={loading}
      fetchPriority={fetchPriority}
      onPrimaryError={onPrimaryError}
      onLoad={onLoad}
    />
  );
}

function VideoPlayBadge() {
  return (
    <>
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="grid size-11 place-items-center rounded-full bg-stone-950/70 text-sm font-black text-white shadow-lg">
          ▶
        </span>
      </span>
      <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-stone-950/75 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
        VIDEO
      </span>
    </>
  );
}

function VideoInfoPanel({ asset }: { asset: PhotoAssetWithMemory }) {
  const video = getRecord(asset.aiMetadata?.video);
  const metadata = getRecord(video?.metadata);
  const capture2 = getRecord(asset.aiMetadata?.capture2);
  const preview = getRecord(video?.preview);
  const thumbnail = getRecord(video?.thumbnail);
  const thumbnails = video?.thumbnails;

  const width = getMetadataNumber(metadata, "width") ?? asset.width;
  const height = getMetadataNumber(metadata, "height") ?? asset.height;
  const duration =
    getMetadataNumber(metadata, "duration_seconds") ??
    getMetadataNumber(capture2, "durationSeconds");
  const originalSize =
    asset.originalFileSize ?? getMetadataNumber(capture2, "fileSizeBytes");
  const previewSize =
    getMetadataNumber(preview, "file_size") ?? asset.compressedFileSize;
  const thumbnailSize =
    getMetadataNumber(thumbnail, "file_size") ?? asset.thumbnailSize ?? null;
  const thumbnailCount = Array.isArray(thumbnails) ? thumbnails.length : null;
  const fps = getMetadataNumber(metadata, "fps");
  const rotation = getMetadataNumber(metadata, "rotation");
  const hasAudio = getMetadataBoolean(metadata, "has_audio");
  const previewDuration = asset.previewUrl ? "0:03" : null;
  const displayDimensions =
    width && height ? getDisplayDimensions({ ...asset, width, height }) : null;
  const resolution = displayDimensions
    ? `${Math.round(displayDimensions.width)} x ${Math.round(displayDimensions.height)}${
        rotation ? ` · ${rotation}°` : ""
      }`
    : null;

  const rows = [
    ["分辨率", resolution],
    ["长度", formatDuration(duration)],
    ["原文件大小", formatFileSize(originalSize)],
    ["格式", asset.mimeType],
    ["帧率", fps ? `${fps.toFixed(fps >= 10 ? 0 : 1)} fps` : null],
    ["音频", hasAudio === null ? null : hasAudio ? "有" : "无"],
    [
      "预览",
      [previewDuration, formatFileSize(previewSize)].filter(Boolean).join(" · ") || null,
    ],
    [
      "缩略图",
      [
        thumbnailCount ? `${thumbnailCount} 张` : null,
        formatFileSize(thumbnailSize),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    ],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (rows.length === 0) return null;

  return (
    <div className="rounded-3xl border border-stone-100 bg-stone-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
        视频信息
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-1.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-stone-100 bg-white px-3 py-2"
          >
            <dt className="shrink-0 whitespace-nowrap text-[11px] font-black text-stone-500">
              {label}
            </dt>
            <dd className="min-w-0 truncate whitespace-nowrap text-right text-xs font-black leading-5 text-stone-950 sm:text-sm">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function useDriveThumbnailRepair(tripId: string) {
  const repairRequestedAssetIdsRef = useRef<Set<string>>(new Set());

  return useCallback(
    (photo?: PhotoAssetWithMemory | null) => {
      if (!photo?.thumbnailDriveFileId) return;
      if (repairRequestedAssetIdsRef.current.has(photo.id)) return;
      repairRequestedAssetIdsRef.current.add(photo.id);
      void requestDriveThumbnailRepairForAssets([photo.id], tripId);
    },
    [tripId],
  );
}

function PhotoGalleryView({
  photos,
  facesByAssetId,
  members,
  tripId,
  targetAssetId,
  onFaceConfirmed,
}: {
  photos: PhotoAssetWithMemory[];
  facesByAssetId: Record<string, PhotoFace[]>;
  members: JourneyMember[];
  tripId: string;
  targetAssetId?: string | null;
  onFaceConfirmed: (assetId: string, face: PhotoFace) => void;
}) {
  const { locale, t } = useI18n();
  const targetPhotoRef = useRef<HTMLElement | null>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [activeFacePhotoId, setActiveFacePhotoId] = useState<string | null>(null);
  const [selectedFace, setSelectedFace] = useState<{
    assetId: string;
    face: PhotoFace;
  } | null>(null);
  const [confirmingFaceId, setConfirmingFaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRepair = useDriveThumbnailRepair(tripId);

  async function indexPhoto(photo: PhotoAssetWithMemory) {
    setActivePhotoId(photo.id);
    setError(null);

    try {
      await createBackgroundJob({
        journeyId: tripId,
        jobType: "image_indexing",
        title: photo.memory?.content || "Image indexing",
        currentStep: "Queued",
        payload: { tripId, mediaAssetId: photo.id, locale },
      });
    } catch (indexError) {
      setError(
        indexError instanceof Error
          ? indexError.message
          : t("timeline.debug.error.queuePhoto"),
      );
    } finally {
      setActivePhotoId(null);
    }
  }

  async function indexPendingPhotos() {
    const pending = photos.filter(
      (photo) =>
        photo.assetType === "image" &&
        (photo.aiStatus === "pending" || photo.aiStatus === "failed"),
    );

    for (const photo of pending) {
      await indexPhoto(photo);
    }
  }

  async function detectFaces(photo: PhotoAssetWithMemory) {
    setActiveFacePhotoId(photo.id);
    setError(null);

    try {
      await createBackgroundJob({
        journeyId: tripId,
        jobType: "face_detection",
        title: "Face detection",
        currentStep: "Queued",
        payload: { tripId, mediaAssetId: photo.id },
      });
    } catch (faceError) {
      setError(
        faceError instanceof Error
          ? faceError.message
          : t("timeline.debug.error.queueFace"),
      );
    } finally {
      setActiveFacePhotoId(null);
    }
  }

  async function confirmFace(member: JourneyMember) {
    if (!selectedFace) return;

    setConfirmingFaceId(selectedFace.face.id);
    setError(null);

    try {
      const updated = await requestFaceConfirmation({
        faceId: selectedFace.face.id,
        tripId,
        journeyMemberId: member.id,
      });
      onFaceConfirmed(selectedFace.assetId, updated);
      setSelectedFace(null);
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : t("timeline.debug.error.confirmFace"),
      );
    } finally {
      setConfirmingFaceId(null);
    }
  }

  const indexedCount = photos.filter((photo) => photo.aiStatus === "indexed").length;
  const driveCount = photos.filter((photo) => photo.isOriginalPreserved).length;

  useEffect(() => {
    if (!targetAssetId) return;

    const timer = window.setTimeout(() => {
      targetPhotoRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);

    return () => window.clearTimeout(timer);
  }, [photos, targetAssetId]);

  return (
    <section className="space-y-5">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">
              {t("timeline.debug.photoAlbum")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">
              {t("timeline.debug.uploadedPhotos", { count: photos.length })}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {t("timeline.debug.driveIndexed", { driveCount, indexedCount })}
            </p>
          </div>
          <button
            type="button"
            onClick={indexPendingPhotos}
            disabled={activePhotoId !== null || photos.length === indexedCount}
            className="rounded-full bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {activePhotoId
              ? t("timeline.debug.indexing")
              : t("timeline.debug.indexPending")}
          </button>
        </div>
        {error ? (
          <div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      {photos.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-6 text-sm leading-6 text-stone-600">
          {t("timeline.debug.noUploaded")}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {photos.map((photo, index) => {
            const summary = getAiSummary(photo);
            const aiError = getAiError(photo);
            const locationHints = getLocationHints(photo);
            const modelInfo = getAiModelInfo(photo);
            const faces = facesByAssetId[photo.id] ?? [];
            const driveUrl = getMediaAssetDriveUrl(photo);
          const capturedAt = photo.memory?.capturedAt
            ? new Date(photo.memory.capturedAt)
            : new Date(photo.createdAt);

          return (
            <article
              key={photo.id}
              id={`photo-${photo.id}`}
              ref={photo.id === targetAssetId ? targetPhotoRef : null}
              className={`overflow-hidden rounded-3xl bg-white shadow-sm ${
                photo.id === targetAssetId
                  ? "ring-4 ring-amber-300 ring-offset-4 ring-offset-stone-50"
                  : ""
              }`}
            >
              <div
                className="relative bg-stone-100"
                style={{
                  aspectRatio:
                    photo.width && photo.height
                      ? `${photo.width} / ${photo.height}`
                      : "4 / 3",
                }}
              >
                {photo.displayUrl ? (
                  <MediaAssetPoster
                    asset={photo}
                    alt={photo.memory?.content || t("timeline.photo.alt")}
                    className="h-full w-full object-cover"
                    loading={index < 12 ? "eager" : "lazy"}
                    fetchPriority={index < 12 ? "high" : "auto"}
                    onPrimaryError={() => requestRepair(photo)}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-sm font-semibold text-stone-400">
                    {t("timeline.debug.noPreview")}
                  </div>
                )}
                {isVideoAsset(photo) ? <VideoPlayBadge /> : null}
                {faces.map((face, index) => {
                  const boxStyle = getFaceBoxStyle(face, photo);
                  if (!boxStyle) return null;

                  const faceName =
                    face.recognizedName ||
                    t("timeline.debug.face", { number: index + 1 });
                  const isSelected =
                    selectedFace?.assetId === photo.id &&
                    selectedFace.face.id === face.id;
                  const isConfirmed = face.recognitionStatus === "confirmed";
                  const isRecognized = face.recognitionStatus === "recognized";

                  return (
                    <button
                      type="button"
                      key={face.id}
                      onClick={() => setSelectedFace({ assetId: photo.id, face })}
                      aria-label={t("timeline.debug.selectFace", {
                        name: faceName,
                      })}
                      className={`absolute rounded-xl border-2 transition ${
                        isSelected
                          ? "border-amber-400 bg-amber-300/20 shadow-[0_0_0_4px_rgba(251,191,36,0.28)]"
                          : isConfirmed
                            ? "border-emerald-300 bg-emerald-300/15 shadow-[0_0_0_3px_rgba(16,185,129,0.22)]"
                            : isRecognized
                              ? "border-sky-300 bg-sky-300/15 shadow-[0_0_0_3px_rgba(14,165,233,0.22)]"
                              : "border-white bg-white/10 shadow-[0_0_0_3px_rgba(0,0,0,0.18)]"
                      }`}
                      style={boxStyle}
                    >
                      <span
                        className={`absolute left-1 top-1 max-w-32 truncate rounded-full px-2 py-1 text-[11px] font-black shadow-sm ${
                          isSelected
                            ? "bg-amber-400 text-stone-950"
                            : isConfirmed
                              ? "bg-emerald-600 text-white"
                              : isRecognized
                                ? "bg-sky-600 text-white"
                                : "bg-white text-stone-900"
                        }`}
                      >
                        {isRecognized
                          ? t("timeline.debug.maybeFace", { name: faceName })
                          : faceName}
                      </span>
                    </button>
                  );
                })}
                <span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-bold capitalize text-stone-800">
                  {photo.aiStatus ?? "pending"}
                </span>
              </div>

              <div className="space-y-4 p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
                    {capturedAt.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    ·{" "}
                    {capturedAt.toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  {photo.memory?.content ? (
                    <h3 className="mt-2 text-lg font-semibold text-stone-950">
                      {photo.memory.content}
                    </h3>
                  ) : null}
                  {photo.memory?.locationName ? (
                    <p className="mt-1 text-sm text-stone-500">
                      {photo.memory.locationName}
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-stone-600">
                  <span className="rounded-2xl bg-stone-50 p-3">
                    {photo.width ?? "?"} x {photo.height ?? "?"}
                  </span>
                  <span className="rounded-2xl bg-stone-50 p-3">
                    {t("timeline.debug.compressed", {
                      size: formatBytes(photo.compressedFileSize),
                    })}
                  </span>
                  <span className="rounded-2xl bg-stone-50 p-3">
                    {t("timeline.debug.original", {
                      size: formatBytes(photo.originalFileSize),
                    })}
                  </span>
                  <span className="rounded-2xl bg-stone-50 p-3">
                    {photo.isOriginalPreserved
                      ? t("timeline.debug.drivePreserved")
                      : t("timeline.debug.noOriginal")}
                  </span>
                  <span className="rounded-2xl bg-stone-50 p-3">
                    {t("timeline.debug.facesDetected", { count: faces.length })}
                  </span>
                </div>

                {faces.length > 0 ? (
                  <div className="rounded-2xl bg-stone-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
                      {t("timeline.debug.faces")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {faces.map((face, index) => (
                        (() => {
                          const isSelected =
                            selectedFace?.assetId === photo.id &&
                            selectedFace.face.id === face.id;

                          return (
                            <button
                              type="button"
                              key={face.id}
                              onClick={() =>
                                setSelectedFace({ assetId: photo.id, face })
                              }
                              className={`rounded-full px-3 py-1 text-xs font-bold shadow-sm ${
                                isSelected
                                  ? "bg-amber-300 text-stone-950 ring-2 ring-amber-500"
                                  : face.recognitionStatus === "confirmed"
                                    ? "bg-emerald-100 text-emerald-900"
                                    : face.recognitionStatus === "recognized"
                                      ? "bg-sky-100 text-sky-900"
                                      : "bg-white text-stone-700"
                              }`}
                            >
                              {face.recognitionStatus === "recognized"
                                ? t("timeline.debug.maybeFace", {
                                    name: face.recognizedName ?? "",
                                  })
                                : face.recognizedName ||
                                  t("timeline.debug.face", {
                                    number: index + 1,
                                  })}{" "}
                              ·{" "}
                              {Math.round((face.confidence ?? 0) * 100)}%
                            </button>
                          );
                        })()
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedFace?.assetId === photo.id ? (
                  <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                          {t("timeline.debug.confirmFace")}
                        </p>
                        <h4 className="mt-1 text-lg font-semibold text-stone-950">
                          {t("timeline.debug.whoIsThis")}
                        </h4>
                        <p className="mt-1 text-sm text-stone-600">
                          {t("timeline.debug.confirmFaceHelp")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedFace(null)}
                        className="rounded-full bg-white px-3 py-2 text-xs font-bold text-stone-600"
                      >
                        {t("common.close")}
                      </button>
                    </div>

                    <FaceMemberChooser
                      members={members}
                      selectedFaceId={selectedFace.face.id}
                      confirmingFaceId={confirmingFaceId}
                      onConfirm={confirmFace}
                    />
                  </div>
                ) : null}

                {summary ? (
                  <p className="rounded-2xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
                    {summary}
                  </p>
                ) : null}

                {photo.sceneTags && photo.sceneTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {photo.sceneTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {locationHints.length > 0 ? (
                  <p className="text-sm text-stone-600">
                    {t("timeline.debug.locationHints")} {locationHints.join(", ")}
                  </p>
                ) : null}

                {modelInfo ? (
                  <div className="grid gap-2 rounded-2xl bg-stone-50 p-3 text-xs font-semibold text-stone-700 sm:grid-cols-2">
                    {modelInfo.provider ? (
                      <p>
                        <span className="text-stone-500">
                          {t("timeline.debug.provider")}
                        </span>{" "}
                        {modelInfo.provider}
                      </p>
                    ) : null}
                    {modelInfo.modelUsed ? (
                      <p>
                        <span className="text-stone-500">
                          {t("timeline.debug.modelUsed")}
                        </span>{" "}
                        {modelInfo.modelUsed}
                      </p>
                    ) : null}
                    {modelInfo.model ? (
                      <p className="sm:col-span-2">
                        <span className="text-stone-500">
                          {t("timeline.debug.model")}
                        </span>{" "}
                        {modelInfo.model}
                      </p>
                    ) : null}
                    {modelInfo.confidence !== null ? (
                      <p>
                        <span className="text-stone-500">
                          {t("timeline.debug.confidence")}
                        </span>{" "}
                        {Math.round(modelInfo.confidence * 100)}%
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {photo.ocrText ? (
                  <p className="rounded-2xl bg-stone-50 p-3 text-sm leading-6 text-stone-700">
                    {t("timeline.debug.ocr")} {photo.ocrText}
                  </p>
                ) : null}

                {aiError ? (
                  <p className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                    {aiError}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => indexPhoto(photo)}
                    disabled={activePhotoId === photo.id}
                    className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {activePhotoId === photo.id
                      ? t("timeline.debug.queued")
                      : photo.aiStatus === "indexed"
                        ? t("timeline.debug.reindex")
                        : t("timeline.debug.indexPhoto")}
                  </button>
                  <button
                    type="button"
                    onClick={() => detectFaces(photo)}
                    disabled={activeFacePhotoId === photo.id}
                    className="rounded-full bg-stone-950 px-4 py-2 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {activeFacePhotoId === photo.id
                      ? t("timeline.debug.queued")
                      : faces.length > 0
                        ? t("timeline.debug.refreshFaces")
                        : t("timeline.debug.detectFaces")}
                  </button>
                  {driveUrl ? (
                    <a
                      href={driveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-800"
                    >
                      {t("timeline.debug.openOriginal")}
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TimelineContent({ user }: { user: User }) {
  const params = useParams<{ tripId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const tripId = params.tripId;
  const initialTimelineDate = searchParams.get("date");
  const requestedView = searchParams.get("view");
  const initialView = parseTimelineView(searchParams.get("view"));
  const targetAssetId = searchParams.get("asset");
  const shouldReviewFaces = searchParams.get("review") === "faces";
  const returnTo = normalizeReturnPath(searchParams.get("returnTo"));
  const initialSession = readTimelineSession(tripId);
  const [albumDeepLink, setAlbumDeepLink] = useState<AlbumDeepLink | null>(() =>
    targetAssetId
      ? {
          assetId: targetAssetId,
          reviewFaces: shouldReviewFaces,
          returnTo,
        }
      : null,
  );
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [photoAssets, setPhotoAssets] = useState<PhotoAssetWithMemory[]>([]);
  const [plannerData, setPlannerData] = useState<PlannerV2Data | null>(null);
  const [facesByAssetId, setFacesByAssetId] = useState<Record<string, PhotoFace[]>>(
    {},
  );
  const [memorySummary, setMemorySummary] = useState<TripMemorySummary | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [view, setView] = useState<TimelineView>(
    albumDeepLink?.assetId ? "album" : requestedView ? initialView : "album",
  );
  const [timelineOrder, setTimelineOrder] = useState<TimelineOrder>(
    initialSession?.timelineOrder === "uploaded" ? "uploaded" : "captured",
  );
  const [query, setQuery] = useState(initialSession?.query ?? "");
  const mineOnly = false;
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    initialSession?.selectedMemberIds ?? [],
  );
  const [isMobileSearchActive, setIsMobileSearchActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMoreMemories, setIsLoadingMoreMemories] = useState(false);
  const [nextMemoryCursor, setNextMemoryCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePhotoItemId, setActivePhotoItemId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const memoryLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoreTimerRef = useRef<number | null>(null);

  const loadMemoryPage = useCallback(
    async (beforeCapturedAt?: string | null) => {
      const memoryPage = await getTripMemoriesPage(tripId, {
        limit: TIMELINE_MEMORY_PAGE_SIZE,
        beforeCapturedAt,
      });
      const memoryIds = memoryPage.memories.map((memory) => memory.id);
      const [memoryAssetData, videoAssets] = await Promise.all([
        getMediaAssetsByMemoryIds(memoryIds),
        beforeCapturedAt ? Promise.resolve([]) : getTripVideoAssets(tripId),
      ]);
      const [signedUrls, legacyUrlsByAssetId, faceData] = await Promise.all([
        getSignedMemoryImageUrls(memoryPage.memories),
        getMediaAssetLegacySignedUrlById(memoryAssetData),
        getPhotoFacesForAssets(
          [...memoryAssetData, ...videoAssets].map((asset) => asset.id),
        ),
      ]);
      const memoryAssetIds = new Set(memoryAssetData.map((asset) => asset.id));
      const memoryById = new Map(
        memoryPage.memories.map((memory) => [memory.id, memory]),
      );
      const photoAssetsForPage: PhotoAssetWithMemory[] = [
        ...memoryAssetData.map((asset) => {
          return {
            ...asset,
            memory: memoryById.get(asset.memoryEntryId) ?? null,
            displayUrl: getMediaAssetDisplayUrl(asset),
            displayPreviewUrl: getMediaAssetPreviewUrl(asset),
            displayFallbackUrl: legacyUrlsByAssetId[asset.id],
          };
        }),
        ...videoAssets.filter((asset) => !memoryAssetIds.has(asset.id)),
      ];
      return { memoryPage, assetData: photoAssetsForPage, signedUrls, faceData };
    },
    [tripId],
  );

  const refreshMemorySnapshot = useCallback(async () => {
    await repairCurrentUserOrphanPhotoMemories(tripId).catch(() => 0);
    const { memoryPage, assetData, signedUrls, faceData } = await loadMemoryPage();
    setMemories(memoryPage.memories);
    setPhotoAssets(assetData);
    setFacesByAssetId(faceData);
    setImageUrls(signedUrls);
    setNextMemoryCursor(memoryPage.nextCursor);
  }, [loadMemoryPage, tripId]);

  const timelineResource = useJourneyCachedResource({
    cacheKey: journeyResourceKey.timeline(tripId),
    loader: () => loadJourneyTimelineResource(tripId),
    ttl: 2 * 60_000,
    staleTime: 20_000,
    keepPreviousData: true,
    backgroundRefresh: true,
  });

  useEffect(() => {
    if (!targetAssetId) return;
    setAlbumDeepLink({
      assetId: targetAssetId,
      reviewFaces: shouldReviewFaces,
      returnTo,
    });
    setView("album");
  }, [returnTo, shouldReviewFaces, targetAssetId]);

  const clearAlbumDeepLinkParams = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    let changed = false;

    for (const key of ["asset", "review", "returnTo"]) {
      if (nextParams.has(key)) {
        nextParams.delete(key);
        changed = true;
      }
    }

    if (!changed) return;

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const data = timelineResource.data;
    if (!data) return;
    setMemories(data.memoryPage.memories);
    setPhotoAssets(data.assetData);
    setPlannerData(data.plannerData);
    setFacesByAssetId(data.faceData);
    setMemorySummary(data.memorySummary);
    setMembers(data.memberData);
    setImageUrls(data.signedUrls);
    setNextMemoryCursor(data.memoryPage.nextCursor);
    setIsLoading(false);
    setError(null);
  }, [timelineResource.data]);

  useEffect(() => {
    if (!timelineResource.error || timelineResource.data) return;
    setError(
      timelineResource.error instanceof Error
        ? timelineResource.error.message
        : t("timeline.error.load"),
    );
    setIsLoading(false);
  }, [timelineResource.data, timelineResource.error, t]);

  useEffect(() => {
    let refreshTimer: number | null = null;

    const scheduleRefresh = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }

      refreshTimer = window.setTimeout(() => {
        refreshMemorySnapshot().catch((refreshError) => {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : t("timeline.error.load"),
          );
        });
      }, 350);
    };

    const channel = supabase
      .channel(`timeline-refresh:${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "memory_entries",
          filter: `trip_id=eq.${tripId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "media_assets",
          filter: `trip_id=eq.${tripId}`,
        },
        scheduleRefresh,
      )
      .subscribe();

    window.addEventListener("otr:capture-completed", scheduleRefresh);
    window.addEventListener("otr:memory-created", scheduleRefresh);
    window.addEventListener("otr:background-jobs-changed", scheduleRefresh);
    window.addEventListener("otr:photo-upload-completed", scheduleRefresh);
    window.addEventListener("otr:capture2-changed", scheduleRefresh);

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener("otr:capture-completed", scheduleRefresh);
      window.removeEventListener("otr:memory-created", scheduleRefresh);
      window.removeEventListener("otr:background-jobs-changed", scheduleRefresh);
      window.removeEventListener("otr:photo-upload-completed", scheduleRefresh);
      window.removeEventListener("otr:capture2-changed", scheduleRefresh);
      void supabase.removeChannel(channel);
    };
  }, [refreshMemorySnapshot, t, tripId]);

  function getSavedScrollY(nextView: TimelineView) {
    const latestSession = readTimelineSession(tripId) ?? initialSession;
    const savedForView = latestSession?.scrollByView?.[nextView];
    if (typeof savedForView === "number") return savedForView;
    if (latestSession?.view === nextView && typeof latestSession.scrollY === "number") {
      return latestSession.scrollY;
    }
    return 0;
  }

  function saveCurrentViewScroll(nextView = view) {
    writeTimelineSession(tripId, {
      scrollY: window.scrollY,
      scrollByView: { [nextView]: window.scrollY },
    });
  }

  useEffect(() => {
    if (targetAssetId) return;
    if (view === "timeline") return;
    if (scrollRestoreTimerRef.current !== null) {
      window.clearTimeout(scrollRestoreTimerRef.current);
    }

    scrollRestoreTimerRef.current = window.setTimeout(() => {
      window.scrollTo({ top: Math.max(0, getSavedScrollY(view)), behavior: "instant" });
    }, 120);

    return () => {
      if (scrollRestoreTimerRef.current !== null) {
        window.clearTimeout(scrollRestoreTimerRef.current);
        scrollRestoreTimerRef.current = null;
      }
    };
  }, [isLoading, targetAssetId, view]);

  useEffect(() => {
    writeTimelineSession(tripId, { view, timelineOrder, query, selectedMemberIds });
  }, [query, selectedMemberIds, timelineOrder, tripId, view]);

  useEffect(() => {
    let saveTimer: number | null = null;

    const saveScroll = () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }

      saveTimer = window.setTimeout(() => {
        saveCurrentViewScroll();
      }, 180);
    };

    const saveImmediately = () => {
      saveCurrentViewScroll();
    };

    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", saveImmediately);
    document.addEventListener("visibilitychange", saveImmediately);

    return () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }
      saveImmediately();
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", saveImmediately);
      document.removeEventListener("visibilitychange", saveImmediately);
    };
  }, [tripId, view]);

  const timelineItems = useMemo(
    () =>
      getTimelineItems({
        memories,
        photoAssets,
        facesByAssetId,
        imageUrls,
        members,
        plannerLinks: buildPlannerLinkIndex(plannerData, tripId),
      }),
    [facesByAssetId, imageUrls, memories, members, photoAssets, plannerData, tripId],
  );
  const filteredItems = useMemo(
    () =>
      getFilteredItems({
        items: timelineItems,
        query,
        mineOnly,
        selectedMemberIds,
        currentUser: user,
        members,
      }),
    [members, mineOnly, query, selectedMemberIds, timelineItems, user],
  );
  const filteredPhotos = useMemo(() => {
    const allowedMemoryIds = new Set(filteredItems.map((item) => item.id));
    const allowedAssetIds = new Set(
      filteredItems
        .map((item) => item.photo?.id)
        .filter((id): id is string => Boolean(id)),
    );
    return photoAssets.filter(
      (photo) =>
        allowedMemoryIds.has(photo.memoryEntryId) || allowedAssetIds.has(photo.id),
    );
  }, [filteredItems, photoAssets]);
  const loadedPhotoMemoryCount = useMemo(
    () =>
      new Set(
        photoAssets
          .map((photo) => photo.memoryEntryId)
          .filter((memoryId): memoryId is string => Boolean(memoryId)),
      ).size,
    [photoAssets],
  );
  const hasLoadedAllAlbumPhotos =
    memorySummary !== null && loadedPhotoMemoryCount >= memorySummary.photos;
  const favoriteItems = useMemo(
    () => filteredItems.filter((item) => item.memory.isFavorited),
    [filteredItems],
  );
  const flattenedVisibleItems = useMemo(
    () => flattenTimelineItems(filteredItems),
    [filteredItems],
  );
  const activePhotoItem =
    flattenedVisibleItems.find((item) => item.id === activePhotoItemId) ?? null;
  const suppressImmersiveUntilRef = useRef(0);
  const userScrollInputUntilRef = useRef(0);

  function suppressImmersiveSwitch() {
    suppressImmersiveUntilRef.current = Date.now() + 1500;
  }

  useEffect(() => {
    if (!isMobileSearchActive) return;

    document.body.classList.add("otr-mobile-search-active");

    return () => {
      document.body.classList.remove("otr-mobile-search-active");
    };
  }, [isMobileSearchActive]);

  function isMobileViewport() {
    return window.matchMedia("(max-width: 767px)").matches;
  }

  function openMobileSearchFromPointer(event: PointerEvent<HTMLInputElement>) {
    if (!isMobileViewport() || isMobileSearchActive) return;
    event.preventDefault();
    flushSync(() => setIsMobileSearchActive(true));
    searchInputRef.current?.focus({ preventScroll: true });
  }

  function openMobileSearchFromFocus() {
    if (isMobileViewport()) {
      setIsMobileSearchActive(true);
    }
  }

  useEffect(() => {
    document.body.classList.remove("otr-album-immersive");
    if (!["album", "timeline", "favorites"].includes(view) || isMobileSearchActive) {
      return;
    }

    let previousY = window.scrollY;
    let isImmersive = false;
    let scrollIntent = 0;

    const setImmersive = (enabled: boolean) => {
      if (isImmersive === enabled) return;
      isImmersive = enabled;
      document.body.classList.toggle("otr-album-immersive", enabled);
    };

    const markUserScrollInput = () => {
      userScrollInputUntilRef.current = Date.now() + 1200;
    };

    const handleScroll = () => {
      if (window.innerWidth >= 768) {
        setImmersive(false);
        previousY = window.scrollY;
        return;
      }

      const currentY = window.scrollY;
      if (Date.now() < suppressImmersiveUntilRef.current) {
        previousY = currentY;
        return;
      }

      if (Date.now() > userScrollInputUntilRef.current) {
        previousY = currentY;
        return;
      }

      const delta = currentY - previousY;
      if (Math.abs(delta) < 3) return;

      if (currentY < 80) {
        setImmersive(false);
        scrollIntent = 0;
      } else if (delta > 0) {
        scrollIntent = Math.min(80, Math.max(0, scrollIntent) + delta);
        if (scrollIntent > 28) {
          setImmersive(true);
        }
      } else {
        scrollIntent = Math.max(-80, Math.min(0, scrollIntent) + delta);
        if (scrollIntent < -42) {
          setImmersive(false);
        }
      }

      previousY = currentY;
    };

    window.addEventListener("touchmove", markUserScrollInput, { passive: true });
    window.addEventListener("wheel", markUserScrollInput, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("touchmove", markUserScrollInput);
      window.removeEventListener("wheel", markUserScrollInput);
      window.removeEventListener("scroll", handleScroll);
      document.body.classList.remove("otr-album-immersive");
    };
  }, [isMobileSearchActive, view]);

  useEffect(() => {
    function updateDateStripTop() {
      const toolbar = document.querySelector<HTMLElement>(".otr-timeline-toolbar");
      const bottom = toolbar?.getBoundingClientRect().bottom ?? 0;
      document.documentElement.style.setProperty(
        "--otr-timeline-date-strip-top",
        `${Math.max(0, bottom)}px`,
      );
    }

    updateDateStripTop();
    const toolbar = document.querySelector<HTMLElement>(".otr-timeline-toolbar");
    const observer =
      typeof ResizeObserver === "undefined" || !toolbar
        ? null
        : new ResizeObserver(updateDateStripTop);
    if (toolbar) {
      observer?.observe(toolbar);
    }
    window.addEventListener("scroll", updateDateStripTop, { passive: true });
    window.addEventListener("resize", updateDateStripTop);

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", updateDateStripTop);
      window.removeEventListener("resize", updateDateStripTop);
      document.documentElement.style.removeProperty("--otr-timeline-date-strip-top");
    };
  }, [isMobileSearchActive, selectedMemberIds.length, query, timelineOrder, view]);

  function closeMobileSearch() {
    setQuery("");
    setIsMobileSearchActive(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function switchView(nextView: TimelineView) {
    if (nextView === view) return;
    saveCurrentViewScroll(view);
    setView(nextView);
  }

  function switchTimelineOrder(nextOrder: TimelineOrder) {
    if (nextOrder === timelineOrder) return;
    suppressImmersiveSwitch();
    setTimelineOrder(nextOrder);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleMember(memberId: string) {
    suppressImmersiveSwitch();
    setSelectedMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  }

  function handleFaceConfirmed(assetId: string, face: PhotoFace) {
    setFacesByAssetId((current) => ({
      ...current,
      [assetId]: (current[assetId] ?? []).map((item) =>
        item.id === face.id ? face : item,
      ),
    }));
  }

  async function handleSaveMemory(
    memoryId: string,
    input: { content: string; locationName: string; capturedAt: string },
  ) {
    const updated = await updateMemoryEntry({
      memoryId,
      content: input.content,
      locationName: input.locationName,
      capturedAt: input.capturedAt,
    });

    setMemories((current) =>
      current.map((memory) =>
        memory.id === memoryId
          ? {
              ...memory,
              ...updated,
              contributorName: memory.contributorName,
              contributorAvatarUrl: memory.contributorAvatarUrl,
            }
          : memory,
      ),
    );
  }

  async function handleDeleteMemory(memoryId: string) {
    await deleteMemoryEntry(memoryId);
    setMemories((current) => current.filter((memory) => memory.id !== memoryId));
    setPhotoAssets((current) =>
      current.filter((photo) => photo.memoryEntryId !== memoryId),
    );
  }

  async function handleDeleteAsset(assetId: string) {
    await deleteMediaAsset(assetId);
    setPhotoAssets((current) => current.filter((photo) => photo.id !== assetId));
    setFacesByAssetId((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }

  function handleMemoryEngagementChange(
    memoryId: string,
    engagement: MemoryEngagement,
  ) {
    setMemories((current) =>
      current.map((memory) =>
        memory.id === memoryId ? { ...memory, ...engagement } : memory,
      ),
    );
  }

  const loadMoreMemories = useCallback(async () => {
    if (!nextMemoryCursor || isLoadingMoreMemories) return;

    setIsLoadingMoreMemories(true);
    setError(null);
    try {
      const { memoryPage, assetData, signedUrls, faceData } =
        await loadMemoryPage(nextMemoryCursor);
      const existingMemoryIds = new Set(memories.map((memory) => memory.id));
      const nextMemories = memoryPage.memories.filter(
        (memory) => !existingMemoryIds.has(memory.id),
      );
      const existingAssetIds = new Set(photoAssets.map((asset) => asset.id));
      const nextAssets = assetData.filter((asset) => !existingAssetIds.has(asset.id));
      setMemories((current) => {
        const currentIds = new Set(current.map((memory) => memory.id));
        return [
          ...current,
          ...nextMemories.filter((memory) => !currentIds.has(memory.id)),
        ];
      });
      setPhotoAssets((current) => {
        const currentIds = new Set(current.map((asset) => asset.id));
        return [
          ...current,
          ...nextAssets.filter((asset) => !currentIds.has(asset.id)),
        ];
      });
      setFacesByAssetId((current) => ({ ...current, ...faceData }));
      setImageUrls((current) => ({ ...current, ...signedUrls }));
      setNextMemoryCursor(
        memoryPage.nextCursor &&
          (nextMemories.length > 0 || nextAssets.length > 0)
          ? memoryPage.nextCursor
          : null,
      );
    } catch (loadMoreError) {
      setError(getErrorMessage(loadMoreError, t("timeline.error.load")));
    } finally {
      setIsLoadingMoreMemories(false);
    }
  }, [
    isLoadingMoreMemories,
    loadMemoryPage,
    memories,
    nextMemoryCursor,
    photoAssets,
    t,
  ]);

  const shouldAutoLoadMoreMemories =
    !error &&
    Boolean(nextMemoryCursor) &&
    !(view === "album" && hasLoadedAllAlbumPhotos);

  useEffect(() => {
    if (!shouldAutoLoadMoreMemories) return;
    const target = memoryLoadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        void loadMoreMemories();
      },
      { rootMargin: "900px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMoreMemories, shouldAutoLoadMoreMemories]);

  const shouldHideTimelineDateStrip =
    isMobileSearchActive ||
    query.trim().length > 0 ||
    selectedMemberIds.length > 0 ||
    timelineOrder === "uploaded" ||
    view !== "timeline";
  const isTimelineDateStripAttached =
    view === "timeline" && !shouldHideTimelineDateStrip && filteredItems.length > 0;

  if (isLoading && !timelineResource.data && memories.length === 0) {
    return (
      <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="h-5 w-36 animate-pulse rounded bg-stone-200" />
        <div className="grid grid-cols-3 gap-2">
          <div className="aspect-square animate-pulse rounded-2xl bg-stone-100" />
          <div className="aspect-square animate-pulse rounded-2xl bg-stone-100" />
          <div className="aspect-square animate-pulse rounded-2xl bg-stone-100" />
        </div>
      </div>
    );
  }

  return (
    <div className={isTimelineDateStripAttached ? "space-y-0" : "space-y-4 sm:space-y-6"}>
      {timelineResource.error && timelineResource.data ? (
        <p className="rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
          {t("timeline.error.load")}
        </p>
      ) : null}
      <section className={isMobileSearchActive ? "hidden md:block" : undefined}>
        <h1 className="text-3xl font-semibold text-stone-950">
          {t("timeline.title")}
        </h1>
      </section>

      <div
        className={`otr-timeline-toolbar space-y-2 p-3 backdrop-blur md:sticky md:top-0 md:z-30 md:bg-stone-50/95 md:shadow-sm ${
          isMobileSearchActive
            ? "fixed inset-x-0 top-0 z-[2147482600] rounded-none border-b border-stone-200 bg-white shadow-lg md:sticky"
            : isTimelineDateStripAttached
              ? "sticky top-0 z-30 rounded-t-3xl rounded-b-none bg-stone-50/95 shadow-sm"
              : "sticky top-0 z-30 rounded-3xl bg-stone-50/95 shadow-sm"
        }`}
      >
        <div
          className={`grid-cols-3 gap-1 rounded-2xl border border-stone-200 bg-white p-1 md:grid ${
            isMobileSearchActive ? "hidden" : "grid"
          }`}
        >
          {[
            ["album", t("timeline.tab.album")],
            ["timeline", t("timeline.tab.timeline")],
            ["favorites", t("timeline.tab.favorites")],
          ].map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              onClick={() => switchView(mode as TimelineView)}
              className={`rounded-xl px-2 py-2 text-xs font-black sm:text-sm ${
                view === mode
                  ? "bg-emerald-700 text-white"
                  : "text-stone-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {view === "timeline" && !isMobileSearchActive ? (
            <div className="flex shrink-0 gap-1 rounded-full border border-stone-200 bg-white p-1">
              {[
                ["captured", t("timeline.order.captured")],
                ["uploaded", t("timeline.order.uploaded")],
              ].map(([mode, label]) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => switchTimelineOrder(mode as TimelineOrder)}
                  className={`shrink-0 rounded-full px-3 py-2 text-xs font-black sm:px-4 ${
                    timelineOrder === mode
                      ? "bg-stone-950 text-white"
                      : "text-stone-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <input
            ref={searchInputRef}
            type="search"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPointerDown={openMobileSearchFromPointer}
            onFocus={openMobileSearchFromFocus}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.currentTarget.blur();
              }
            }}
            placeholder={t("timeline.search.placeholder")}
            className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-semibold text-stone-900 outline-none focus:border-emerald-500 md:text-sm"
          />
          <button
            type="button"
            onClick={closeMobileSearch}
            className={`shrink-0 rounded-full px-3 py-2 text-sm font-black text-emerald-800 md:hidden ${
              isMobileSearchActive ? "inline-flex" : "hidden"
            }`}
          >
            {t("timeline.search.cancel")}
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {members.map((member) => {
            const active = selectedMemberIds.includes(member.id);

            return (
              <button
                type="button"
                key={member.id}
                onClick={() => toggleMember(member.id)}
                className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-black ${
                  active
                    ? "bg-emerald-700 text-white"
                    : "bg-white text-stone-700 shadow-sm"
                }`}
              >
                {member.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={member.avatarUrl}
                    alt=""
                    className="size-5 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className={`grid size-5 place-items-center rounded-full text-[10px] ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-emerald-100 text-emerald-900"
                    }`}
                  >
                    {member.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {member.displayName}
              </button>
            );
          })}
        </div>
      </div>

      {isMobileSearchActive ? <div className="h-[7.75rem] md:hidden" /> : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {!error && timelineItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          {t("timeline.empty")}
        </div>
      ) : null}

      {!error && timelineItems.length > 0 && filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          {t("timeline.empty.filtered")}
        </div>
      ) : null}

      {!error &&
      view === "favorites" &&
      filteredItems.length > 0 &&
      favoriteItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          {t("timeline.empty.favorites")}
        </div>
      ) : null}

      {view === "timeline" && timelineOrder === "captured" ? (
        <TrueTimelineView
          key={initialTimelineDate ?? "nearest"}
          items={filteredItems}
          tripId={tripId}
          currentUserId={user.id}
          initialDate={initialTimelineDate}
          onSaveMemory={handleSaveMemory}
          onDeleteMemory={handleDeleteMemory}
          onDeleteAsset={handleDeleteAsset}
          onReplyCreated={refreshMemorySnapshot}
          onEngagementChange={handleMemoryEngagementChange}
          onOpenPhoto={(item) => setActivePhotoItemId(item.id)}
          isSearchActive={isMobileSearchActive}
          hideDateStrip={shouldHideTimelineDateStrip}
          onFilterInteraction={suppressImmersiveSwitch}
        />
      ) : null}

      {view === "timeline" && timelineOrder === "uploaded" ? (
        <UploadedTimelineView
          items={filteredItems}
          tripId={tripId}
          currentUserId={user.id}
          onSaveMemory={handleSaveMemory}
          onDeleteMemory={handleDeleteMemory}
          onDeleteAsset={handleDeleteAsset}
          onReplyCreated={refreshMemorySnapshot}
          onEngagementChange={handleMemoryEngagementChange}
          onOpenPhoto={(item) => setActivePhotoItemId(item.id)}
        />
      ) : null}

      {view === "favorites" ? (
        <UploadFeedView
          items={favoriteItems}
          tripId={tripId}
          currentUserId={user.id}
          onSaveMemory={handleSaveMemory}
          onDeleteMemory={handleDeleteMemory}
          onDeleteAsset={handleDeleteAsset}
          onReplyCreated={refreshMemorySnapshot}
          onEngagementChange={handleMemoryEngagementChange}
          onOpenPhoto={(item) => setActivePhotoItemId(item.id)}
        />
      ) : null}

      {view === "album" ? (
        <AlbumView
          items={albumDeepLink?.assetId ? timelineItems : filteredItems}
          members={members}
          tripId={tripId}
          currentUserId={user.id}
          initialAssetId={albumDeepLink?.assetId ?? null}
          autoOpenFaceAssignment={albumDeepLink?.reviewFaces ?? false}
          returnTo={albumDeepLink?.returnTo ?? null}
          onInitialAssetConsumed={clearAlbumDeepLinkParams}
          onInitialAssetClosed={() => setAlbumDeepLink(null)}
          onFaceConfirmed={handleFaceConfirmed}
          onDeleteMemory={handleDeleteMemory}
          onDeleteAsset={handleDeleteAsset}
          onEngagementChange={handleMemoryEngagementChange}
        />
      ) : null}

      {view === "debug" ? (
        <PhotoGalleryView
          photos={filteredPhotos}
          facesByAssetId={facesByAssetId}
          members={members}
          tripId={tripId}
          targetAssetId={targetAssetId}
          onFaceConfirmed={handleFaceConfirmed}
        />
      ) : null}

      {shouldAutoLoadMoreMemories ? (
        <div
          ref={memoryLoadMoreRef}
          className="h-12"
          aria-hidden="true"
        />
      ) : null}

      <TimelinePhotoLightbox
        item={activePhotoItem}
        members={members}
        tripId={tripId}
        currentUserId={user.id}
        onClose={() => setActivePhotoItemId(null)}
        onDelete={handleDeleteMemory}
        onDeleteAsset={handleDeleteAsset}
        onFaceConfirmed={handleFaceConfirmed}
        onEngagementChange={handleMemoryEngagementChange}
      />
    </div>
  );
}

export default function TimelinePage() {
  return <AuthGate>{(user) => <TimelineContent user={user} />}</AuthGate>;
}
