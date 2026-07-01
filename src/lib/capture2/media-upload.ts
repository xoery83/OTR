import { supabase } from "@/lib/supabase/client";

export type Capture2UploadFileMetadata = {
  name: string;
  size: number;
  type: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  lastModified: number | null;
};

export type Capture2UploadResponse = {
  captureEventId: string;
  mediaAssetIds: string[];
  warnings: string[];
  assets: Array<{
    id: string;
    assetType: "image" | "video";
    fileName: string;
    mimeType: string | null;
    fileSize: number;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    driveFileId: string;
    driveUrl: string | null;
    thumbnailUrl: string | null;
    previewUrl: string | null;
    warnings: string[];
  }>;
};

export async function uploadCapture2Media(input: {
  tripId: string;
  files: File[];
  fileMetadata: Capture2UploadFileMetadata[];
}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("You must be logged in to upload media.");
  }

  const formData = new FormData();
  formData.append("tripId", input.tripId);
  formData.append("capturedAt", new Date().toISOString());
  formData.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
  formData.append("fileMetadata", JSON.stringify(input.fileMetadata));
  input.files.forEach((file) => formData.append("files", file, file.name));

  const response = await fetch("/api/capture2/media/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });
  const payload = (await response.json()) as Partial<Capture2UploadResponse> & {
    error?: string;
  };

  if (!response.ok || !payload.captureEventId || !payload.mediaAssetIds) {
    throw new Error(payload.error || "Could not upload media.");
  }

  return payload as Capture2UploadResponse;
}
