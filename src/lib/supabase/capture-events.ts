import { supabase } from "./client";

export async function createRawCaptureEvent(input: {
  tripId: string;
  inputType: "text" | "voice" | "photo" | "video" | "attachment";
  originalInput?: string | null;
  capturedAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("You must be logged in to capture.");
  }

  const response = await fetch("/api/capture/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...input,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      capturedAt: input.capturedAt ?? new Date().toISOString(),
    }),
  });
  const payload = (await response.json()) as {
    captureEventId?: string;
    error?: string;
  };

  if (!response.ok || !payload.captureEventId) {
    throw new Error(payload.error || "Could not save capture event.");
  }

  return payload.captureEventId;
}

