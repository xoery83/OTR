"use client";

import { useState } from "react";
import type { PhotoAssetWithMemory, PhotoFace } from "@/types";
import { getMediaAssetDriveUrl } from "@/lib/supabase/media-assets";

function formatBytes(value: number | null | undefined) {
  if (!value || value <= 0) return "未知";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function metadataText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function faceLabel(face: PhotoFace, index: number) {
  const baseName = face.recognizedName || `人脸 ${index + 1}`;
  if (face.recognitionStatus === "recognized") return `可能是 ${baseName}`;
  if (face.recognitionStatus === "confirmed") return baseName;
  return baseName;
}

export function PhotoLightbox({
  imageUrl,
  title,
  subtitle,
  photo,
  faces,
  variant = "detailed",
  onClose,
}: {
  imageUrl: string;
  title?: string | null;
  subtitle?: string | null;
  photo?: PhotoAssetWithMemory | null;
  faces?: PhotoFace[];
  variant?: "detailed" | "minimal";
  onClose: () => void;
}) {
  const isMinimal = variant === "minimal";
  const [showInfo, setShowInfo] = useState(!isMinimal);
  const driveUrl = photo ? getMediaAssetDriveUrl(photo) : null;
  const summary = metadataText(photo?.aiMetadata?.summary);
  const locationHints = Array.isArray(photo?.aiMetadata?.locationHints)
    ? photo.aiMetadata.locationHints.filter(
        (hint): hint is string => typeof hint === "string" && hint.trim().length > 0,
      )
    : [];
  const confirmedFaces = (faces ?? []).filter(
    (face) => face.recognitionStatus === "confirmed",
  ).length;
  const recognizedFaces = (faces ?? []).filter(
    (face) => face.recognitionStatus === "recognized",
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/92 text-white"
      role="dialog"
      aria-modal="true"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="absolute left-3 right-3 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-20 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className={`rounded-full px-4 py-2 text-sm font-black shadow-lg ${
            isMinimal
              ? "bg-white/15 text-white backdrop-blur"
              : "bg-white text-stone-950"
          }`}
        >
          关闭
        </button>
        <div className="flex items-center gap-2">
          {isMinimal && driveUrl ? (
            <a
              href={driveUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-4 py-2 text-sm font-black text-stone-950 shadow-lg"
            >
              云盘下载
            </a>
          ) : null}
          {!isMinimal ? (
            <button
              type="button"
              onClick={() => setShowInfo((current) => !current)}
              className="rounded-full bg-white/15 px-4 py-2 text-sm font-black text-white shadow-lg backdrop-blur"
            >
              {showInfo ? "隐藏信息" : "信息"}
            </button>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="关闭图片预览"
        className={`flex min-h-0 flex-1 items-center justify-center px-2 ${
          isMinimal ? "py-12" : "py-16"
        }`}
      >
        <img
          src={imageUrl}
          alt={title || "图片预览"}
          className="max-h-full max-w-full object-contain"
        />
      </button>

      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/88 to-transparent px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] ${
          isMinimal ? "pt-20" : "pt-16"
        }`}
      >
        {isMinimal ? (
          <div className="mx-auto max-w-3xl text-white">
            <div className="truncate text-sm font-black">
              {title || photo?.memory?.content || "图片"}
            </div>
            {subtitle ? (
              <div className="mt-1 truncate text-xs font-semibold text-white/70">
                {subtitle}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl rounded-2xl bg-white/95 p-3 text-stone-950 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black">
                  {title || photo?.memory?.content || "图片"}
                </div>
                {subtitle ? (
                  <div className="mt-0.5 truncate text-xs font-semibold text-stone-500">
                    {subtitle}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                {driveUrl ? (
                  <a
                    href={driveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-black text-white"
                  >
                    云盘下载
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-black text-stone-800"
                >
                  关闭窗口
                </button>
              </div>
            </div>

            {showInfo ? (
              <div className="mt-3 space-y-3 border-t border-stone-200 pt-3">
                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-stone-600 sm:grid-cols-4">
                  <span className="rounded-xl bg-stone-100 px-3 py-2">
                    索引 {photo?.aiStatus ?? "未知"}
                  </span>
                  <span className="rounded-xl bg-stone-100 px-3 py-2">
                    尺寸 {photo?.width ?? "?"} x {photo?.height ?? "?"}
                  </span>
                  <span className="rounded-xl bg-stone-100 px-3 py-2">
                    压缩 {formatBytes(photo?.compressedFileSize)}
                  </span>
                  <span className="rounded-xl bg-stone-100 px-3 py-2">
                    人脸 {(faces ?? []).length}
                  </span>
                </div>

                {summary ? (
                  <p className="text-sm font-semibold leading-6 text-stone-700">
                    {summary}
                  </p>
                ) : null}

                {photo?.sceneTags?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {photo.sceneTags.slice(0, 8).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {(faces ?? []).length > 0 ? (
                  <div>
                    <div className="text-xs font-black text-stone-500">
                      人脸识别：{confirmedFaces} 已确认
                      {recognizedFaces ? `，${recognizedFaces} 个可能匹配` : ""}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(faces ?? []).slice(0, 10).map((face, index) => (
                        <span
                          key={face.id}
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            face.recognitionStatus === "confirmed"
                              ? "bg-emerald-100 text-emerald-900"
                              : face.recognitionStatus === "recognized"
                                ? "bg-sky-100 text-sky-900"
                                : "bg-stone-100 text-stone-700"
                          }`}
                        >
                          {faceLabel(face, index)}
                          {face.confidence
                            ? ` ${Math.round(face.confidence * 100)}%`
                            : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {locationHints.length > 0 ? (
                  <div className="text-xs font-semibold text-stone-500">
                    位置线索：{locationHints.slice(0, 3).join(", ")}
                  </div>
                ) : null}

                {photo?.ocrText ? (
                  <div className="line-clamp-2 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-600">
                    OCR：{photo.ocrText}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
