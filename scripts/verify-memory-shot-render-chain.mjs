#!/usr/bin/env node

const defaultBaseUrl = process.env.OTR_BASE_URL || "http://localhost:3000";

function usage() {
  return `
Memory Shot render chain verification

Usage:
  node scripts/verify-memory-shot-render-chain.mjs \\
    --base-url http://localhost:3000 \\
    --journey-id <journey-id> \\
    --date 2026-07-09 \\
    --token <current-user-access-token> \\
    --language en

Motion Story only:
  node scripts/verify-memory-shot-render-chain.mjs \\
    --base-url http://localhost:3000 \\
    --journey-id <journey-id> \\
    --memory-shot-id <ready-memory-shot-id> \\
    --motion-story-only \\
    --token <current-user-access-token>

Poster 01 rerender only:
  node scripts/verify-memory-shot-render-chain.mjs \\
    --base-url http://localhost:3000 \\
    --journey-id <journey-id> \\
    --memory-shot-id <ready-memory-shot-id> \\
    --layout-key cinematic_full_bleed \\
    --poster-only \\
    --token <current-user-access-token>

Required:
  --journey-id  Journey/trip id to generate in.
  --date        Date to generate, in YYYY-MM-DD format, unless --memory-shot-id is provided.
  --token       Supabase access token for the currently logged-in user.

Env alternatives:
  OTR_BASE_URL
  JOURNEY_ID
  MEMORY_SHOT_ID
  MEMORY_SHOT_DATE
  OTR_ACCESS_TOKEN, SUPABASE_ACCESS_TOKEN, or MEMORY_SHOT_VERIFY_TOKEN
  MEMORY_SHOT_LANGUAGE
  MEMORY_SHOT_LAYOUT_KEY

Get token from the logged-in browser console:
  const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
  const value = JSON.parse(localStorage.getItem(key));
  copy(value.access_token || value.currentSession?.access_token);
`.trim();
}

function parseArgs(argv) {
  const args = {
    baseUrl: defaultBaseUrl,
    journeyId: process.env.JOURNEY_ID || "",
    memoryShotId: process.env.MEMORY_SHOT_ID || "",
    date: process.env.MEMORY_SHOT_DATE || "",
    token:
      process.env.OTR_ACCESS_TOKEN ||
      process.env.SUPABASE_ACCESS_TOKEN ||
      process.env.MEMORY_SHOT_VERIFY_TOKEN ||
      "",
    language: process.env.MEMORY_SHOT_LANGUAGE || "en",
    layoutKey: process.env.MEMORY_SHOT_LAYOUT_KEY || "cinematic_full_bleed",
    motionStoryOnly: false,
    posterOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      args.help = true;
      continue;
    }
    if (key === "--motion-story-only") {
      args.motionStoryOnly = true;
      continue;
    }
    if (key === "--poster-only") {
      args.posterOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--")) continue;
    if (!value || value.startsWith("--")) {
      throw new Error(`${key} requires a value.`);
    }
    index += 1;

    if (key === "--base-url") args.baseUrl = value;
    else if (key === "--journey-id" || key === "--journeyId") args.journeyId = value;
    else if (key === "--memory-shot-id" || key === "--memoryShotId") {
      args.memoryShotId = value;
    }
    else if (key === "--date") args.date = value;
    else if (key === "--token") args.token = value;
    else if (key === "--language") args.language = value;
    else if (key === "--layout-key" || key === "--layoutKey") args.layoutKey = value;
    else throw new Error(`Unknown option: ${key}`);
  }

  return args;
}

function requireArgs(args) {
  const missing = [];
  if (!args.journeyId) missing.push("--journey-id");
  if (!args.date && !args.memoryShotId) missing.push("--date or --memory-shot-id");
  if (!args.token) missing.push("--token or OTR_ACCESS_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      [
        `Missing required input: ${missing.join(", ")}`,
        "",
        usage(),
      ].join("\n"),
    );
  }
}

function printEnvHints() {
  const hints = [];
  if (!process.env.MEDIA_WORKER_URL) {
    hints.push(
      "MEDIA_WORKER_URL is not set in this shell. If the app server also lacks it, preview/thumbnail should fallback to Supabase.",
    );
  }
  if (!process.env.MEDIA_WORKER_SECRET) {
    hints.push(
      "MEDIA_WORKER_SECRET is not set in this shell. If the app server also lacks it, preview/thumbnail should fallback to Supabase.",
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    hints.push(
      "SUPABASE_SERVICE_ROLE_KEY is not set in this shell. If the app server also lacks it, Google Drive original render should fallback to Supabase.",
    );
  }
  if (!process.env.MEDIA_WORKER_URL || !process.env.MEDIA_WORKER_SECRET) {
    hints.push(
      "Motion Story HTML/manifest should fallback to Supabase if the app server lacks media worker env.",
    );
  }

  if (hints.length > 0) {
    console.log("Local env hints");
    hints.forEach((hint) => console.log(`- ${hint}`));
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || "Response was not JSON." };
  }
}

async function requestJson(args, path, init = {}) {
  const response = await fetch(`${args.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await readJson(response);

  if (!response.ok) {
    const message = payload.error || payload.detail || response.statusText;
    const error = new Error(`${response.status} ${message}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function renderSummary(memoryShot) {
  if (!memoryShot) return null;
  return {
    id: memoryShot.id,
    status: memoryShot.status,
    title: memoryShot.title,
    renderStatus: memoryShot.renderStatus,
    renderError: memoryShot.renderError,
    renderWarning: memoryShot.renderWarning,
    previewUrl: memoryShot.previewUrl,
    thumbnailUrl: memoryShot.thumbnailUrl,
    originalDriveFileId: memoryShot.originalDriveFileId,
    originalDriveUrl: memoryShot.originalDriveUrl,
    storage: {
      original: {
        provider: memoryShot.originalStorageProvider,
        path: memoryShot.originalStoragePath,
      },
      preview: {
        provider: memoryShot.previewStorageProvider,
        path: memoryShot.previewStoragePath,
      },
      thumbnail: {
        provider: memoryShot.thumbnailStorageProvider,
        path: memoryShot.thumbnailStoragePath,
      },
    },
    metadataRender: memoryShot.metadata?.render ?? null,
  };
}

function motionStorySummary(result) {
  const artifact = result.artifact || {};
  const storage = result.storage || artifact.storage || {};
  return {
    artifactId: artifact.id,
    artifactType: artifact.artifactType,
    variant: artifact.variant,
    status: artifact.status,
    publicUrl: result.publicUrl || artifact.publicUrl,
    previewUrl: result.previewUrl || artifact.previewUrl,
    thumbnailUrl: result.thumbnailUrl || artifact.thumbnailUrl,
    renderError: artifact.renderError,
    renderWarning: result.renderWarning || artifact.renderWarning,
    storage: {
      web: {
        provider: storage.web?.provider,
        path: storage.web?.path,
        url: storage.web?.url,
      },
      manifest: {
        provider: storage.manifest?.provider,
        path: storage.manifest?.path,
        url: storage.manifest?.url,
      },
      assets: storage.assets ?? null,
    },
  };
}

async function fetchTextUrl(url, label) {
  if (!url) {
    return { ok: false, status: null, message: `${label} URL missing.` };
  }
  try {
    const response = await fetch(url);
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      message: response.ok
        ? `${label} URL is accessible.`
        : `${label} URL returned ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      message:
        error instanceof Error
          ? `${label} URL fetch failed: ${error.message}`
          : `${label} URL fetch failed.`,
    };
  }
}

function inspectMotionStoryHtml(html) {
  const lower = html.toLowerCase();
  return {
    hasHtml: lower.includes("<!doctype html") || lower.includes("<html"),
    hasScriptTag: /<\s*script\b/i.test(html),
    hasOtrBranding: html.includes("OTR"),
    hasJavascriptUrl: /javascript:/i.test(html),
  };
}

async function verifyMotionStory(args, memoryShotId) {
  const motionPayload = await requestJson(
    args,
    `/api/journeys/${encodeURIComponent(args.journeyId)}/memory-shots/${encodeURIComponent(
      memoryShotId,
    )}/motion-story`,
    { method: "POST", body: JSON.stringify({}) },
  );

  console.log("Motion Story Result");
  console.log(JSON.stringify(motionStorySummary(motionPayload), null, 2));

  const manifestUrl =
    motionPayload.storage?.manifest?.url ||
    motionPayload.artifact?.storage?.manifest?.url ||
    null;
  const htmlUrl =
    motionPayload.publicUrl ||
    motionPayload.previewUrl ||
    motionPayload.storage?.web?.url ||
    motionPayload.artifact?.publicUrl ||
    motionPayload.artifact?.previewUrl ||
    null;

  const manifestFetch = await fetchTextUrl(manifestUrl, "Manifest");
  console.log("Manifest Check");
  console.log(
    JSON.stringify(
      {
        ok: manifestFetch.ok,
        status: manifestFetch.status,
        message: manifestFetch.message,
        parsesAsJson: (() => {
          try {
            JSON.parse(manifestFetch.text || "");
            return true;
          } catch {
            return false;
          }
        })(),
      },
      null,
      2,
    ),
  );

  const htmlFetch = await fetchTextUrl(htmlUrl, "HTML");
  const htmlSafety = htmlFetch.text
    ? inspectMotionStoryHtml(htmlFetch.text)
    : null;
  console.log("HTML Check");
  console.log(
    JSON.stringify(
      {
        ok: htmlFetch.ok,
        status: htmlFetch.status,
        message: htmlFetch.message,
        safety: htmlSafety,
      },
      null,
      2,
    ),
  );

  if (!motionPayload.artifact?.id) {
    throw new Error("Motion Story API did not return artifact.id.");
  }
  if (motionPayload.artifact.status !== "ready") {
    throw new Error(`Motion Story artifact is not ready: ${motionPayload.artifact.status}`);
  }
  if (!manifestFetch.ok) throw new Error(manifestFetch.message);
  if (!htmlFetch.ok) throw new Error(htmlFetch.message);
  if (htmlSafety?.hasScriptTag || htmlSafety?.hasJavascriptUrl) {
    throw new Error("Motion Story HTML safety check failed.");
  }
  if (!htmlSafety?.hasOtrBranding) {
    throw new Error("Motion Story HTML is missing OTR branding.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  requireArgs(args);

  console.log("Memory Shot render chain verification");
  console.log(
    JSON.stringify(
      {
        baseUrl: args.baseUrl,
        journeyId: args.journeyId,
        memoryShotId: args.memoryShotId || null,
        date: args.date,
        language: args.language,
        layoutKey: args.layoutKey,
        motionStoryOnly: args.motionStoryOnly,
        posterOnly: args.posterOnly,
      },
      null,
      2,
    ),
  );
  printEnvHints();

  if (args.motionStoryOnly) {
    if (!args.memoryShotId) {
      throw new Error("--motion-story-only requires --memory-shot-id.");
    }
    await verifyMotionStory(args, args.memoryShotId);
    return;
  }

  let generatedShot = null;
  if (args.memoryShotId) {
    generatedShot = { id: args.memoryShotId };
  } else {
    const generatePayload = await requestJson(
      args,
      `/api/journeys/${encodeURIComponent(args.journeyId)}/memory-shots/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          templateKey: "memory_shot_daily_best_moments",
          date: args.date,
          language: args.language,
        }),
      },
    );
    generatedShot = generatePayload.memoryShot;
  }
  if (!generatedShot?.id) {
    throw new Error("Generate API did not return memoryShot.id.");
  }

  console.log(args.memoryShotId ? "Using Existing Memory Shot" : "Generated Memory Shot");
  console.log(JSON.stringify(renderSummary(generatedShot), null, 2));

  const renderPayload = await requestJson(
    args,
    `/api/journeys/${encodeURIComponent(args.journeyId)}/memory-shots/${encodeURIComponent(
      generatedShot.id,
    )}/render`,
    {
      method: "POST",
      body: JSON.stringify({
        force: true,
        layoutKey: args.layoutKey,
      }),
    },
  );

  console.log("Render Retry Result");
  console.log(JSON.stringify(renderPayload, null, 2));

  const listPayload = await requestJson(
    args,
    `/api/journeys/${encodeURIComponent(args.journeyId)}/memory-shots`,
  );
  const latestShot =
    listPayload.memoryShots?.find((shot) => shot.id === generatedShot.id) ??
    generatedShot;

  console.log("Final Storage Summary");
  console.log(JSON.stringify(renderSummary(latestShot), null, 2));

  if (args.posterOnly) {
    return;
  }

  await verifyMotionStory(args, generatedShot.id);
}

main().catch((error) => {
  console.error("Verification failed");
  console.error(error.message || error);
  if (error.payload) {
    console.error(JSON.stringify(error.payload, null, 2));
  }
  process.exit(1);
});
