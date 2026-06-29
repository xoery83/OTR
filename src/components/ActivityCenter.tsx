"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  dismissBackgroundActivity,
  listDismissedBackgroundActivity,
  listBackgroundJobBatches,
  listBackgroundJobs,
  updateBackgroundJob,
} from "@/lib/background-jobs/client";
import type {
  BackgroundJob,
  BackgroundJobBatch,
  BackgroundJobStatus,
} from "@/lib/background-jobs/types";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import {
  requestFaceDetection,
  requestPhotoIndexing,
} from "@/lib/supabase/media-assets";
import {
  listRuntimePhotoUploadBatches,
  retryFailedPhotoUploadBatch,
} from "@/lib/uploads/photo-upload-manager";

const FAILED_WARNING_AUTO_HIDE_MS = 18000;

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

function getFaceReviewHref(job: BackgroundJob) {
  if (!["face_detection", "face_recognition"].includes(job.jobType)) return null;

  const tripId = payloadString(job, "tripId");
  const mediaAssetId = payloadString(job, "mediaAssetId");
  if (!tripId || !mediaAssetId) return null;

  return `/trips/${tripId}/timeline?view=debug&asset=${mediaAssetId}`;
}

type Translate = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

type DismissibleActivity = {
  type: "job" | "batch";
  id: string;
  status: BackgroundJobStatus;
};

function statusLabel(status: BackgroundJobStatus, t: Translate) {
  if (status === "queued") return t("activity.status.queued");
  if (status === "uploading") return t("activity.status.uploading");
  if (status === "processing") return t("activity.status.processing");
  if (status === "waiting_for_user") return t("activity.status.waitingForUser");
  if (status === "completed") return t("activity.status.completed");
  if (status === "failed") return t("activity.status.failed");
  return t("activity.status.cancelled");
}

function batchProgress(batch: BackgroundJobBatch) {
  if (batch.totalItems <= 0) return 0;
  return Math.min(
    100,
    Math.round(((batch.completedItems + batch.failedItems) / batch.totalItems) * 100),
  );
}

function jobActivityKey(job: BackgroundJob) {
  return `job:${job.id}:${job.status}`;
}

function batchActivityKey(batch: BackgroundJobBatch) {
  return `batch:${batch.id}:${batch.status}`;
}

function activityKey(activity: DismissibleActivity) {
  return `${activity.type}:${activity.id}:${activity.status}`;
}

function isRuntimeOnlyActivity(activity: DismissibleActivity) {
  return activity.id.startsWith("runtime-");
}

async function runJob(job: BackgroundJob, t: Translate) {
  if (isPlaceholderProcessingJob(job)) return;

  const tripId = payloadString(job, "tripId");
  const mediaAssetId = payloadString(job, "mediaAssetId");
  if (!tripId || !mediaAssetId) {
    throw new Error(t("activity.job.missingPayload"));
  }

  if (job.jobType === "image_indexing") {
    await updateBackgroundJob(job.id, {
      status: "processing",
      progress: 20,
      currentStep: t("activity.job.imageIndexing"),
    });
    const asset = await requestPhotoIndexing(mediaAssetId, tripId);
    await updateBackgroundJob(job.id, {
      status: "completed",
      progress: 100,
      currentStep: t("activity.job.imageIndexed"),
      result: { assetId: asset.id },
    });
    return;
  }

  if (job.jobType === "face_detection" || job.jobType === "face_recognition") {
    await updateBackgroundJob(job.id, {
      status: "processing",
      progress: 20,
      currentStep:
        job.jobType === "face_detection"
          ? t("activity.job.faceDetection")
          : t("activity.job.faceRecognition"),
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
          ? t("activity.job.unknownFaces", { count: unknownCount })
          : t("activity.job.facesProcessed"),
      result: { mediaAssetId, faceCount: faces.length, unknownCount },
    });
    return;
  }

  await updateBackgroundJob(job.id, {
    status: "completed",
    progress: 100,
    currentStep: t("activity.job.completed"),
    result: { skippedByClientWorker: true },
  });
}

export function ActivityCenter() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [batches, setBatches] = useState<BackgroundJobBatch[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null);
  const [locallyDismissedActivityKeys, setLocallyDismissedActivityKeys] = useState<
    Set<string>
  >(
    () => new Set<string>(),
  );
  const [remoteDismissedActivityKeys, setRemoteDismissedActivityKeys] = useState<
    Set<string>
  >(() => new Set<string>());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runningJobIds = useRef(new Set<string>());
  const dismissedActivityKeys = useMemo(
    () =>
      new Set([
        ...locallyDismissedActivityKeys,
        ...remoteDismissedActivityKeys,
      ]),
    [locallyDismissedActivityKeys, remoteDismissedActivityKeys],
  );
  const currentActivities = useMemo<DismissibleActivity[]>(
    () => [
      ...jobs
        .filter((job) => !isPlaceholderProcessingJob(job))
        .filter((job) => activeJob(job) || job.status === "failed")
        .map((job) => ({
          type: "job" as const,
          id: job.id,
          status: job.status,
        })),
      ...batches
        .filter((batch) => activeBatch(batch) || batch.status === "failed")
        .map((batch) => ({
          type: "batch" as const,
          id: batch.id,
          status: batch.status,
        })),
    ],
    [batches, jobs],
  );
  const visibleBatches = useMemo(
    () =>
      batches
        .filter((batch) => activeBatch(batch) || batch.status === "failed")
        .filter((batch) => !dismissedActivityKeys.has(batchActivityKey(batch))),
    [batches, dismissedActivityKeys],
  );
  const visibleJobs = useMemo(
    () =>
      jobs
        .filter((job) => !isPlaceholderProcessingJob(job))
        .filter((job) => activeJob(job) || job.status === "failed")
        .filter((job) => !dismissedActivityKeys.has(jobActivityKey(job))),
    [dismissedActivityKeys, jobs],
  );
  const countableJobs = useMemo(
    () => jobs.filter((job) => !isPlaceholderProcessingJob(job)),
    [jobs],
  );
  const activeCount =
    visibleJobs.filter(activeJob).length + visibleBatches.filter(activeBatch).length;
  const currentFailureActivities = useMemo<DismissibleActivity[]>(
    () => [
      ...countableJobs
        .filter((job) => job.status === "failed")
        .map((job) => ({
          type: "job" as const,
          id: job.id,
          status: job.status,
        })),
      ...batches
        .filter((batch) => batch.status === "failed")
        .map((batch) => ({
          type: "batch" as const,
          id: batch.id,
          status: batch.status,
        })),
    ],
    [batches, countableJobs],
  );
  const visibleFailedCount = currentFailureActivities.filter(
    (activity) => !dismissedActivityKeys.has(activityKey(activity)),
  ).length;
  const attentionCount =
    visibleJobs.filter((job) => job.status === "waiting_for_user").length +
    visibleBatches.filter((batch) => batch.status === "waiting_for_user").length;
  const visibleActivityCount = visibleJobs.length + visibleBatches.length;

  const refreshJobs = useCallback(async () => {
    setIsLoading(true);
    const runtimeBatches = listRuntimePhotoUploadBatches();
    try {
      const [nextJobs, nextBatches] = await Promise.all([
        listBackgroundJobs(),
        listBackgroundJobBatches(),
      ]);
      const mergedBatches = [
        ...runtimeBatches,
        ...nextBatches.filter(
          (batch) =>
            !runtimeBatches.some((runtimeBatch) => runtimeBatch.id === batch.id),
        ),
      ];
      const activityKeys = [
        ...nextJobs
          .filter((job) => !isPlaceholderProcessingJob(job))
          .filter((job) => activeJob(job) || job.status === "failed")
          .map(jobActivityKey),
        ...mergedBatches
          .filter((batch) => activeBatch(batch) || batch.status === "failed")
          .map(batchActivityKey),
      ];
      const dismissedKeys = await listDismissedBackgroundActivity(activityKeys).catch(
        () => [],
      );
      setJobs(nextJobs);
      setBatches(mergedBatches);
      setRemoteDismissedActivityKeys(new Set(dismissedKeys));
    } catch {
      setJobs([]);
      setBatches(runtimeBatches);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const dismissActivities = useCallback((activities: DismissibleActivity[]) => {
    if (activities.length === 0) return;

    setLocallyDismissedActivityKeys((current) => {
      const next = new Set(current);
      for (const activity of activities) {
        next.add(activityKey(activity));
      }
      return next;
    });

    const persistedActivities = activities.filter(
      (activity) => !isRuntimeOnlyActivity(activity),
    );
    if (persistedActivities.length === 0) return;

    dismissBackgroundActivity(persistedActivities)
      .then(() => refreshJobs())
      .catch((error) => {
        setNotice(
          error instanceof Error
            ? error.message
            : "Could not dismiss background activity.",
        );
      });
  }, [refreshJobs]);

  const acknowledgeCurrentFailures = useCallback(() => {
    dismissActivities(currentFailureActivities);
  }, [currentFailureActivities, dismissActivities]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    acknowledgeCurrentFailures();
  }, [acknowledgeCurrentFailures]);

  const dismissCurrentActivity = useCallback(() => {
    dismissActivities(currentActivities);
    setNotice(null);
    setIsOpen(false);
  }, [currentActivities, dismissActivities]);

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
          ? t("activity.notice.uploadPartial", {
              uploaded: detail.uploadedFiles,
              failed: detail.failedFiles,
            })
          : t("activity.notice.uploadComplete", {
              uploaded: detail.uploadedFiles,
            }),
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
  }, [refreshJobs, t]);

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
    runJob(next, t)
      .catch(async (error) => {
        await updateBackgroundJob(next.id, {
          status: "failed",
          progress: next.progress,
          currentStep: t("activity.job.failed"),
          errorMessage:
            error instanceof Error ? error.message : t("activity.error.jobFailed"),
        }).catch(() => null);
      })
      .finally(() => {
        runningJobIds.current.delete(next.id);
        void refreshJobs();
      });
  }, [jobs, refreshJobs, t]);

  useEffect(() => {
    if (isOpen || notice || activeCount > 0 || visibleFailedCount === 0) return;

    const timer = window.setTimeout(() => {
      acknowledgeCurrentFailures();
    }, FAILED_WARNING_AUTO_HIDE_MS);

    return () => window.clearTimeout(timer);
  }, [
    acknowledgeCurrentFailures,
    activeCount,
    isOpen,
    notice,
    visibleFailedCount,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      closePanel();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closePanel, isOpen]);

  if (
    (activeCount === 0 && visibleFailedCount === 0 && !notice && !isOpen) ||
    (visibleActivityCount === 0 && !notice && !isOpen)
  ) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="fixed bottom-24 left-3 z-[2147482500] md:bottom-5 md:left-5"
    >
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
                {t("activity.label")}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-stone-950">
                {t("activity.title")}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={dismissCurrentActivity}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
              >
                {t("activity.action.clear")}
              </button>
              <button
                type="button"
                onClick={closePanel}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
              >
                {t("common.close")}
              </button>
            </div>
          </div>

          <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[520px]">
            {visibleBatches.length === 0 && visibleJobs.length === 0 ? (
              <p className="rounded-2xl bg-stone-50 p-3 text-sm font-medium text-stone-500">
                {isLoading ? t("activity.loading") : t("activity.empty")}
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
                            {statusLabel(batch.status, t)}
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
                                  : t("activity.error.retryUploads"),
                              );
                            } finally {
                              setRetryingBatchId(null);
                            }
                          }}
                          className="mt-3 rounded-full bg-white px-3 py-2 text-xs font-black text-emerald-800 shadow-sm disabled:text-stone-400"
                        >
                          {retryingBatchId === batch.id
                            ? t("activity.retrying")
                            : t("activity.retryFailedUploads")}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
                {visibleJobs.map((job) => (
                  (() => {
                    const faceReviewHref = getFaceReviewHref(job);
                    const shouldShowFaceReview =
                      job.status === "waiting_for_user" && faceReviewHref;

                    return (
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
                              {statusLabel(job.status, t)}
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
                        {shouldShowFaceReview ? (
                          <a
                            href={faceReviewHref}
                            onClick={closePanel}
                            className="mt-3 inline-flex rounded-full bg-emerald-700 px-3 py-2 text-xs font-black text-white shadow-sm"
                          >
                            {t("activity.action.reviewFaces")}
                          </a>
                        ) : null}
                      </article>
                    );
                  })()
                ))}
              </>
            )}
          </div>
        </section>
      ) : null}

      <div className="inline-flex overflow-hidden rounded-full bg-stone-950 text-white shadow-2xl">
        <button
          type="button"
          onClick={() => {
            if (isOpen) {
              closePanel();
              return;
            }
            setIsOpen(true);
          }}
          className="px-4 py-3 text-sm font-black"
        >
          {attentionCount > 0
            ? t("activity.summary.attention", { count: attentionCount })
            : activeCount > 0
              ? t("activity.summary.running", { count: activeCount })
              : t("activity.summary.failed", { count: visibleFailedCount })}
        </button>
        <button
          type="button"
          aria-label={t("activity.action.dismiss")}
          onClick={(event) => {
            event.stopPropagation();
            dismissCurrentActivity();
          }}
          className="grid min-h-11 w-10 place-items-center border-l border-white/10 bg-white/10 text-sm font-black hover:bg-white/20"
        >
          ×
        </button>
      </div>
    </div>
  );
}
