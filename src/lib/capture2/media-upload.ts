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
  captureEventId?: string;
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

export type Capture2UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
  phase: "uploading" | "server_processing" | "completed";
};

export async function uploadCapture2Media(input: {
  tripId: string;
  files: File[];
  fileMetadata: Capture2UploadFileMetadata[];
  onUploadProgress?: (progress: Capture2UploadProgress) => void;
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

  return new Promise<Capture2UploadResponse>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", "/api/capture2/media/upload");
    request.setRequestHeader("Authorization", `Bearer ${accessToken}`);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !input.onUploadProgress) return;
      input.onUploadProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
        phase: event.loaded >= event.total ? "server_processing" : "uploading",
      });
    };

    request.onload = () => {
      let payload: Partial<Capture2UploadResponse> & { error?: string } = {};
      try {
        payload = JSON.parse(request.responseText || "{}") as Partial<Capture2UploadResponse> & {
          error?: string;
        };
      } catch {
        reject(new Error("Could not read media upload response."));
        return;
      }

      if (request.status < 200 || request.status >= 300 || !payload.mediaAssetIds) {
        reject(new Error(payload.error || "Could not upload media."));
        return;
      }

      input.onUploadProgress?.({ loaded: 1, total: 1, percent: 100, phase: "completed" });
      resolve(payload as Capture2UploadResponse);
    };

    request.onerror = () => reject(new Error("Could not upload media."));
    request.onabort = () => reject(new Error("Media upload was cancelled."));
    request.send(formData);
  });
}
