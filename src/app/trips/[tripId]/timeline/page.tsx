"use client";

import { useParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { createBackgroundJob } from "@/lib/background-jobs/client";
import { formatDayLabel } from "@/lib/format";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import {
  getPhotoFacesForAssets,
  getTripPhotoAssets,
  requestFaceConfirmation,
} from "@/lib/supabase/media-assets";
import {
  getSignedMemoryImageUrls,
  getTripMemories,
} from "@/lib/supabase/memories";
import { getTrip } from "@/lib/supabase/trips";
import type {
  JourneyMember,
  MemoryEntry,
  PhotoAssetWithMemory,
  PhotoFace,
  Trip,
} from "@/types";

type TimelineView = "feed" | "timeline" | "album" | "debug";

type TimelineItem = {
  id: string;
  memory: MemoryEntry;
  photo: PhotoAssetWithMemory | null;
  faces: PhotoFace[];
  uploadedAt: string;
  capturedAt: string;
  dateKey: string;
  searchText: string;
  peopleNames: string[];
  hasUnassignedFaces: boolean;
};

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
}) {
  const photoByMemoryId = new Map(
    input.photoAssets
      .filter((photo) => photo.memoryEntryId)
      .map((photo) => [photo.memoryEntryId, photo]),
  );

  return input.memories.map((memory) => {
    const photo = photoByMemoryId.get(memory.id) ?? null;
    const faces = photo ? input.facesByAssetId[photo.id] ?? [] : [];
    const faceNames = faces
      .map((face) => face.recognizedName)
      .filter((name): name is string => Boolean(name));
    const memberNames = input.members
      .filter((member) => {
        const haystack = `${memory.content} ${memory.locationName ?? ""} ${faceNames.join(
          " ",
        )}`.toLowerCase();
        return haystack.includes(member.displayName.toLowerCase());
      })
      .map((member) => member.displayName);
    const peopleNames = [...new Set([...faceNames, ...memberNames])];
    const sceneTags = photo?.sceneTags ?? [];
    const locationHints = photo ? getLocationHints(photo) : [];
    const summary = photo ? getAiSummary(photo) : null;
    const uploadedAt = photo?.createdAt ?? memory.createdAt;
    const displayUrl = photo?.displayUrl ?? (memory.mediaUrl ? input.imageUrls[memory.mediaUrl] : undefined);

    return {
      id: memory.id,
      memory,
      photo: photo && displayUrl ? { ...photo, displayUrl } : photo,
      faces,
      uploadedAt,
      capturedAt: memory.capturedAt,
      dateKey: getLocalDateKey(memory.capturedAt),
      searchText: normalizeSearch(
        [
          memory.content,
          memory.locationName,
          memory.contributorName,
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
    } satisfies TimelineItem;
  });
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
    const matchedMembers = input.members.filter((member) => {
      const nameHit = item.searchText.includes(member.displayName.toLowerCase());
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
      (!query || item.searchText.includes(query)) &&
      (!input.mineOnly || isMine) &&
      memberFilterPassed
    );
  });
}

function ItemMeta({ item }: { item: TimelineItem }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-stone-600">
      <span className="rounded-full bg-stone-100 px-2 py-1">
        Uploaded {formatShortDateTime(item.uploadedAt)}
      </span>
      <span className="rounded-full bg-stone-100 px-2 py-1">
        Shot {formatShortDateTime(item.capturedAt)}
      </span>
      {item.memory.locationName ? (
        <span className="rounded-full bg-stone-100 px-2 py-1">
          {item.memory.locationName}
        </span>
      ) : null}
      {item.memory.contributorName ? (
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
    </div>
  );
}

function CompactMemoryCard({ item }: { item: TimelineItem }) {
  const isPhoto = item.memory.type === "photo" && item.photo?.displayUrl;

  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm">
      {isPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.photo!.displayUrl}
          alt={item.memory.content || "Travel photo"}
          className="h-auto w-full object-cover"
        />
      ) : (
        <div className="bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
          {item.memory.content || "Text memory"}
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
            {item.memory.type}
          </p>
          {item.hasUnassignedFaces ? (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-black text-amber-900">
              Face check
            </span>
          ) : null}
        </div>
        {item.memory.content && isPhoto ? (
          <h3 className="mt-2 text-base font-semibold text-stone-950">
            {item.memory.content}
          </h3>
        ) : null}
        <ItemMeta item={item} />
      </div>
    </article>
  );
}

function UploadFeedView({ items }: { items: TimelineItem[] }) {
  const sorted = [...items].sort(
    (left, right) =>
      new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime(),
  );

  return (
    <section className="columns-1 gap-4 space-y-4 sm:columns-2 xl:columns-3">
      {sorted.map((item) => (
        <div key={item.id} className="break-inside-avoid pb-4">
          <CompactMemoryCard item={item} />
        </div>
      ))}
    </section>
  );
}

function TrueTimelineView({ items }: { items: TimelineItem[] }) {
  const dates = [...new Set(items.map((item) => item.dateKey))].sort();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const activeDate =
    selectedDate && dates.includes(selectedDate)
      ? selectedDate
      : getNearestDate(dates);
  const dayItems = activeDate
    ? items
        .filter((item) => item.dateKey === activeDate)
        .sort(
          (left, right) =>
            new Date(left.capturedAt).getTime() -
            new Date(right.capturedAt).getTime(),
        )
    : [];

  if (!activeDate) return null;

  return (
    <section className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 overflow-x-auto border-y border-emerald-100 bg-stone-50/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          {dates.map((date) => (
            <button
              type="button"
              key={date}
              onClick={() => setSelectedDate(date)}
              className={`shrink-0 rounded-2xl px-4 py-2 text-sm font-black ${
                activeDate === date
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-stone-600 shadow-sm"
              }`}
            >
              {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-semibold text-stone-950">
          {formatDayLabel(activeDate)}
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          {dayItems.length} memories in captured-time order
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {dayItems.map((item) => (
          <CompactMemoryCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function AlbumView({
  items,
  onOpenDebug,
}: {
  items: TimelineItem[];
  onOpenDebug: () => void;
}) {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const photoItems = items.filter(
    (item) => item.memory.type === "photo" && item.photo?.displayUrl,
  );

  return (
    <section className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
      {photoItems.map((item) => {
        const isActive = activeItemId === item.id;

        return (
          <button
            type="button"
            key={item.id}
            onClick={() =>
              isActive && item.photo?.providerWebUrl
                ? window.open(item.photo.providerWebUrl, "_blank", "noreferrer")
                : setActiveItemId(item.id)
            }
            className="group relative aspect-square overflow-hidden bg-stone-100 text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.photo!.displayUrl}
              alt={item.memory.content || "Travel photo"}
              className="h-full w-full object-cover"
            />
            <div
              className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-stone-950/80 via-stone-950/20 to-transparent p-2 text-white transition ${
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <p className="line-clamp-2 text-xs font-bold">
                {item.memory.content || item.memory.locationName || "Photo"}
              </p>
              <p className="mt-1 text-[10px] font-semibold opacity-80">
                {formatShortDateTime(item.capturedAt)}
              </p>
              {item.hasUnassignedFaces ? (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDebug();
                  }}
                  className="mt-2 w-fit rounded-full bg-amber-300 px-2 py-1 text-[10px] font-black text-stone-950"
                >
                  Assign faces
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function getFaceBoxStyle(
  face: PhotoFace,
  photo: PhotoAssetWithMemory,
): CSSProperties | null {
  const imageWidth = photo.width ?? 0;
  const imageHeight = photo.height ?? 0;
  const x = Number(face.boundingBox.x);
  const y = Number(face.boundingBox.y);
  const width = Number(face.boundingBox.width);
  const height = Number(face.boundingBox.height);

  if (
    !imageWidth ||
    !imageHeight ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    left: `${Math.max(0, (x / imageWidth) * 100)}%`,
    top: `${Math.max(0, (y / imageHeight) * 100)}%`,
    width: `${Math.min(100, (width / imageWidth) * 100)}%`,
    height: `${Math.min(100, (height / imageHeight) * 100)}%`,
  };
}

function PhotoGalleryView({
  photos,
  facesByAssetId,
  members,
  tripId,
  onFaceConfirmed,
}: {
  photos: PhotoAssetWithMemory[];
  facesByAssetId: Record<string, PhotoFace[]>;
  members: JourneyMember[];
  tripId: string;
  onFaceConfirmed: (assetId: string, face: PhotoFace) => void;
}) {
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [activeFacePhotoId, setActiveFacePhotoId] = useState<string | null>(null);
  const [selectedFace, setSelectedFace] = useState<{
    assetId: string;
    face: PhotoFace;
  } | null>(null);
  const [confirmingFaceId, setConfirmingFaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function indexPhoto(photo: PhotoAssetWithMemory) {
    setActivePhotoId(photo.id);
    setError(null);

    try {
      await createBackgroundJob({
        journeyId: tripId,
        jobType: "image_indexing",
        title: photo.memory?.content || "Image indexing",
        currentStep: "Queued",
        payload: { tripId, mediaAssetId: photo.id },
      });
    } catch (indexError) {
      setError(
        indexError instanceof Error
          ? indexError.message
          : "Could not queue this photo.",
      );
    } finally {
      setActivePhotoId(null);
    }
  }

  async function indexPendingPhotos() {
    const pending = photos.filter(
      (photo) => photo.aiStatus === "pending" || photo.aiStatus === "failed",
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
          : "Could not queue face detection.",
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
          : "Could not confirm this face.",
      );
    } finally {
      setConfirmingFaceId(null);
    }
  }

  const indexedCount = photos.filter((photo) => photo.aiStatus === "indexed").length;
  const driveCount = photos.filter((photo) => photo.isOriginalPreserved).length;

  return (
    <section className="space-y-5">
      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-emerald-700">
              Photo album
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">
              {photos.length} uploaded photos
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {driveCount} originals in Google Drive · {indexedCount} indexed for
              search
            </p>
          </div>
          <button
            type="button"
            onClick={indexPendingPhotos}
            disabled={activePhotoId !== null || photos.length === indexedCount}
            className="rounded-full bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {activePhotoId ? "Indexing..." : "Index pending"}
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
          No uploaded photos yet. Add a photo memory and it will appear here.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {photos.map((photo) => {
            const summary = getAiSummary(photo);
            const aiError = getAiError(photo);
            const locationHints = getLocationHints(photo);
            const modelInfo = getAiModelInfo(photo);
            const faces = facesByAssetId[photo.id] ?? [];
          const capturedAt = photo.memory?.capturedAt
            ? new Date(photo.memory.capturedAt)
            : new Date(photo.createdAt);

          return (
            <article
              key={photo.id}
              className="overflow-hidden rounded-3xl bg-white shadow-sm"
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.displayUrl}
                    alt={photo.memory?.content || "Travel photo"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-sm font-semibold text-stone-400">
                    No preview
                  </div>
                )}
                {faces.map((face, index) => {
                  const boxStyle = getFaceBoxStyle(face, photo);
                  if (!boxStyle) return null;

                  const faceName = face.recognizedName || `Face ${index + 1}`;
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
                      aria-label={`Select ${faceName}`}
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
                        {isRecognized ? `Maybe ${faceName}` : faceName}
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
                    Compressed {formatBytes(photo.compressedFileSize)}
                  </span>
                  <span className="rounded-2xl bg-stone-50 p-3">
                    Original {formatBytes(photo.originalFileSize)}
                  </span>
                  <span className="rounded-2xl bg-stone-50 p-3">
                    {photo.isOriginalPreserved ? "Drive preserved" : "No original"}
                  </span>
                  <span className="rounded-2xl bg-stone-50 p-3">
                    {faces.length} faces detected
                  </span>
                </div>

                {faces.length > 0 ? (
                  <div className="rounded-2xl bg-stone-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
                      Faces
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
                                ? `Maybe ${face.recognizedName}`
                                : face.recognizedName || `Face ${index + 1}`}{" "}
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
                          Confirm face
                        </p>
                        <h4 className="mt-1 text-lg font-semibold text-stone-950">
                          Who is this?
                        </h4>
                        <p className="mt-1 text-sm text-stone-600">
                          Confirm or correct the suggested person. This keeps
                          future matching inside this Journey.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedFace(null)}
                        className="rounded-full bg-white px-3 py-2 text-xs font-bold text-stone-600"
                      >
                        Close
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {members.map((member) => (
                        <button
                          type="button"
                          key={member.id}
                          onClick={() => confirmFace(member)}
                          disabled={confirmingFaceId === selectedFace.face.id}
                          className="flex items-center gap-2 rounded-2xl bg-white p-3 text-left text-sm font-bold text-stone-900 shadow-sm disabled:opacity-60"
                        >
                          {member.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={member.avatarUrl}
                              alt=""
                              className="size-8 rounded-full object-cover"
                            />
                          ) : (
                            <span className="grid size-8 place-items-center rounded-full bg-emerald-100 text-xs text-emerald-900">
                              {member.displayName.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span className="truncate">{member.displayName}</span>
                        </button>
                      ))}
                    </div>
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
                    Location hints: {locationHints.join(", ")}
                  </p>
                ) : null}

                {modelInfo ? (
                  <div className="grid gap-2 rounded-2xl bg-stone-50 p-3 text-xs font-semibold text-stone-700 sm:grid-cols-2">
                    {modelInfo.provider ? (
                      <p>
                        <span className="text-stone-500">Provider:</span>{" "}
                        {modelInfo.provider}
                      </p>
                    ) : null}
                    {modelInfo.modelUsed ? (
                      <p>
                        <span className="text-stone-500">Model used:</span>{" "}
                        {modelInfo.modelUsed}
                      </p>
                    ) : null}
                    {modelInfo.model ? (
                      <p className="sm:col-span-2">
                        <span className="text-stone-500">Model:</span>{" "}
                        {modelInfo.model}
                      </p>
                    ) : null}
                    {modelInfo.confidence !== null ? (
                      <p>
                        <span className="text-stone-500">Confidence:</span>{" "}
                        {Math.round(modelInfo.confidence * 100)}%
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {photo.ocrText ? (
                  <p className="rounded-2xl bg-stone-50 p-3 text-sm leading-6 text-stone-700">
                    OCR: {photo.ocrText}
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
                      ? "Queued"
                      : photo.aiStatus === "indexed"
                        ? "Re-index"
                        : "Index photo"}
                  </button>
                  <button
                    type="button"
                    onClick={() => detectFaces(photo)}
                    disabled={activeFacePhotoId === photo.id}
                    className="rounded-full bg-stone-950 px-4 py-2 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {activeFacePhotoId === photo.id
                      ? "Queued"
                      : faces.length > 0
                        ? "Refresh faces"
                        : "Detect faces"}
                  </button>
                  {photo.providerWebUrl ? (
                    <a
                      href={photo.providerWebUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-800"
                    >
                      Open original
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
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [photoAssets, setPhotoAssets] = useState<PhotoAssetWithMemory[]>([]);
  const [facesByAssetId, setFacesByAssetId] = useState<Record<string, PhotoFace[]>>(
    {},
  );
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [view, setView] = useState<TimelineView>("feed");
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTimeline() {
      try {
        const [tripData, memoryData, assetData, memberData] =
          await Promise.all([
          getTrip(tripId),
          getTripMemories(tripId),
          getTripPhotoAssets(tripId),
          getJourneyMembers(tripId),
        ]);
        const [signedUrls, faceData] = await Promise.all([
          getSignedMemoryImageUrls(memoryData),
          getPhotoFacesForAssets(assetData.map((asset) => asset.id)),
        ]);

        if (isMounted) {
          setTrip(tripData);
          setMemories(memoryData);
          setPhotoAssets(assetData);
          setFacesByAssetId(faceData);
          setMembers(memberData);
          setImageUrls(signedUrls);
        }
      } catch (timelineError) {
        if (isMounted) {
          setError(
            timelineError instanceof Error
              ? timelineError.message
              : "Could not load timeline.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadTimeline();

    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const timelineItems = useMemo(
    () =>
      getTimelineItems({
        memories,
        photoAssets,
        facesByAssetId,
        imageUrls,
        members,
      }),
    [facesByAssetId, imageUrls, memories, members, photoAssets],
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
    return photoAssets.filter((photo) => allowedMemoryIds.has(photo.memoryEntryId));
  }, [filteredItems, photoAssets]);

  function toggleMember(memberId: string) {
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

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading timeline...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name || "Trip"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Timeline
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Uploaded memories, photo index data, faces, places, and captured-time
          story views.
        </p>
      </section>

      <div className="sticky top-0 z-30 space-y-3 rounded-3xl bg-stone-50/95 p-3 shadow-sm backdrop-blur">
        <div className="grid grid-cols-4 gap-1 rounded-2xl border border-stone-200 bg-white p-1">
          {[
            ["feed", "Feed"],
            ["timeline", "Timeline"],
            ["album", "Album"],
            ["debug", "Debug"],
          ].map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              onClick={() => setView(mode as TimelineView)}
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

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes, OCR, tags, people, places..."
            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-900 outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={() => setMineOnly((current) => !current)}
            className={`rounded-2xl px-4 py-3 text-sm font-black ${
              mineOnly
                ? "bg-emerald-700 text-white"
                : "bg-white text-stone-700 shadow-sm"
            }`}
          >
            Mine
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

        <p className="px-1 text-xs font-semibold text-stone-500">
          Showing {filteredItems.length} of {timelineItems.length} memories
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {!error && timelineItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          No memories yet. Capture a text note or photo and it will appear here.
        </div>
      ) : null}

      {!error && timelineItems.length > 0 && filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
          No memories match these filters.
        </div>
      ) : null}

      {view === "feed" ? <UploadFeedView items={filteredItems} /> : null}

      {view === "timeline" ? <TrueTimelineView items={filteredItems} /> : null}

      {view === "album" ? (
        <AlbumView items={filteredItems} onOpenDebug={() => setView("debug")} />
      ) : null}

      {view === "debug" ? (
        <PhotoGalleryView
          photos={filteredPhotos}
          facesByAssetId={facesByAssetId}
          members={members}
          tripId={tripId}
          onFaceConfirmed={handleFaceConfirmed}
        />
      ) : null}
    </div>
  );
}

export default function TimelinePage() {
  return <AuthGate>{(user) => <TimelineContent user={user} />}</AuthGate>;
}
