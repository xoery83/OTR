"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useCapture2Preview } from "@/components/Capture2PreviewProvider";
import { useI18n } from "@/components/I18nProvider";
import {
  classifyCapture2SafeIntent,
  type Capture2SafeClassification,
} from "@/lib/capture2/safe-classifier";
import { getErrorMessage } from "@/lib/errors";
import { createTextMemory } from "@/lib/supabase/memories";
import { supabase } from "@/lib/supabase/client";

type Capture2EventRow = {
  id: string;
  journey_id: string;
  input_type: string;
  original_input: string | null;
  transcription_text: string | null;
  referenced_photo_ids: unknown;
  referenced_video_ids: unknown;
  metadata: Record<string, unknown>;
  status: string;
  captured_at: string | null;
  created_at: string;
};

type MediaAssetRow = {
  id: string;
  asset_type: string;
  mime_type: string | null;
  original_file_size: number | null;
  original_file_path: string | null;
  original_drive_file_id: string | null;
  original_drive_web_url: string | null;
  provider_file_id: string | null;
  provider_web_url: string | null;
  provider_thumbnail_url: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  width: number | null;
  height: number | null;
  processing_status: string | null;
  ai_metadata: Record<string, unknown> | null;
  created_at: string;
};

const REVIEW_PAGE_SIZE = 20;
const REVIEW_FETCH_BATCH_SIZE = 50;

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(new Date(value));
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function eventDate(event: Capture2EventRow) {
  const value = event.captured_at || event.created_at;
  return value ? new Date(value).toISOString().slice(0, 10) : todayDate();
}

function metadataMediaIds(metadata: Record<string, unknown>) {
  const capture2 = metadata.capture2;
  if (!capture2 || typeof capture2 !== "object") return [];
  const ids = (capture2 as { mediaAssetIds?: unknown }).mediaAssetIds;
  return asStringArray(ids);
}

function rawText(event: Capture2EventRow) {
  return event.transcription_text || event.original_input || "";
}

function safeClassification(event: Capture2EventRow): Capture2SafeClassification {
  const fromMetadata =
    event.metadata && typeof event.metadata.safeClassifier === "object"
      ? event.metadata.safeClassifier
      : null;
  if (
    fromMetadata &&
    "intent" in fromMetadata &&
    "action" in fromMetadata &&
    "extracted" in fromMetadata
  ) {
    return fromMetadata as Capture2SafeClassification;
  }
  return classifyCapture2SafeIntent(rawText(event));
}

function eventMediaIds(event: Capture2EventRow) {
  return [
    ...new Set([
      ...asStringArray(event.referenced_photo_ids),
      ...asStringArray(event.referenced_video_ids),
      ...metadataMediaIds(event.metadata ?? {}),
    ]),
  ];
}

type PrimarySuggestion = {
  kind: "memory" | "expense" | "planner" | "photos" | "later";
};

function inputIcon(event: Capture2EventRow, ids: string[]) {
  if (event.input_type === "voice") return "🎤";
  if (event.input_type === "photo") return "📷";
  if (event.input_type === "video") return "🎥";
  if (ids.length > 0) return "📷";
  return "✍️";
}

function sourceLabel(event: Capture2EventRow) {
  const source = event.metadata?.source;
  return typeof source === "string" ? source : "unknown";
}

function isRecordLikeStatement(text: string, classification: Capture2SafeClassification) {
  if (classification.extracted.layer1 === "record") return true;
  return /(?:终于|到了|看到|遇到|差点|觉得|感觉|太牛|好吃|便宜|不错|漂亮|开心|饭店|餐厅|瀑布)/i.test(
    text,
  );
}

function primarySuggestion(
  event: Capture2EventRow,
  classification: Capture2SafeClassification,
): PrimarySuggestion {
  const text = rawText(event).trim();
  const ids = eventMediaIds(event);

  if (classification.intent === "expense" && classification.action === "open_expense_form") {
    return { kind: "expense" };
  }

  if (classification.intent === "planner" && classification.action === "open_planner_form") {
    return { kind: "planner" };
  }

  if (!text && ids.length > 0) {
    return { kind: "photos" };
  }

  if (
    classification.intent === "deferred" &&
    text &&
    isRecordLikeStatement(text, classification)
  ) {
    return { kind: "memory" };
  }

  return { kind: "later" };
}

function previewText(value: string, emptyText: string) {
  const trimmed = value.trim();
  if (!trimmed) return emptyText;
  return trimmed.length > 86 ? `${trimmed.slice(0, 86)}...` : trimmed;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function mediaPreviewUrl(asset: MediaAssetRow) {
  if (asset.asset_type === "video" || asset.mime_type?.startsWith("video/")) {
    return videoThumbnailUrls(asset)[0] || asset.thumbnail_url || asset.provider_thumbnail_url;
  }
  return asset.preview_url || asset.thumbnail_url || asset.provider_thumbnail_url;
}

function videoThumbnailUrls(asset: MediaAssetRow) {
  const video = asset.ai_metadata?.video;
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

function mediaDriveUrl(asset: MediaAssetRow) {
  return asset.provider_web_url || asset.original_drive_web_url;
}

function mediaFileName(asset: MediaAssetRow) {
  const capture2 = asset.ai_metadata?.capture2;
  if (capture2 && typeof capture2 === "object") {
    const fileName = (capture2 as { fileName?: unknown }).fileName;
    if (typeof fileName === "string" && fileName.trim()) return fileName;
  }
  return asset.original_file_path || asset.id;
}

function RotatingVideoPoster({
  asset,
  alt,
}: {
  asset: MediaAssetRow;
  alt: string;
}) {
  const urls = videoThumbnailUrls(asset);
  const [index, setIndex] = useState(0);
  const fallbackUrl = asset.thumbnail_url || asset.provider_thumbnail_url;
  const src = urls[index % Math.max(urls.length, 1)] || fallbackUrl;

  useEffect(() => {
    if (urls.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % urls.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [urls.length]);

  if (!src) {
    return (
      <div className="grid size-full place-items-center text-3xl">
        🎥
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="size-full object-cover transition-opacity duration-300"
    />
  );
}

function MediaAssetPreviewDialog({
  asset,
  onClose,
}: {
  asset: MediaAssetRow;
  onClose: () => void;
}) {
  const isVideo = asset.asset_type === "video" || asset.mime_type?.startsWith("video/");
  const title = mediaFileName(asset);
  const posterUrl = mediaPreviewUrl(asset);
  const driveUrl = mediaDriveUrl(asset);

  return (
    <div
      className="fixed inset-0 z-[2147482600] flex flex-col bg-stone-950/95 p-3 text-white sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black">{title}</p>
          <p className="mt-1 text-xs font-bold text-white/60">
            {isVideo ? "3 秒预览" : "图片预览"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {driveUrl ? (
            <a
              href={driveUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-3 py-2 text-xs font-black text-stone-950"
            >
              查看完整视频
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/15 px-4 py-2 text-sm font-black text-white"
          >
            关闭
          </button>
        </div>
      </div>
      <div className="mt-4 grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-black p-2">
        {isVideo && asset.preview_url ? (
          <video
            src={asset.preview_url}
            poster={posterUrl ?? undefined}
            className="max-h-full max-w-full"
            controls
            autoPlay
            loop
            muted
            playsInline
          />
        ) : posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterUrl} alt={title} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="grid size-full place-items-center text-5xl">
            {isVideo ? "🎥" : "📷"}
          </div>
        )}
      </div>
    </div>
  );
}

function plannerKindForInboxEvent(
  text: string,
  classification: Capture2SafeClassification,
) {
  const normalized = text.toLowerCase();
  if (/住宿|民宿|公寓|airbnb|lodging|accommodation/.test(normalized)) return "lodging";
  if (/酒店|hotel/.test(normalized)) return "hotel";
  if (/机票|航班|飞机|flight/.test(normalized)) return "flight";
  if (/餐厅|饭店|晚饭|午饭|早餐|restaurant|dinner|lunch|meal/.test(normalized)) {
    return "restaurant";
  }
  if (/船票|渡轮|ferry/.test(normalized)) return "ferry";
  if (/租车|取车|还车|car rental|rental car/.test(normalized)) return "car";
  if (/门票|票|预订|预约|booking|ticket|reservation/.test(normalized)) {
    return "reservation";
  }

  const reservationType = classification.extracted.reservationType;
  if (reservationType === "hotel") return "hotel";
  if (reservationType === "flight") return "flight";
  if (reservationType === "restaurant") return "restaurant";
  if (reservationType === "ferry") return "ferry";
  if (reservationType === "car") return "car";
  return "activity";
}

export function Capture2InboxContent({ tripId }: { tripId?: string | null }) {
  const capture2 = useCapture2Preview();
  const { t } = useI18n();
  const [events, setEvents] = useState<Capture2EventRow[]>([]);
  const [mediaAssets, setMediaAssets] = useState<Record<string, MediaAssetRow>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreEvents, setHasMoreEvents] = useState(false);
  const [nextEventCursor, setNextEventCursor] = useState<string | null>(null);
  const [workingEventId, setWorkingEventId] = useState<string | null>(null);
  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({});
  const [developerMode, setDeveloperMode] = useState(false);
  const [reviewMode, setReviewMode] = useState<"pending" | "archived">("pending");
  const [selectedMediaAsset, setSelectedMediaAsset] = useState<MediaAssetRow | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function eventMatchesReviewMode(event: Capture2EventRow) {
    const inbox = event.metadata?.capture2Inbox;
    const inboxStatus =
      inbox && typeof inbox === "object"
        ? (inbox as { status?: unknown }).status
        : null;
    const isArchived =
      event.status === "archived" ||
      event.status === "processed" ||
      inboxStatus === "archived" ||
      inboxStatus === "processed";
    if (reviewMode === "archived") return isArchived;
    if (isArchived) return false;

    const capture2 = event.metadata?.capture2;
    const safetyClass =
      capture2 && typeof capture2 === "object"
        ? (capture2 as { safetyClass?: unknown }).safetyClass
        : null;
    return (
      event.status === "raw" ||
      event.status === "deferred" ||
      safetyClass === "deferred"
    );
  }

  async function loadMediaAssetsForRows(rows: Capture2EventRow[], append: boolean) {
    const ids = [...new Set(rows.flatMap(eventMediaIds))];
    if (ids.length === 0) {
      if (!append) setMediaAssets({});
      return;
    }

    const { data: mediaData, error: mediaError } = await supabase
      .from("media_assets")
      .select(
        "id, asset_type, mime_type, original_file_size, original_file_path, original_drive_file_id, original_drive_web_url, provider_file_id, provider_web_url, provider_thumbnail_url, thumbnail_url, preview_url, width, height, processing_status, ai_metadata, created_at",
      )
      .in("id", ids);

    if (mediaError) throw mediaError;
    const nextAssets = Object.fromEntries(
      ((mediaData ?? []) as MediaAssetRow[]).map((asset) => [asset.id, asset]),
    );
    setMediaAssets((current) => (append ? { ...current, ...nextAssets } : nextAssets));
  }

  async function loadEvents(options: { append?: boolean } = {}) {
    const append = Boolean(options.append);
    if (append && (!hasMoreEvents || isLoadingMore)) return;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);
    try {
      let cursor = append ? nextEventCursor : null;
      const matchedRows: Capture2EventRow[] = [];
      let lastBatchLength = 0;
      let batchesRead = 0;

      while (matchedRows.length < REVIEW_PAGE_SIZE && batchesRead < 4) {
        batchesRead += 1;
        let query = supabase
          .from("journey_capture_events")
          .select(
            "id, journey_id, input_type, original_input, transcription_text, referenced_photo_ids, referenced_video_ids, metadata, status, captured_at, created_at",
          )
          .filter("metadata->>source", "eq", "capture2_preview")
          .order("created_at", { ascending: false })
          .limit(REVIEW_FETCH_BATCH_SIZE);

        if (tripId) query = query.eq("journey_id", tripId);
        if (cursor) query = query.lt("created_at", cursor);

        const { data, error: eventError } = await query;
        if (eventError) throw eventError;

        const batch = (data ?? []) as Capture2EventRow[];
        lastBatchLength = batch.length;
        if (batch.length === 0) break;

        cursor = batch[batch.length - 1]?.created_at ?? cursor;
        matchedRows.push(...batch.filter(eventMatchesReviewMode));

        if (batch.length < REVIEW_FETCH_BATCH_SIZE) break;
      }

      const pageRows = matchedRows.slice(0, REVIEW_PAGE_SIZE);
      setEvents((current) => {
        if (!append) return pageRows;
        const seen = new Set(current.map((event) => event.id));
        return [...current, ...pageRows.filter((event) => !seen.has(event.id))];
      });
      setNextEventCursor(cursor);
      setHasMoreEvents(lastBatchLength === REVIEW_FETCH_BATCH_SIZE);
      await loadMediaAssetsForRows(pageRows, append);
    } catch (loadError) {
      setError(getErrorMessage(loadError, t("captureInbox.error.load")));
    } finally {
      if (append) setIsLoadingMore(false);
      else setIsLoading(false);
    }
  }

  useEffect(() => {
    setEvents([]);
    setMediaAssets({});
    setNextEventCursor(null);
    setHasMoreEvents(false);
    void loadEvents();
  }, [tripId, reviewMode]);

  useEffect(() => {
    if (!hasMoreEvents || isLoading || isLoadingMore) return;
    const sentinel = document.querySelector("[data-capture-inbox-load-more]");
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadEvents({ append: true });
        }
      },
      { rootMargin: "480px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreEvents, isLoading, isLoadingMore, nextEventCursor, tripId, reviewMode]);

  const mediaCount = useMemo(
    () => events.reduce((count, event) => count + eventMediaIds(event).length, 0),
    [events],
  );

  function suggestionCopy(suggestion: PrimarySuggestion) {
    if (suggestion.kind === "memory") {
      return {
        label: t("captureInbox.suggestion.memory"),
        buttonLabel: t("captureInbox.action.saveMemory"),
      };
    }
    if (suggestion.kind === "expense") {
      return {
        label: t("captureInbox.suggestion.expense"),
        buttonLabel: t("captureInbox.action.addExpense"),
      };
    }
    if (suggestion.kind === "planner") {
      return {
        label: t("captureInbox.suggestion.planner"),
        buttonLabel: t("captureInbox.action.addPlan"),
      };
    }
    if (suggestion.kind === "photos") {
      return {
        label: t("captureInbox.suggestion.photos"),
        buttonLabel: t("captureInbox.action.organizePhotos"),
      };
    }
    return {
      label: t("captureInbox.suggestion.later"),
      buttonLabel: t("captureInbox.action.keepPending"),
    };
  }

  async function updateEvent(
    event: Capture2EventRow,
    status: string,
    extra: Record<string, unknown>,
  ) {
    const metadata = {
      ...(event.metadata ?? {}),
      capture2Inbox: {
        status,
        updatedAt: new Date().toISOString(),
        ...extra,
      },
    };
    const patch =
      status === "archived" ? { metadata } : { status, metadata };
    const { error: updateError } = await supabase
      .from("journey_capture_events")
      .update(patch)
      .eq("id", event.id);
    if (updateError) throw updateError;
    window.dispatchEvent(new CustomEvent("otr:capture2-changed"));
  }

  async function archiveEvent(event: Capture2EventRow) {
    setWorkingEventId(event.id);
    setError(null);
    setNotice(null);
    try {
      await updateEvent(event, "archived", { action: "archive" });
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setNotice(t("captureInbox.notice.archived"));
    } catch (archiveError) {
      setError(getErrorMessage(archiveError, t("captureInbox.error.archive")));
    } finally {
      setWorkingEventId(null);
    }
  }

  function processedMemoryEntryId(event: Capture2EventRow) {
    const inbox = event.metadata?.capture2Inbox;
    if (inbox && typeof inbox === "object") {
      const memoryEntryId = (inbox as { memoryEntryId?: unknown }).memoryEntryId;
      if (typeof memoryEntryId === "string") return memoryEntryId;
    }

    const capture2 = event.metadata?.capture2;
    if (capture2 && typeof capture2 === "object") {
      const memoryEntryId = (capture2 as { memoryEntryId?: unknown }).memoryEntryId;
      if (typeof memoryEntryId === "string") return memoryEntryId;
    }
    return null;
  }

  async function undoArchivedEvent(event: Capture2EventRow) {
    setWorkingEventId(event.id);
    setError(null);
    setNotice(null);
    try {
      const memoryEntryId = processedMemoryEntryId(event);
      if (memoryEntryId) {
        const { error: deleteError } = await supabase
          .from("memory_entries")
          .delete()
          .eq("id", memoryEntryId)
          .eq("journey_id", event.journey_id);
        if (deleteError) throw deleteError;
      }
      await updateEvent(event, "raw", {
        action: "restore_to_review",
        restoredAt: new Date().toISOString(),
        deletedMemoryEntryId: memoryEntryId,
      });
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setNotice(t("captureInbox.notice.restored"));
    } catch (undoError) {
      setError(getErrorMessage(undoError, t("captureInbox.error.undo")));
    } finally {
      setWorkingEventId(null);
    }
  }

  async function convertToMemory(event: Capture2EventRow) {
    const text = rawText(event).trim();
    if (!text) {
      setError(t("captureInbox.error.noText"));
      return;
    }

    setWorkingEventId(event.id);
    setError(null);
    setNotice(null);
    try {
      const memory = await createTextMemory(event.journey_id, text, {
        capturedAt: event.captured_at || event.created_at,
        locationName: "",
      });
      await updateEvent(event, "processed", {
        action: "convert_to_memory",
        memoryEntryId: memory.id,
      });
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setNotice(t("captureInbox.notice.memory"));
    } catch (convertError) {
      setError(getErrorMessage(convertError, t("captureInbox.error.memory")));
    } finally {
      setWorkingEventId(null);
    }
  }

  function openExpenseForm(event: Capture2EventRow) {
    const classification = safeClassification(event);
    const text = rawText(event);
    capture2.openCapture2({
      tripId: event.journey_id,
      mode: "expense",
      quickFormPrefill: {
        title: classification.extracted.title || t("capture2.prefill.expenseTitle"),
        amount: classification.extracted.amount ?? "",
        currency: classification.extracted.currency || "NZD",
        category: (classification.extracted.category ?? "other") as never,
        date: eventDate(event),
        description: text,
      },
    });
  }

  function openPlannerForm(event: Capture2EventRow) {
    const classification = safeClassification(event);
    const text = rawText(event);
    const plannerKind = plannerKindForInboxEvent(text, classification);
    capture2.openCapture2({
      tripId: event.journey_id,
      mode: "planner",
      plannerKind,
      quickFormPrefill: {
        title: classification.extracted.title || text || t("captureInbox.prefill.plan"),
        eventType: (classification.extracted.eventType ?? "activity") as never,
        reservationType: (classification.extracted.reservationType ?? "other") as never,
        date: eventDate(event),
        description: text,
      },
    });
  }

  function handlePrimaryAction(event: Capture2EventRow, suggestion: PrimarySuggestion) {
    if (suggestion.kind === "memory") {
      void convertToMemory(event);
      return;
    }
    if (suggestion.kind === "expense") {
      openExpenseForm(event);
      return;
    }
    if (suggestion.kind === "planner") {
      openPlannerForm(event);
      return;
    }
    if (suggestion.kind === "photos") {
      setNotice(t("captureInbox.notice.mediaSaved"));
      return;
    }
    setNotice(t("captureInbox.notice.kept"));
  }

  function toggleActions(eventId: string) {
    setExpandedActions((current) => ({
      ...current,
      [eventId]: !current[eventId],
    }));
  }

  return (
    <main className="min-h-screen bg-[#f8f4ec] px-4 py-6 text-stone-950 md:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              {t("captureInbox.eyebrow")}
            </p>
            <h1 className="mt-2 text-3xl font-black">{t("captureInbox.title")}</h1>
            <p className="mt-2 text-sm font-semibold text-stone-600">
              {reviewMode === "pending"
                ? t("captureInbox.summary.pending", {
                    count: events.length,
                    media: mediaCount,
                  })
                : t("captureInbox.summary.archived", {
                    count: events.length,
                    media: mediaCount,
                  })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setReviewMode("pending")}
              className={`rounded-lg px-4 py-3 text-sm font-black ${
                reviewMode === "pending"
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-stone-800 shadow-sm"
              }`}
            >
              {t("captureInbox.tab.pending")}
            </button>
            <button
              type="button"
              onClick={() => setReviewMode("archived")}
              className={`rounded-lg px-4 py-3 text-sm font-black ${
                reviewMode === "archived"
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-stone-800 shadow-sm"
              }`}
            >
              {t("captureInbox.tab.archived")}
            </button>
            <button
              type="button"
              onClick={() => setDeveloperMode((value) => !value)}
              className={`rounded-lg px-4 py-3 text-sm font-black ${
                developerMode
                  ? "bg-stone-900 text-white"
                  : "bg-white text-stone-800 shadow-sm"
              }`}
            >
              {t("captureInbox.action.developer")}
            </button>
            <button
              type="button"
              onClick={() => void loadEvents()}
              disabled={isLoading}
              className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
            >
              {isLoading ? t("captureInbox.action.refreshing") : t("captureInbox.action.refresh")}
            </button>
          </div>
        </div>

        {notice ? (
          <div className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {isLoading && events.length === 0 ? (
            <div className="rounded-lg bg-white p-5 text-sm font-bold text-stone-600">
              {t("captureInbox.loading")}
            </div>
          ) : null}

          {!isLoading && events.length === 0 ? (
            <div className="rounded-lg bg-white p-5 text-sm font-bold text-stone-600">
              {reviewMode === "pending"
                ? t("captureInbox.empty.pending")
                : t("captureInbox.empty.archived")}
            </div>
          ) : null}

          {events.map((event) => {
            const ids = eventMediaIds(event);
            const eventMedia = ids
              .map((id) => mediaAssets[id])
              .filter((asset): asset is MediaAssetRow => Boolean(asset));
            const text = rawText(event);
            const classification = safeClassification(event);
            const isWorking = workingEventId === event.id;
            const suggestion = primarySuggestion(event, classification);
            const isExpanded = Boolean(expandedActions[event.id]);
            const isArchivedMode = reviewMode === "archived";
            const suggestionText = suggestionCopy(suggestion);

            return (
              <article
                key={event.id}
                className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-xl">
                    {inputIcon(event, ids)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-stone-500">
                        {formatDate(event.created_at)}
                      </span>
                      {ids.length > 0 ? (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-600">
                          {t("captureInbox.media.count", { count: ids.length })}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-base font-black leading-7 text-stone-950">
                      {previewText(text, t("captureInbox.emptyText"))}
                    </p>
                  </div>
                </div>

                {eventMedia.length > 0 ? (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {eventMedia.slice(0, 8).map((asset) => {
                      const previewUrl = mediaPreviewUrl(asset);
                      const isVideo =
                        asset.asset_type === "video" ||
                        asset.mime_type?.startsWith("video/");
                      return (
                        <button
                          type="button"
                          key={asset.id}
                          onClick={() => setSelectedMediaAsset(asset)}
                          className="overflow-hidden rounded-lg border border-stone-100 bg-stone-50"
                        >
                          <div className="relative aspect-square bg-stone-200">
                            {previewUrl ? (
                              isVideo ? (
                                <RotatingVideoPoster
                                  asset={asset}
                                  alt={mediaFileName(asset)}
                                />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={previewUrl}
                                  alt={mediaFileName(asset)}
                                  className="size-full object-cover"
                                />
                              )
                            ) : (
                              <div className="grid size-full place-items-center text-3xl">
                                {isVideo ? "🎥" : "📷"}
                              </div>
                            )}
                            {isVideo ? (
                              <>
                                <span className="absolute inset-0 grid place-items-center">
                                  <span className="grid size-11 place-items-center rounded-full bg-stone-950/70 text-sm font-black text-white shadow-lg">
                                    ▶
                                  </span>
                                </span>
                                <span className="absolute bottom-2 left-2 rounded-full bg-stone-950/75 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                                  {t("capture2.media.video")}
                                </span>
                              </>
                            ) : null}
                          </div>
                          <div className="px-2 py-1.5">
                            <p className="truncate text-xs font-black text-stone-800">
                              {mediaFileName(asset)}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] font-bold text-stone-500">
                              {formatBytes(asset.original_file_size) ||
                                asset.processing_status ||
                                t("captureInbox.media.generic")}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                    {eventMedia.length > 8 ? (
                      <div className="grid aspect-square place-items-center rounded-lg bg-stone-100 text-sm font-black text-stone-600">
                        +{eventMedia.length - 8}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 border-t border-stone-100 pt-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                    {isArchivedMode
                      ? t("captureInbox.section.processed")
                      : t("captureInbox.section.suggestion")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-lg font-black text-stone-950">
                      {isArchivedMode
                        ? t("captureInbox.status.archivedUndoable")
                        : suggestionText.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {isArchivedMode ? (
                        <button
                          type="button"
                          onClick={() => void undoArchivedEvent(event)}
                          disabled={isWorking}
                          className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                        >
                          {t("captureInbox.action.undo")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handlePrimaryAction(event, suggestion)}
                          disabled={isWorking || (suggestion.kind === "memory" && !text.trim())}
                          className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                        >
                          {suggestionText.buttonLabel}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActions(event.id)}
                        disabled={isWorking}
                        className="rounded-lg bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:bg-stone-200"
                      >
                        {t("captureInbox.action.more")}
                      </button>
                      {!isArchivedMode ? (
                        <button
                          type="button"
                          onClick={() => void archiveEvent(event)}
                          disabled={isWorking}
                          className="rounded-lg bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:bg-stone-200"
                        >
                          {t("captureInbox.action.archive")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-4 border-t border-stone-100 pt-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                      {t("captureInbox.section.moreActions")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isArchivedMode ? (
                        <button
                          type="button"
                          onClick={() => void undoArchivedEvent(event)}
                          disabled={isWorking}
                          className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                        >
                          {t("captureInbox.action.undoToPending")}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void convertToMemory(event)}
                            disabled={isWorking || !text.trim()}
                            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                          >
                            {t("captureInbox.action.saveMemory")}
                          </button>
                          <button
                            type="button"
                            onClick={() => openExpenseForm(event)}
                            disabled={isWorking}
                            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                          >
                            {t("captureInbox.action.addExpense")}
                          </button>
                          <button
                            type="button"
                            onClick={() => openPlannerForm(event)}
                            disabled={isWorking}
                            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                          >
                            {t("captureInbox.action.addPlan")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void archiveEvent(event)}
                            disabled={isWorking}
                            className="rounded-lg bg-stone-200 px-3 py-2 text-xs font-black text-stone-800 disabled:bg-stone-100"
                          >
                            {t("captureInbox.action.archive")}
                          </button>
                        </>
                      )}
                    </div>

                    <details className="mt-4 rounded-lg bg-stone-950 p-3 text-white" open={developerMode}>
                      <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-stone-200">
                        {t("captureInbox.section.technical")}
                      </summary>
                      <div className="mt-3 space-y-3">
                        <div className="rounded-lg bg-white/10 p-3">
                          <p className="text-xs font-black text-stone-300">event id</p>
                          <p className="mt-1 break-all font-mono text-xs text-white">{event.id}</p>
                          <p className="mt-3 text-xs font-black text-stone-300">source</p>
                          <p className="mt-1 text-xs font-bold text-white">{sourceLabel(event)}</p>
                        </div>
                        <div className="rounded-lg bg-white/10 p-3">
                          <p className="text-xs font-black text-stone-300">raw_text</p>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-white">
                            {text || t("captureInbox.technical.noRawText")}
                          </p>
                        </div>
                        <div className="rounded-lg bg-white/10 p-3">
                          <p className="text-xs font-black text-stone-300">media_asset_ids</p>
                          <p className="mt-1 break-all font-mono text-xs text-white">
                            {ids.length > 0
                              ? ids.join(", ")
                              : t("captureInbox.technical.none")}
                          </p>
                        </div>
                        <pre className="max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-xs leading-5 text-stone-50">
                          {JSON.stringify(
                            {
                              classifier: classification,
                              metadata: event.metadata ?? {},
                              mediaAssets: Object.fromEntries(
                                ids.map((id) => [id, mediaAssets[id] ?? null]),
                              ),
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    </details>
                  </div>
                ) : null}
              </article>
            );
          })}
          <div
            data-capture-inbox-load-more
            className="flex min-h-16 items-center justify-center"
          >
            {isLoadingMore ? (
              <div className="rounded-lg bg-white px-4 py-3 text-sm font-black text-stone-600 shadow-sm">
                {t("captureInbox.loadingMore")}
              </div>
            ) : hasMoreEvents ? (
              <button
                type="button"
                onClick={() => void loadEvents({ append: true })}
                className="rounded-lg bg-white px-4 py-3 text-sm font-black text-stone-800 shadow-sm"
              >
                {t("captureInbox.action.loadMore")}
              </button>
            ) : events.length > 0 ? (
              <p className="text-xs font-bold text-stone-500">
                {t("captureInbox.noMore")}
              </p>
            ) : null}
          </div>
        </div>
        {selectedMediaAsset ? (
          <MediaAssetPreviewDialog
            asset={selectedMediaAsset}
            onClose={() => setSelectedMediaAsset(null)}
          />
        ) : null}
      </div>
    </main>
  );
}

export default function Capture2InboxPage() {
  return <AuthGate>{() => <Capture2InboxContent />}</AuthGate>;
}
