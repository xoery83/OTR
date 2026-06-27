import { supabase } from "@/lib/supabase/client";
import type {
  CaptureIntentConfig,
  CaptureIntentDetection,
  CaptureIntentTestInput,
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

export async function getCaptureIntentConfig() {
  const response = await fetch("/api/capture-ai/config", {
    headers: await authHeaders(),
  });
  const payload = (await response.json()) as {
    config?: CaptureIntentConfig;
    error?: string;
  };

  if (!response.ok || !payload.config) {
    throw new Error(payload.error || "Could not load Capture AI config.");
  }

  return payload.config;
}

export async function saveCaptureIntentConfig(config: CaptureIntentConfig) {
  const response = await fetch("/api/capture-ai/config", {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(config),
  });
  const payload = (await response.json()) as {
    config?: CaptureIntentConfig;
    error?: string;
  };

  if (!response.ok || !payload.config) {
    throw new Error(payload.error || "Could not save Capture AI config.");
  }

  return payload.config;
}

export async function detectCaptureIntent(input: CaptureIntentTestInput) {
  const response = await fetch("/api/capture-ai/detect", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as {
    result?: CaptureIntentDetection;
    error?: string;
  };

  if (!response.ok || !payload.result) {
    throw new Error(payload.error || "Could not detect Capture intent.");
  }

  return payload.result;
}

export async function findCaptureParserExample(input: CaptureIntentTestInput) {
  const response = await fetch("/api/capture-ai/detect", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ ...input, exampleOnly: true }),
  });
  const payload = (await response.json()) as {
    result?: CaptureIntentDetection | null;
    matched?: boolean;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || "Could not check parser examples.");
  }

  return payload.matched && payload.result ? payload.result : null;
}
