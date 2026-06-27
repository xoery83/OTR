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

  const { batch } = runtime;
  const userId = await getCurrentUserId();
  let completedItems = 0;
  let failedItems = 0;

  await updateBackgroundJobBatch(batch.id, {
    status: "uploading",
    currentStep: `Uploading 0/${batch.totalItems}`,
  }).catch(() => null);
  emitActivityChanged();

  for (const item of runtime.items) {
    if (item.status === "completed") {
      completedItems += 1;
      continue;
    }

    item.status = "uploading";
    await updateBackgroundJob(item.job.id, {
      status: "uploading",
      progress: 10,
      currentStep: "Preparing photo",
      errorMessage: null,
    });
    emitActivityChanged();

    try {
      await updateBackgroundJob(item.job.id, {
        status: "uploading",
        progress: 35,
        currentStep: "Uploading photo",
      });
      const asset = await uploadPhotoFile({
        journeyId: batch.journeyId || "",
        userId,
        file: item.file,
        dayId:
          typeof batch.metadata.dayId === "string" ? batch.metadata.dayId : null,
        plannerItemId:
          typeof batch.metadata.plannerItemId === "string"
            ? batch.metadata.plannerItemId
            : null,
        triggeredBy:
          typeof batch.metadata.triggeredBy === "string"
            ? batch.metadata.triggeredBy
            : "capture",
      });

      item.status = "completed";
      completedItems += 1;
      await updateBackgroundJob(item.job.id, {
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
      await updateBackgroundJob(item.job.id, {
        status: "failed",
        progress: 100,
        currentStep: "Upload failed",
        errorMessage:
          error instanceof Error ? error.message : "Photo upload failed.",
      }).catch(() => null);
    }

    await updateBackgroundJobBatch(batch.id, {
      status: failedItems > 0 ? "failed" : "uploading",
      completedItems,
      failedItems,
      currentStep:
        failedItems > 0
          ? `${completedItems} uploaded, ${failedItems} failed`
          : `Uploading ${completedItems}/${batch.totalItems}`,
    }).catch(() => null);
    emitActivityChanged();
  }

  const finalStatus = failedItems > 0 ? "failed" : "completed";
  await updateBackgroundJobBatch(batch.id, {
    status: finalStatus,
    completedItems,
    failedItems,
    currentStep:
      finalStatus === "completed"
        ? "Organizing photos in background..."
        : `${completedItems} photos uploaded, ${failedItems} failed`,
  }).catch(() => null);
  emitActivityChanged();
  emitUploadCompleted({
    totalFiles: batch.totalItems,
    uploadedFiles: completedItems,
    failedFiles: failedItems,
  });
}

export async function startPhotoUploadBatch(input: StartPhotoUploadBatchInput) {
  if (input.files.length < 2) {
    throw new Error("Use the foreground Capture flow for a single photo.");
  }

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

  const runtime: UploadRuntimeBatch = {
    batch,
    items: input.files.map((file, index) => ({
      file,
      job: jobs[index],
      status: "queued",
    })),
    started: false,
  };
  runtimeBatches.set(batch.id, runtime);
  emitActivityChanged();
  void processRuntimeBatch(runtime);

  return batch;
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
    item.job = await updateBackgroundJob(item.job.id, {
      status: "queued",
      progress: 0,
      currentStep: "Queued for retry",
      errorMessage: null,
    });
  }

  await updateBackgroundJobBatch(batchId, {
    status: "uploading",
    failedItems: 0,
    currentStep: "Retrying failed uploads",
  });
  emitActivityChanged();
  void processRuntimeBatch(runtime);
}

