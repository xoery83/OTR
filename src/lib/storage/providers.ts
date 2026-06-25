import type { PhotoStorageProvider } from "@/types";

export type StorageProviderName = Exclude<PhotoStorageProvider, "supabase_legacy">;

export type StorageProviderConnection = {
  provider: StorageProviderName;
  accountLabel?: string | null;
  providerAccountId?: string | null;
  accessToken?: string;
  refreshToken?: string;
};

export type JourneyFolderInput = {
  tripId: string;
  journeyName: string;
};

export type DayFolderInput = {
  journeyFolderId: string;
  dayNumber: number;
  dayDate: string;
};

export type ProviderUploadInput = {
  folderId: string;
  filename: string;
  mimeType: string;
  stream: ReadableStream<Uint8Array> | Blob;
};

export type ProviderFile = {
  provider: StorageProviderName;
  fileId: string;
  driveId?: string | null;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  webUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt?: string | null;
  modifiedAt?: string | null;
};

export interface StorageProvider {
  readonly name: StorageProviderName;

  connect(): Promise<StorageProviderConnection>;

  refreshToken(connection: StorageProviderConnection): Promise<StorageProviderConnection>;

  createJourneyFolder(input: JourneyFolderInput): Promise<{ folderId: string }>;

  createDayFolder(input: DayFolderInput): Promise<{ folderId: string }>;

  upload(input: ProviderUploadInput): Promise<ProviderFile>;

  delete(fileId: string): Promise<void>;

  listFiles(folderId: string): Promise<ProviderFile[]>;

  getThumbnail(fileId: string): Promise<Blob | null>;

  downloadStream(fileId: string): Promise<ReadableStream<Uint8Array>>;
}

export class StorageProviderNotConfiguredError extends Error {
  constructor(provider: StorageProviderName) {
    super(`${provider} storage provider is not configured yet.`);
    this.name = "StorageProviderNotConfiguredError";
  }
}

export function createUnconfiguredStorageProvider(
  provider: StorageProviderName,
): StorageProvider {
  async function notConfigured(): Promise<never> {
    throw new StorageProviderNotConfiguredError(provider);
  }

  return {
    name: provider,
    connect: notConfigured,
    refreshToken: notConfigured,
    createJourneyFolder: notConfigured,
    createDayFolder: notConfigured,
    upload: notConfigured,
    delete: notConfigured,
    listFiles: notConfigured,
    getThumbnail: notConfigured,
    downloadStream: notConfigured,
  };
}
