export type BackgroundJobStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "cancelled";

export type BackgroundJobType =
  | "photo_upload"
  | "image_indexing"
  | "face_detection"
  | "face_recognition"
  | string;

export type BackgroundJobBatch = {
  id: string;
  journeyId: string | null;
  userId: string | null;
  batchType: string;
  title: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  status: BackgroundJobStatus;
  currentStep: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BackgroundJob = {
  id: string;
  batchId: string | null;
  journeyId: string | null;
  userId: string | null;
  jobType: BackgroundJobType;
  title: string;
  status: BackgroundJobStatus;
  progress: number;
  currentStep: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  errorMessage: string | null;
  attempts: number;
  availableAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateBackgroundJobInput = {
  journeyId?: string | null;
  batchId?: string | null;
  jobType: BackgroundJobType;
  title: string;
  payload?: Record<string, unknown>;
  currentStep?: string | null;
};

export type UpdateBackgroundJobInput = {
  status?: BackgroundJobStatus;
  progress?: number;
  currentStep?: string | null;
  result?: Record<string, unknown>;
  errorMessage?: string | null;
};

export type CreateBackgroundJobBatchInput = {
  journeyId?: string | null;
  batchType: string;
  title: string;
  totalItems?: number;
  currentStep?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpdateBackgroundJobBatchInput = {
  status?: BackgroundJobStatus;
  totalItems?: number;
  completedItems?: number;
  failedItems?: number;
  currentStep?: string | null;
  metadata?: Record<string, unknown>;
};
