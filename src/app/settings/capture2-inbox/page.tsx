"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useCapture2Preview } from "@/components/Capture2PreviewProvider";
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
  label: string;
  buttonLabel: string;
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
    return { kind: "expense", label: "添加消费", buttonLabel: "添加消费" };
  }

  if (classification.intent === "planner" && classification.action === "open_planner_form") {
    return { kind: "planner", label: "添加行程", buttonLabel: "添加行程" };
  }

  if (!text && ids.length > 0) {
    return { kind: "photos", label: "整理照片", buttonLabel: "整理照片" };
  }

  if (
    classification.intent === "deferred" &&
    text &&
    isRecordLikeStatement(text, classification)
  ) {
    return { kind: "memory", label: "保存为记忆", buttonLabel: "保存为记忆" };
  }

  return { kind: "later", label: "稍后处理", buttonLabel: "保持待处理" };
}

function previewText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "没有文字内容";
  return trimmed.length > 86 ? `${trimmed.slice(0, 86)}...` : trimmed;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function mediaPreviewUrl(asset: MediaAssetRow) {
  return asset.preview_url || asset.thumbnail_url || asset.provider_thumbnail_url;
}

function mediaFileName(asset: MediaAssetRow) {
  const capture2 = asset.ai_metadata?.capture2;
  if (capture2 && typeof capture2 === "object") {
    const fileName = (capture2 as { fileName?: unknown }).fileName;
    if (typeof fileName === "string" && fileName.trim()) return fileName;
  }
  return asset.original_file_path || asset.id;
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
  const [events, setEvents] = useState<Capture2EventRow[]>([]);
  const [mediaAssets, setMediaAssets] = useState<Record<string, MediaAssetRow>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [workingEventId, setWorkingEventId] = useState<string | null>(null);
  const [expandedActions, setExpandedActions] = useState<Record<string, boolean>>({});
  const [developerMode, setDeveloperMode] = useState(false);
  const [reviewMode, setReviewMode] = useState<"pending" | "archived">("pending");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents() {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: eventError } = await supabase
        .from("journey_capture_events")
        .select(
          "id, journey_id, input_type, original_input, transcription_text, referenced_photo_ids, referenced_video_ids, metadata, status, captured_at, created_at",
        )
        .filter("metadata->>source", "eq", "capture2_preview")
        .order("created_at", { ascending: false })
        .limit(150);

      if (eventError) throw eventError;

      const scopedRows = tripId
        ? ((data ?? []) as Capture2EventRow[]).filter(
            (event) => event.journey_id === tripId,
          )
        : ((data ?? []) as Capture2EventRow[]);

      const rows = scopedRows.filter((event) => {
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
      });
      setEvents(rows);

      const ids = [...new Set(rows.flatMap(eventMediaIds))];
      if (ids.length === 0) {
        setMediaAssets({});
        return;
      }

      const { data: mediaData, error: mediaError } = await supabase
        .from("media_assets")
        .select(
          "id, asset_type, mime_type, original_file_size, original_file_path, original_drive_file_id, original_drive_web_url, provider_file_id, provider_web_url, provider_thumbnail_url, thumbnail_url, preview_url, width, height, processing_status, ai_metadata, created_at",
        )
        .in("id", ids);

      if (mediaError) throw mediaError;
      setMediaAssets(
        Object.fromEntries(
          ((mediaData ?? []) as MediaAssetRow[]).map((asset) => [asset.id, asset]),
        ),
      );
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Could not load Capture Inbox."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();
  }, [tripId, reviewMode]);

  const mediaCount = useMemo(
    () => events.reduce((count, event) => count + eventMediaIds(event).length, 0),
    [events],
  );

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
      setNotice("已归档。");
    } catch (archiveError) {
      setError(getErrorMessage(archiveError, "Archive failed."));
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
      setNotice("已取消操作，条目已回到待整理。");
    } catch (undoError) {
      setError(getErrorMessage(undoError, "Undo failed."));
    } finally {
      setWorkingEventId(null);
    }
  }

  async function convertToMemory(event: Capture2EventRow) {
    const text = rawText(event).trim();
    if (!text) {
      setError("这条 capture 没有可转换的文字。");
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
      setNotice("已转换为 Memory。");
    } catch (convertError) {
      setError(getErrorMessage(convertError, "Convert to Memory failed."));
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
        title: classification.extracted.title || "新消费",
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
        title: classification.extracted.title || text || "新行程",
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
      setNotice("照片和视频已经安全保存，稍后可以继续整理。");
      return;
    }
    setNotice("已保留在 Today Review，不会自动执行。");
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
              Capture 2.0
            </p>
            <h1 className="mt-2 text-3xl font-black">Today Review</h1>
            <p className="mt-2 text-sm font-semibold text-stone-600">
              {reviewMode === "pending"
                ? `今天还有 ${events.length} 条 Capture 等待整理`
                : `已归档 ${events.length} 条 Capture`}
              {" · "}
              {mediaCount} 个媒体
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
              待整理
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
              已归档
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
              查看开发信息
            </button>
            <button
              type="button"
              onClick={() => void loadEvents()}
              disabled={isLoading}
              className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
            >
              {isLoading ? "刷新中..." : "刷新"}
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
              正在读取 Today Review...
            </div>
          ) : null}

          {!isLoading && events.length === 0 ? (
            <div className="rounded-lg bg-white p-5 text-sm font-bold text-stone-600">
              {reviewMode === "pending"
                ? "今天没有等待整理的 Capture。"
                : "还没有归档的 Capture。"}
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
                          {ids.length} 个媒体
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-base font-black leading-7 text-stone-950">
                      {previewText(text)}
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
                        <div
                          key={asset.id}
                          className="overflow-hidden rounded-lg border border-stone-100 bg-stone-50"
                        >
                          <div className="relative aspect-square bg-stone-200">
                            {previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={previewUrl}
                                alt={mediaFileName(asset)}
                                className="size-full object-cover"
                              />
                            ) : (
                              <div className="grid size-full place-items-center text-3xl">
                                {isVideo ? "🎥" : "📷"}
                              </div>
                            )}
                            {isVideo ? (
                              <span className="absolute bottom-2 left-2 rounded-full bg-stone-950/75 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                                Video
                              </span>
                            ) : null}
                          </div>
                          <div className="px-2 py-1.5">
                            <p className="truncate text-xs font-black text-stone-800">
                              {mediaFileName(asset)}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] font-bold text-stone-500">
                              {formatBytes(asset.original_file_size) ||
                                asset.processing_status ||
                                "媒体"}
                            </p>
                          </div>
                        </div>
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
                    {isArchivedMode ? "已处理" : "AI 建议"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-lg font-black text-stone-950">
                      {isArchivedMode ? "已归档，可取消操作" : suggestion.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {isArchivedMode ? (
                        <button
                          type="button"
                          onClick={() => void undoArchivedEvent(event)}
                          disabled={isWorking}
                          className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                        >
                          取消操作
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handlePrimaryAction(event, suggestion)}
                          disabled={isWorking || (suggestion.kind === "memory" && !text.trim())}
                          className="rounded-lg bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                        >
                          {suggestion.buttonLabel}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActions(event.id)}
                        disabled={isWorking}
                        className="rounded-lg bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:bg-stone-200"
                      >
                        换一种
                      </button>
                      {!isArchivedMode ? (
                        <button
                          type="button"
                          onClick={() => void archiveEvent(event)}
                          disabled={isWorking}
                          className="rounded-lg bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:bg-stone-200"
                        >
                          归档
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-4 border-t border-stone-100 pt-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                      换一种处理
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isArchivedMode ? (
                        <button
                          type="button"
                          onClick={() => void undoArchivedEvent(event)}
                          disabled={isWorking}
                          className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                        >
                          取消操作并回到待整理
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void convertToMemory(event)}
                            disabled={isWorking || !text.trim()}
                            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                          >
                            保存为记忆
                          </button>
                          <button
                            type="button"
                            onClick={() => openExpenseForm(event)}
                            disabled={isWorking}
                            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                          >
                            添加消费
                          </button>
                          <button
                            type="button"
                            onClick={() => openPlannerForm(event)}
                            disabled={isWorking}
                            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-black text-white disabled:bg-stone-300"
                          >
                            添加行程
                          </button>
                          <button
                            type="button"
                            onClick={() => void archiveEvent(event)}
                            disabled={isWorking}
                            className="rounded-lg bg-stone-200 px-3 py-2 text-xs font-black text-stone-800 disabled:bg-stone-100"
                          >
                            归档
                          </button>
                        </>
                      )}
                    </div>

                    <details className="mt-4 rounded-lg bg-stone-950 p-3 text-white" open={developerMode}>
                      <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-stone-200">
                        查看技术信息
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
                            {text || "No raw text"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-white/10 p-3">
                          <p className="text-xs font-black text-stone-300">media_asset_ids</p>
                          <p className="mt-1 break-all font-mono text-xs text-white">
                            {ids.length > 0 ? ids.join(", ") : "none"}
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
        </div>
      </div>
    </main>
  );
}

export default function Capture2InboxPage() {
  return <AuthGate>{() => <Capture2InboxContent />}</AuthGate>;
}
