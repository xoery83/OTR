import { supabase } from "@/lib/supabase/client";
import type {
  BackgroundJobBatch,
  BackgroundJob,
  CreateBackgroundJobBatchInput,
  CreateBackgroundJobInput,
  BackgroundJobStatus,
  UpdateBackgroundJobBatchInput,
  UpdateBackgroundJobInput,
} from "./types";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("You must be logged in.");
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

function emitBackgroundJobsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("otr:background-jobs-changed"));
}

export async function listBackgroundJobs() {
  const response = await fetch("/api/background-jobs", {
    headers: await authHeaders(),
  });
  const payload = (await response.json()) as {
    jobs?: BackgroundJob[];
    error?: string;
  };

  if (!response.ok || !payload.jobs) {
    throw new Error(payload.error || "Could not load background jobs.");
  }

  return payload.jobs;
}

export async function listBackgroundJobBatches() {
  const response = await fetch("/api/background-jobs/batches", {
    headers: await authHeaders(),
  });
  const payload = (await response.json()) as {
    batches?: BackgroundJobBatch[];
    error?: string;
  };

  if (!response.ok || !payload.batches) {
    throw new Error(payload.error || "Could not load background job batches.");
  }

  return payload.batches;
}

export async function createBackgroundJobBatch(
  input: CreateBackgroundJobBatchInput,
) {
  const response = await fetch("/api/background-jobs/batches", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    batch?: BackgroundJobBatch;
    error?: string;
  };

  if (!response.ok || !payload.batch) {
    throw new Error(payload.error || "Could not create background job batch.");
  }

  emitBackgroundJobsChanged();
  return payload.batch;
}

export async function updateBackgroundJobBatch(
  batchId: string,
  input: UpdateBackgroundJobBatchInput,
) {
  const response = await fetch(`/api/background-jobs/batches/${batchId}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    batch?: BackgroundJobBatch;
    error?: string;
  };

  if (!response.ok || !payload.batch) {
    throw new Error(payload.error || "Could not update background job batch.");
  }

  emitBackgroundJobsChanged();
  return payload.batch;
}

export async function createBackgroundJob(input: CreateBackgroundJobInput) {
  const response = await fetch("/api/background-jobs", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    job?: BackgroundJob;
    error?: string;
  };

  if (!response.ok || !payload.job) {
    throw new Error(payload.error || "Could not create background job.");
  }

  emitBackgroundJobsChanged();
  return payload.job;
}

export async function updateBackgroundJob(
  jobId: string,
  input: UpdateBackgroundJobInput,
) {
  const response = await fetch(`/api/background-jobs/${jobId}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    job?: BackgroundJob;
    error?: string;
  };

  if (!response.ok || !payload.job) {
    throw new Error(payload.error || "Could not update background job.");
  }

  emitBackgroundJobsChanged();
  return payload.job;
}

export async function dismissBackgroundActivity(
  activities: Array<{
    type: "job" | "batch";
    id: string;
    status: BackgroundJobStatus;
  }>,
) {
  if (activities.length === 0) return 0;

  const response = await fetch("/api/background-jobs/dismiss", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ activities }),
  });
  const payload = (await response.json()) as {
    dismissed?: number;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Could not dismiss background activity.");
  }

  emitBackgroundJobsChanged();
  return payload.dismissed ?? activities.length;
}

export async function listDismissedBackgroundActivity(activityKeys: string[]) {
  if (activityKeys.length === 0) return [];

  const response = await fetch("/api/background-jobs/dismissals", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ activityKeys }),
  });
  const payload = (await response.json()) as {
    activityKeys?: string[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(
      payload.error || "Could not load dismissed background activity.",
    );
  }

  return payload.activityKeys ?? [];
}

export async function enqueueMediaProcessingJobs(input: {
  tripId: string;
  mediaAssetId: string;
  title?: string;
  placeholder?: boolean;
  currentStep?: string | null;
}) {
  const payload = {
    tripId: input.tripId,
    mediaAssetId: input.mediaAssetId,
    ...(input.placeholder
      ? {
          placeholder: true,
          pendingImplementation: true,
        }
      : {}),
  };
  const currentStep =
    input.currentStep ??
    (input.placeholder ? "Queued after upload" : "Queued");

  const jobsToCreate: CreateBackgroundJobInput[] = [
    {
      journeyId: input.tripId,
      jobType: "image_indexing",
      title: input.title || "Image indexing",
      currentStep,
      payload,
    },
    {
      journeyId: input.tripId,
      jobType: "face_detection",
      title: "Face detection",
      currentStep,
      payload,
    },
  ];

  if (input.placeholder) {
    jobsToCreate.push({
      journeyId: input.tripId,
      jobType: "face_recognition",
      title: "Face recognition",
      currentStep,
      payload,
    });
  }

  return Promise.all(jobsToCreate.map((job) => createBackgroundJob(job)));
}
