"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
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
  created_at: string;
};

type MediaAssetRow = {
  id: string;
  asset_type: string;
  mime_type: string | null;
  original_file_size: number | null;
  original_drive_file_id: string | null;
  original_drive_web_url: string | null;
  provider_file_id: string | null;
  provider_web_url: string | null;
  processing_status: string | null;
  created_at: string;
};

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function metadataMediaIds(metadata: Record<string, unknown>) {
  const capture2 = metadata.capture2;
  if (!capture2 || typeof capture2 !== "object") return [];
  const ids = (capture2 as { mediaAssetIds?: unknown }).mediaAssetIds;
  return asStringArray(ids);
}

function Capture2EventsContent() {
  const [events, setEvents] = useState<Capture2EventRow[]>([]);
  const [mediaAssets, setMediaAssets] = useState<Record<string, MediaAssetRow>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents() {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: eventError } = await supabase
        .from("journey_capture_events")
        .select(
          "id, journey_id, input_type, original_input, transcription_text, referenced_photo_ids, referenced_video_ids, metadata, status, created_at",
        )
        .filter("metadata->>source", "eq", "capture2_preview")
        .order("created_at", { ascending: false })
        .limit(50);

      if (eventError) throw eventError;

      const rows = (data ?? []) as Capture2EventRow[];
      setEvents(rows);

      const ids = [
        ...new Set(
          rows.flatMap((event) => [
            ...asStringArray(event.referenced_photo_ids),
            ...asStringArray(event.referenced_video_ids),
            ...metadataMediaIds(event.metadata ?? {}),
          ]),
        ),
      ];

      if (ids.length === 0) {
        setMediaAssets({});
        return;
      }

      const { data: mediaData, error: mediaError } = await supabase
        .from("media_assets")
        .select(
          "id, asset_type, mime_type, original_file_size, original_drive_file_id, original_drive_web_url, provider_file_id, provider_web_url, processing_status, created_at",
        )
        .in("id", ids);

      if (mediaError) throw mediaError;

      setMediaAssets(
        Object.fromEntries(
          ((mediaData ?? []) as MediaAssetRow[]).map((asset) => [asset.id, asset]),
        ),
      );
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Could not load Capture2 events."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();
  }, []);

  const eventCount = events.length;
  const mediaCount = useMemo(
    () =>
      events.reduce(
        (count, event) =>
          count +
          asStringArray(event.referenced_photo_ids).length +
          asStringArray(event.referenced_video_ids).length,
        0,
      ),
    [events],
  );

  return (
    <main className="min-h-screen bg-[#f8f4ec] px-4 py-6 text-stone-950 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Capture2 Developer
            </p>
            <h1 className="mt-2 text-3xl font-black">Raw Event List</h1>
            <p className="mt-2 text-sm font-semibold text-stone-600">
              最近 {eventCount} 条 Capture2 Preview event · {mediaCount} 个 referenced media
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadEvents()}
            disabled={isLoading}
            className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
          >
            {isLoading ? "刷新中..." : "刷新"}
          </button>
        </div>

        {error ? (
          <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {isLoading && events.length === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm font-bold text-stone-600">
              Loading Capture2 events...
            </div>
          ) : null}

          {!isLoading && events.length === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm font-bold text-stone-600">
              No Capture2 Preview events found.
            </div>
          ) : null}

          {events.map((event) => {
            const photoIds = asStringArray(event.referenced_photo_ids);
            const videoIds = asStringArray(event.referenced_video_ids);
            const metadataIds = metadataMediaIds(event.metadata ?? {});
            const allIds = [...new Set([...photoIds, ...videoIds, ...metadataIds])];
            const rawText = event.transcription_text || event.original_input || "";
            const safeClassifier =
              event.metadata && typeof event.metadata.safeClassifier === "object"
                ? event.metadata.safeClassifier
                : null;

            return (
              <details
                key={event.id}
                className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black uppercase text-emerald-800">
                          {event.input_type}
                        </span>
                        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-black text-stone-700">
                          {event.status}
                        </span>
                        <span className="text-xs font-bold text-stone-500">
                          {formatDate(event.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-sm font-bold text-stone-900">
                        {rawText || "No raw text"}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs font-black text-stone-500">
                      media {allIds.length}
                    </p>
                  </div>
                </summary>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl bg-stone-50 p-3">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                      Media Asset IDs
                    </p>
                    <div className="mt-2 space-y-2">
                      {allIds.length > 0 ? (
                        allIds.map((id) => {
                          const asset = mediaAssets[id];
                          return (
                            <div
                              key={id}
                              className="rounded-xl border border-stone-200 bg-white p-3 text-xs"
                            >
                              <p className="font-mono font-bold text-stone-900">{id}</p>
                              {asset ? (
                                <p className="mt-1 font-semibold text-stone-600">
                                  {asset.asset_type} · {asset.mime_type ?? "unknown"} ·{" "}
                                  {asset.processing_status ?? "pending"} · Drive{" "}
                                  {asset.original_drive_file_id || asset.provider_file_id
                                    ? "yes"
                                    : "no"}
                                </p>
                              ) : (
                                <p className="mt-1 font-semibold text-red-700">
                                  media_assets row not found
                                </p>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm font-semibold text-stone-500">No media linked.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-stone-950 p-3">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-300">
                      Metadata
                    </p>
                    {safeClassifier ? (
                      <p className="mt-2 rounded-xl bg-emerald-900/40 px-3 py-2 text-xs font-bold text-emerald-50">
                        Safe Classifier:{" "}
                        {JSON.stringify(safeClassifier)}
                      </p>
                    ) : null}
                    <pre className="mt-2 max-h-80 overflow-auto text-xs leading-5 text-stone-50">
                      {JSON.stringify(event.metadata ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </main>
  );
}

export default function Capture2EventsPage() {
  return <AuthGate>{() => <Capture2EventsContent />}</AuthGate>;
}
