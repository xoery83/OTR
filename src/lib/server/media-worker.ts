export type MediaWorkerVariant = {
  url: string;
  path: string;
  width: number;
  height: number;
  file_size: number;
  variant_type: "thumbnail" | "preview";
};

export type MediaWorkerGenerateResponse = {
  asset_id: string;
  journey_id: string;
  thumbnail: MediaWorkerVariant;
  preview: MediaWorkerVariant;
};

function uniqueWorkerUrls(primaryUrl: string) {
  const urls = [
    primaryUrl,
    process.env.MEDIA_WORKER_FALLBACK_URL,
    process.env.AI_SERVER_URL ? `${process.env.AI_SERVER_URL.replace(/\/$/, "")}/media` : null,
  ]
    .filter((url): url is string => Boolean(url))
    .map((url) => url.replace(/\/$/, ""));

  return [...new Set(urls)];
}

async function postToWorker(
  workerUrl: string,
  workerSecret: string,
  input: {
    assetId: string;
    filename: string;
    journeyId: string;
    mimeType: string;
    originalBuffer: Buffer;
  },
) {
  const form = new FormData();
  form.append("journey_id", input.journeyId);
  form.append("asset_id", input.assetId);
  form.append(
    "file",
    new Blob([new Uint8Array(input.originalBuffer)], { type: input.mimeType }),
    input.filename,
  );

  const response = await fetch(`${workerUrl}/generate`, {
    method: "POST",
    headers: {
      "x-media-worker-secret": workerSecret,
    },
    body: form,
  });

  const payload = (await response.json().catch(() => null)) as
    | MediaWorkerGenerateResponse
    | { detail?: string }
    | null;

  if (!response.ok || !payload || !("thumbnail" in payload)) {
    throw new Error(
      (payload && "detail" in payload ? payload.detail : null) ||
        `Could not generate media variants via ${workerUrl}.`,
    );
  }

  return payload;
}

export async function generateHetznerMediaVariants(input: {
  journeyId: string;
  assetId: string;
  filename: string;
  mimeType: string;
  originalBuffer: Buffer;
}) {
  const workerUrl = process.env.MEDIA_WORKER_URL?.replace(/\/$/, "");
  const workerSecret = process.env.MEDIA_WORKER_SECRET;

  if (!workerUrl || !workerSecret) {
    throw new Error("MEDIA_WORKER_URL and MEDIA_WORKER_SECRET are required.");
  }

  const urls = uniqueWorkerUrls(workerUrl);
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      return await postToWorker(url, workerSecret, input);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "Could not reach the Hetzner media worker.",
  );
}
