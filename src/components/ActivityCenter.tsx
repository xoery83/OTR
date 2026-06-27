"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  listBackgroundJobBatches,
  listBackgroundJobs,
  updateBackgroundJob,
} from "@/lib/background-jobs/client";
import type {
  BackgroundJob,
  BackgroundJobBatch,
  BackgroundJobStatus,
} from "@/lib/background-jobs/types";
import {
  requestFaceDetection,
  requestPhotoIndexing,
} from "@/lib/supabase/media-assets";
import { retryFailedPhotoUploadBatch } from "@/lib/uploads/photo-upload-manager";

function payloadString(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : "";
}

function isActiveStatus(status: BackgroundJobStatus) {
  return ["queued", "uploading", "processing", "waiting_for_user"].includes(status);
}

function activeJob(job: BackgroundJob) {
  return isActiveStatus(job.status);
}

function activeBatch(batch: BackgroundJobBatch) {
  return isActiveStatus(batch.status);
}

function isPlaceholderProcessingJob(job: BackgroundJob) {
  return (
    Boolean(job.payload.placeholder) &&
    ["image_indexing", "face_detection", "face_recognition"].includes(job.jobType)
  );
}

function statusLabel(status: BackgroundJobStatus) {
  if (status === "queued") return "Queued";
  if (status === "uploading") return "Uploading";
  if (status === "processing") return "Processing";
  if (status === "waiting_for_user") return "Needs attention";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  return "Cancelled";
}

function batchProgress(batch: BackgroundJobBatch) {
  if (batch.totalItems <= 0) return 0;
  return Math.min(
    100,
    Math.round(((batch.completedItems + batch.failedItems) / batch.totalItems) * 100),
  );
}

async function runJob(job: BackgroundJob) {
  if (isPlaceholderProcessingJob(job)) return;

  const tripId = payloadString(job, "tripId");
  const mediaAssetId = payloadString(job, "mediaAssetId");
  if (!tripId || !mediaAssetId) {
    throw new Error("Job is missing tripId or mediaAssetId.");
  }

  if (job.jobType === "image_indexing") {
    await updateBackgroundJob(job.id, {
      status: "processing",
      progress: 20,
      currentStep: "Image indexing",
    });
    const asset = await requestPhotoIndexing(mediaAssetId, tripId);
    await updateBackgroundJob(job.id, {
      status: "completed",
      progress: 100,
      currentStep: "Image indexed",
      result: { assetId: asset.id },
    });
    return;
  }

  if (job.jobType === "face_detection" || job.jobType === "face_recognition") {
    await updateBackgroundJob(job.id, {
      status: "processing",
      progress: 20,
      currentStep:
        job.jobType === "face_detection" ? "Face detection" : "Face recognition",
    });
    const faces = await requestFaceDetection(mediaAssetId, tripId);
    const unknownCount = faces.filter(
      (face) => face.recognitionStatus !== "confirmed",
    ).length;
    await updateBackgroundJob(job.id, {
      status: unknownCount > 0 ? "waiting_for_user" : "completed",
      progress: 100,
      currentStep:
        unknownCount > 0
          ? `${unknownCount} unknown face${unknownCount === 1 ? "" : "s"}`
          : "Faces processed",
      result: { mediaAssetId, faceCount: faces.length, unknownCount },
    });
    return;
  }

  await updateBackgroundJob(job.id, {
    status: "completed",
    progress: 100,
    currentStep: "Completed",
    result: { skippedByClientWorker: true },
  });
}

export function ActivityCenter() {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [batches, setBatches] = useState<BackgroundJobBatch[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null);
  const runningJobIds = useRef(new Set<string>());
  const visibleBatches = useMemo(
    () =>
      batches
        .filter((batch) => activeBatch(batch) || batch.status === "failed")
        .slice(0, 4),
    [batches],
  );
  const visibleJobs = useMemo(
    () =>
      jobs
        .filter((job) => !isPlaceholderProcessingJob(job))
        .filter((job) => activeJob(job) || job.status === "failed")
        .slice(0, 8),
    [jobs],
  );
  const countableJobs = jobs.filter((job) => !isPlaceholderProcessingJob(job));
  const activeCount =
    countableJobs.filter(activeJob).length + batches.filter(activeBatch).length;
  const failedCount =
    countableJobs.filter((job) => job.status === "failed").length +
    batches.filter((batch) => batch.status === "failed").length;
  const attentionCount =
    countableJobs.filter((job) => job.status === "waiting_for_user").length +
    batches.filter((batch) => batch.status === "waiting_for_user").length;

  async function refreshJobs() {
    setIsLoading(true);
    try {
      const [nextJobs, nextBatches] = await Promise.all([
        listBackgroundJobs(),
        listBackgroundJobBatches(),
      ]);
      setJobs(nextJobs);
      setBatches(nextBatches);
    } catch {
      setJobs([]);
      setBatches([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshJobs(), 0);
    const timer = window.setInterval(() => void refreshJobs(), 6000);
    const onCompleted = () => void refreshJobs();
    const onBackgroundChanged = () => void refreshJobs();
    const onPhotoUploadCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{
        totalFiles: number;
        uploadedFiles: number;
        failedFiles: number;
      }>).detail;
      if (!detail) return;
      setNotice(
        detail.failedFiles > 0
          ? `${detail.uploadedFiles} photos uploaded, ${detail.failedFiles} failed`
          : `${detail.uploadedFiles} photos uploaded. Organizing photos in background...`,
      );
      window.setTimeout(() => setNotice(null), 8000);
      void refreshJobs();
    };
    window.addEventListener("otr:capture-completed", onCompleted);
    window.addEventListener("otr:background-jobs-changed", onBackgroundChanged);
    window.addEventListener("otr:photo-upload-completed", onPhotoUploadCompleted);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("otr:capture-completed", onCompleted);
      window.removeEventListener("otr:background-jobs-changed", onBackgroundChanged);
      window.removeEventListener(
        "otr:photo-upload-completed",
        onPhotoUploadCompleted,
      );
    };
  }, []);

  useEffect(() => {
    const next = jobs.find(
      (job) =>
        job.status === "queued" &&
        !runningJobIds.current.has(job.id) &&
        !isPlaceholderProcessingJob(job) &&
        ["image_indexing", "face_detection", "face_recognition"].includes(
          job.jobType,
        ),
    );
    if (!next) return;

    runningJobIds.current.add(next.id);
    runJob(next)
      .catch(async (error) => {
        await updateBackgroundJob(next.id, {
          status: "failed",
          progress: next.progress,
          currentStep: "Failed",
          errorMessage:
            error instanceof Error ? error.message : "Background job failed.",
        }).catch(() => null);
      })
      .finally(() => {
        runningJobIds.current.delete(next.id);
        void refreshJobs();
      });
  }, [jobs]);

  if (activeCount === 0 && failedCount === 0 && !notice && !isOpen) {
    return null;
  }

  return (
    <div className="fixed bottom-24 right-3 z-[2147482500] md:bottom-5 md:right-5">
      {notice && !isOpen ? (
        <div className="mb-3 w-[min(360px,calc(100vw-24px))] rounded-3xl border border-emerald-100 bg-white p-4 text-sm font-bold text-emerald-900 shadow-2xl">
          {notice}
        </div>
      ) : null}

      {isOpen ? (
        <section className="mb-3 w-[min(360px,calc(100vw-24px))] rounded-3xl border border-stone-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                Activity
              </p>
              <h2 className="mt-1 text-lg font-semibold text-stone-950">
                Background jobs
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
            >
              Close
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {visibleBatches.length === 0 && visibleJobs.length === 0 ? (
              <p className="rounded-2xl bg-stone-50 p-3 text-sm font-medium text-stone-500">
                {isLoading ? "Loading..." : "No active background work."}
              </p>
            ) : (
              <>
                {visibleBatches.map((batch) => {
                  const progress = batchProgress(batch);
                  return (
                    <article
                      key={batch.id}
                      className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-stone-950">
                            {batch.title}
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-stone-600">
                            {statusLabel(batch.status)}
                            {batch.currentStep ? ` · ${batch.currentStep}` : ""}
                            {batch.totalItems > 0
                              ? ` · ${batch.completedItems}/${batch.totalItems}`
                              : ""}
                          </p>
                        </div>
                        <span className="text-xs font-black text-emerald-800">
                          {progress}%
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                        <div
                          className={`h-full rounded-full ${
                            batch.status === "failed"
                              ? "bg-red-500"
                              : batch.status === "waiting_for_user"
                                ? "bg-amber-500"
                                : "bg-emerald-700"
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      {batch.failedItems > 0 && batch.batchType === "photo_upload" ? (
                        <button
                          type="button"
                          disabled={retryingBatchId === batch.id}
                          onClick={async () => {
                            setRetryingBatchId(batch.id);
                            try {
                              await retryFailedPhotoUploadBatch(batch.id);
                            } catch (error) {
                              setNotice(
                                error instanceof Error
                                  ? error.message
                                  : "Could not retry failed uploads.",
                              );
                            } finally {
                              setRetryingBatchId(null);
                            }
                          }}
                          className="mt-3 rounded-full bg-white px-3 py-2 text-xs font-black text-emerald-800 shadow-sm disabled:text-stone-400"
                        >
                          {retryingBatchId === batch.id
                            ? "Retrying..."
                            : "Retry failed uploads"}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
                {visibleJobs.map((job) => (
                <article
                  key={job.id}
                  className="rounded-2xl border border-stone-100 bg-[#fffdf8] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-stone-950">
                        {job.title}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-stone-500">
                        {statusLabel(job.status)}
                        {job.currentStep ? ` · ${job.currentStep}` : ""}
                      </p>
                    </div>
                    <span className="text-xs font-black text-emerald-800">
                      {job.progress}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className={`h-full rounded-full ${
                        job.status === "failed"
                          ? "bg-red-500"
                          : job.status === "waiting_for_user"
                            ? "bg-amber-500"
                            : "bg-emerald-700"
                      }`}
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  {job.errorMessage ? (
                    <p className="mt-2 text-xs font-medium text-red-700">
                      {job.errorMessage}
                    </p>
                  ) : null}
                </article>
                ))}
              </>
            )}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="rounded-full bg-stone-950 px-4 py-3 text-sm font-black text-white shadow-2xl"
      >
        {attentionCount > 0
          ? `${attentionCount} needs attention`
          : activeCount > 0
            ? `${activeCount} running`
            : `${failedCount} failed`}
      </button>
    </div>
  );
}
