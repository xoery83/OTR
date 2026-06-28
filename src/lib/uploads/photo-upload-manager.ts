"use client";

import {
  createBackgroundJob,
  createBackgroundJobBatch,
  enqueueMediaProcessingJobs,
  updateBackgroundJob,
  updateBackgroundJobBatch,
} from "@/lib/background-jobs/client";
import type {
  BackgroundJob,
  BackgroundJobBatch,
  UpdateBackgroundJobBatchInput,
  UpdateBackgroundJobInput,
} from "@/lib/background-jobs/types";
import { compressImageFile, makeSafeFileName } from "@/lib/images";
import { supabase } from "@/lib/supabase/client";
import { createImageMediaAsset } from "@/lib/supabase/media-assets";

type StartPhotoUploadBatchInput = {
  journeyId: string;
  dayId?: string | null;
  plannerItemId?: string | null;
  triggeredBy?: string;
  files: File[];
};

type UploadRuntimeItem = {
  file: File;
  job: BackgroundJob;
  status: "queued" | "uploading" | "completed" | "failed";
};

type UploadRuntimeBatch = {
  batch: BackgroundJobBatch;
  items: UploadRuntimeItem[];
  started: boolean;
};

const runtimeBatches = new Map<string, UploadRuntimeBatch>();

function nowIso() {
  return new Date().toISOString();
}

function isRuntimeOnlyId(id: string) {
  return id.startsWith("runtime-");
}

function emitActivityChanged() {
  window.dispatchEvent(new CustomEvent("otr:background-jobs-changed"));
}

function emitUploadCompleted(input: {
  totalFiles: number;
  uploadedFiles: number;
  failedFiles: number;
}) {
  window.dispatchEvent(
    new CustomEvent("otr:photo-upload-completed", {
      detail: input,
    }),
  );
}

function metadataForFile(file: File) {
  return {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    lastModified: file.lastModified || null,
  };
}

function patchRuntimeBatch(
  runtime: UploadRuntimeBatch,
  patch: UpdateBackgroundJobBatchInput,
) {
  Object.assign(runtime.batch, {
    ...patch,
    updatedAt: nowIso(),
  });
}

async function saveRuntimeBatch(
  runtime: UploadRuntimeBatch,
  patch: UpdateBackgroundJobBatchInput,
) {
  patchRuntimeBatch(runtime, patch);
  if (!isRuntimeOnlyId(runtime.batch.id)) {
    const updated = await updateBackgroundJobBatch(runtime.batch.id, patch).catch(
      () => null,
    );
    if (updated) Object.assign(runtime.batch, updated);
  }
}

function patchRuntimeJob(item: UploadRuntimeItem, patch: UpdateBackgroundJobInput) {
  Object.assign(item.job, {
    ...patch,
    updatedAt: nowIso(),
  });
}

async function saveRuntimeJob(
  item: UploadRuntimeItem,
  patch: UpdateBackgroundJobInput,
) {
  patchRuntimeJob(item, patch);
  if (!isRuntimeOnlyId(item.job.id)) {
    const updated = await updateBackgroundJob(item.job.id, patch).catch(() => null);
    if (updated) Object.assign(item.job, updated);
  }
}

function createRuntimeOnlyBatch(
  input: StartPhotoUploadBatchInput,
  createError?: unknown,
): UploadRuntimeBatch {
  const createdAt = nowIso();
  const batchId = `runtime-${crypto.randomUUID()}`;
  const errorMessage =
    createError instanceof Error ? createError.message : "Could not create job batch.";
  const batch: BackgroundJobBatch = {
    id: batchId,
    journeyId: input.journeyId,
    userId: null,
    batchType: "photo_upload",
    title: `Uploading ${input.files.length} photos`,
    totalItems: input.files.length,
    completedItems: 0,
    failedItems: 0,
    status: "queued",
    currentStep: "Queued in this browser",
    metadata: {
      dayId: input.dayId ?? null,
      plannerItemId: input.plannerItemId ?? null,
      triggeredBy: input.triggeredBy ?? "capture",
      runtimeOnly: true,
      createError: errorMessage,
    },
    createdAt,
    updatedAt: createdAt,
  };

  return {
    batch,
    items: input.files.map((file) => ({
      file,
      status: "queued",
      job: {
        id: `runtime-${crypto.randomUUID()}`,
        batchId,
        journeyId: input.journeyId,
        userId: null,
        jobType: "photo_upload",
        title: file.name || "Photo upload",
        status: "queued",
        progress: 0,
        currentStep: "Queued",
        payload: {
          batchId,
          dayId: input.dayId ?? null,
          plannerItemId: input.plannerItemId ?? null,
          triggeredBy: input.triggeredBy ?? "capture",
          runtimeOnly: true,
          ...metadataForFile(file),
        },
        result: {},
        errorMessage: null,
        attempts: 0,
        availableAt: createdAt,
        startedAt: null,
        completedAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    })),
    started: false,
  };
}

export function listRuntimePhotoUploadBatches() {
  return Array.from(runtimeBatches.values()).map((runtime) => runtime.batch);
}

function runRuntimeBatch(runtime: UploadRuntimeBatch) {
  void processRuntimeBatch(runtime).catch(async (error) => {
    const message =
      error instanceof Error ? error.message : "Photo upload batch failed.";
    runtime.items.forEach((item) => {
      if (item.status !== "completed") {
        item.status = "failed";
        patchRuntimeJob(item, {
          status: "failed",
          progress: 100,
          currentStep: "Upload failed",
          errorMessage: message,
        });
      }
    });
    const completedItems = runtime.items.filter(
      (item) => item.status === "completed",
    ).length;
    const failedItems = runtime.items.length - completedItems;
    await saveRuntimeBatch(runtime, {
      status: "failed",
      completedItems,
      failedItems,
      currentStep: `${completedItems} photos uploaded, ${failedItems} failed`,
    });
    emitActivityChanged();
    emitUploadCompleted({
      totalFiles: runtime.batch.totalItems,
      uploadedFiles: completedItems,
      failedFiles: failedItems,
    });
  });
}

async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("You must be logged in to upload photos.");
  }
  return data.user.id;
}

async function uploadPhotoFile(input: {
  journeyId: string;
  userId: string;
  file: File;
  dayId?: string | null;
  plannerItemId?: string | null;
  triggeredBy?: string;
}) {
  const compressed = await compressImageFile(input.file);
  const timestamp = Date.now();
  const safeFileName = makeSafeFileName(input.file.name);
  const compressedFilePath = `${input.journeyId}/${input.userId}/compressed/${timestamp}-${crypto.randomUUID()}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("trip-media")
    .upload(compressedFilePath, compressed.blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const mediaAssetId = crypto.randomUUID();
  const takenAt = input.file.lastModified
    ? new Date(input.file.lastModified).toISOString()
    : null;

  const asset = await createImageMediaAsset({
    id: mediaAssetId,
    tripId: input.journeyId,
    userId: input.userId,
    memoryEntryId: null,
    compressedFilePath,
    compressedFileSize: compressed.blob.size,
    originalFileSize: input.file.size,
    mimeType: "image/jpeg",
    width: compressed.width,
    height: compressed.height,
    takenAt,
    exifJson: metadataForFile(input.file),
    aiMetadata: {
      dayId: input.dayId ?? null,
      plannerItemId: input.plannerItemId ?? null,
      triggeredBy: input.triggeredBy ?? "capture",
      originalFileName: input.file.name,
    },
  });

  await enqueueMediaProcessingJobs({
    tripId: input.journeyId,
    mediaAssetId: asset.id,
    title: input.file.name || "Photo processing",
    placeholder: true,
    currentStep: "Pending implementation",
  }).catch(() => null);

  return asset;
}

async function processRuntimeBatch(runtime: UploadRuntimeBatch) {
  if (runtime.started) return;
  runtime.started = true;

  const userId = await getCurrentUserId();
  let completedItems = 0;
  let failedItems = 0;

  await saveRuntimeBatch(runtime, {
    status: "uploading",
    currentStep: `Uploading 0/${runtime.batch.totalItems}`,
  });
  emitActivityChanged();

  for (const item of runtime.items) {
    if (item.status === "completed") {
      completedItems += 1;
      continue;
    }

    item.status = "uploading";
    await saveRuntimeJob(item, {
      status: "uploading",
      progress: 10,
      currentStep: "Preparing photo",
      errorMessage: null,
    });
    emitActivityChanged();

    try {
      await saveRuntimeJob(item, {
        status: "uploading",
        progress: 35,
        currentStep: "Uploading photo",
      });
      const asset = await uploadPhotoFile({
        journeyId: runtime.batch.journeyId || "",
        userId,
        file: item.file,
        dayId:
          typeof runtime.batch.metadata.dayId === "string"
            ? runtime.batch.metadata.dayId
            : null,
        plannerItemId:
          typeof runtime.batch.metadata.plannerItemId === "string"
            ? runtime.batch.metadata.plannerItemId
            : null,
        triggeredBy:
          typeof runtime.batch.metadata.triggeredBy === "string"
            ? runtime.batch.metadata.triggeredBy
            : "capture",
      });

      item.status = "completed";
      completedItems += 1;
      await saveRuntimeJob(item, {
        status: "completed",
        progress: 100,
        currentStep: "Photo uploaded",
        result: {
          mediaAssetId: asset.id,
          compressedFilePath: asset.compressedFilePath,
        },
      });
    } catch (error) {
      item.status = "failed";
      failedItems += 1;
      await saveRuntimeJob(item, {
        status: "failed",
        progress: 100,
        currentStep: "Upload failed",
        errorMessage:
          error instanceof Error ? error.message : "Photo upload failed.",
      });
    }

    await saveRuntimeBatch(runtime, {
      status: failedItems > 0 ? "failed" : "uploading",
      completedItems,
      failedItems,
      currentStep:
        failedItems > 0
          ? `${completedItems} uploaded, ${failedItems} failed`
          : `Uploading ${completedItems}/${runtime.batch.totalItems}`,
    });
    emitActivityChanged();
  }

  const finalStatus = failedItems > 0 ? "failed" : "completed";
  await saveRuntimeBatch(runtime, {
    status: finalStatus,
    completedItems,
    failedItems,
    currentStep:
      finalStatus === "completed"
        ? "Organizing photos in background..."
        : `${completedItems} photos uploaded, ${failedItems} failed`,
  });
  emitActivityChanged();
  emitUploadCompleted({
    totalFiles: runtime.batch.totalItems,
    uploadedFiles: completedItems,
    failedFiles: failedItems,
  });
}

export async function startPhotoUploadBatch(input: StartPhotoUploadBatchInput) {
  if (input.files.length < 2) {
    throw new Error("Use the foreground Capture flow for a single photo.");
  }

  let runtime: UploadRuntimeBatch;
  try {
    const batch = await createBackgroundJobBatch({
      journeyId: input.journeyId,
      batchType: "photo_upload",
      title: `Uploading ${input.files.length} photos`,
      totalItems: input.files.length,
      currentStep: "Queued",
      metadata: {
        dayId: input.dayId ?? null,
        plannerItemId: input.plannerItemId ?? null,
        triggeredBy: input.triggeredBy ?? "capture",
      },
    });

    const jobs = await Promise.all(
      input.files.map((file) =>
        createBackgroundJob({
          journeyId: input.journeyId,
          batchId: batch.id,
          jobType: "photo_upload",
          title: file.name || "Photo upload",
          currentStep: "Queued",
          payload: {
            batchId: batch.id,
            dayId: input.dayId ?? null,
            plannerItemId: input.plannerItemId ?? null,
            triggeredBy: input.triggeredBy ?? "capture",
            ...metadataForFile(file),
          },
        }),
      ),
    );

    runtime = {
      batch,
      items: input.files.map((file, index) => ({
        file,
        job: jobs[index],
        status: "queued",
      })),
      started: false,
    };
  } catch (error) {
    runtime = createRuntimeOnlyBatch(input, error);
  }
  runtimeBatches.set(runtime.batch.id, runtime);
  emitActivityChanged();
  runRuntimeBatch(runtime);

  return runtime.batch;
}

export async function retryFailedPhotoUploadBatch(batchId: string) {
  const runtime = runtimeBatches.get(batchId);
  if (!runtime) {
    throw new Error(
      "This upload can only be retried while the original browser tab is still open.",
    );
  }

  const failedItems = runtime.items.filter((item) => item.status === "failed");
  if (failedItems.length === 0) return;

  runtime.started = false;
  for (const item of failedItems) {
    item.status = "queued";
    await saveRuntimeJob(item, {
      status: "queued",
      progress: 0,
      currentStep: "Queued for retry",
      errorMessage: null,
    });
  }

  await saveRuntimeBatch(runtime, {
    status: "uploading",
    failedItems: 0,
    currentStep: "Retrying failed uploads",
  });
  emitActivityChanged();
  runRuntimeBatch(runtime);
}
