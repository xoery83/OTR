import "server-only";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  uploadOriginalRender,
  uploadPreviewRender,
  uploadThumbnailRender,
} from "./render-storage-router";
import type { MemoryShot, MemoryShotAssetType } from "./types";
import {
  addMemoryShotArtifactAssets,
  createMemoryShotArtifact,
  listMemoryShotArtifacts,
  markMemoryShotArtifactFailed,
  markMemoryShotArtifactReady,
  updateMemoryShotArtifactStatus,
  type MemoryShotArtifact,
} from "./artifacts";

const originalWidth = 1080;
const originalHeight = 1440;
const previewWidth = 720;
const thumbnailWidth = 360;
const rendererVersion = "sharp-svg-story-poster-v3";

type RendererSupabase = SupabaseClient;

type RenderMemoryShotInput = {
  supabase: RendererSupabase;
  memoryShotId: string;
  force?: boolean;
};

type MemoryShotRow = {
  id: string;
  journey_id: string;
  title: string | null;
  subtitle: string | null;
  status: MemoryShot["status"];
  preview_url: string | null;
  render_status?: MemoryShot["renderStatus"];
  render_error?: string | null;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type MemoryShotAssetRow = {
  asset_type: MemoryShotAssetType;
  source_id: string;
  role: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getHtmlPreview(content: Record<string, unknown>) {
  const htmlPreview = content.htmlPreview;
  return typeof htmlPreview === "string" && htmlPreview.trim()
    ? htmlPreview
    : null;
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function storyScript(content: Record<string, unknown>) {
  const script = content.storyScript;
  return script && typeof script === "object"
    ? (script as Record<string, unknown>)
    : {};
}

function heroImageUrl(content: Record<string, unknown>) {
  const direct = content.heroImageUrl;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const scriptHero = storyScript(content).heroImageUrl;
  return typeof scriptHero === "string" && scriptHero.trim()
    ? scriptHero.trim()
    : null;
}

function storyBeats(content: Record<string, unknown>) {
  const fromScript = stringArray(storyScript(content).storyBeats).slice(0, 4);
  if (fromScript.length > 0) return fromScript;
  return stringArray(content.sections).slice(0, 4);
}

async function imageDataUri(url: string | null) {
  if (!url) return null;
  try {
    const response = await fetch(resolveImageUrl(url), {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const arrayBuffer = await response.arrayBuffer();
    const pngBuffer = await sharp(Buffer.from(arrayBuffer), { failOn: "none" })
      .rotate()
      .png()
      .toBuffer();
    const base64 = pngBuffer.toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
}

function resolveImageUrl(url: string) {
  if (/^(https?:|data:)/i.test(url)) return url;
  const base =
    process.env.OTR_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "http://localhost:3000";
  return new URL(url, base).toString();
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const hasCjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(normalized);
  const words =
    hasCjk && !normalized.includes(" ")
      ? Array.from(normalized)
      : normalized.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current}${hasCjk ? "" : " "}${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      return;
    }
    current = next;
  });
  if (current) lines.push(current);

  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines && clipped.length > 0) {
    clipped[clipped.length - 1] = `${clipped[clipped.length - 1].replace(/\.+$/, "")}...`;
  }
  return clipped;
}

function textLinesSvg(input: {
  lines: string[];
  x: number;
  y: number;
  lineHeight: number;
  size: number;
  weight?: number;
  fill: string;
}) {
  return input.lines
    .map(
      (line, index) =>
        `<text x="${input.x}" y="${input.y + index * input.lineHeight}" font-size="${input.size}" font-weight="${input.weight ?? 400}" fill="${input.fill}">${escapeHtml(line)}</text>`,
    )
    .join("");
}

async function renderShell(content: Record<string, unknown>) {
  const title = textValue(content.title, "Daily Best Moments");
  const subtitle = textValue(content.subtitle, "Generated from your Journey moments.");
  const sections = storyBeats(content);
  const ending = textValue(storyScript(content).ending, "");
  const heroDataUri = await imageDataUri(heroImageUrl(content));
  const displaySections =
    sections.length > 0 ? sections : ["A quiet travel day was saved for this Journey."];
  const hasHero = Boolean(heroDataUri);

  if (hasHero) {
    const heroSrc = heroDataUri ?? "";
    const titleLines = wrapText(title, 18, 3);
    const subtitleLines = wrapText(subtitle, 35, 2);
    const storyLines = displaySections
      .slice(0, 3)
      .flatMap((section) => [...wrapText(section, 32, 3), ""])
      .slice(0, 11);
    const endingLines = ending ? wrapText(ending, 32, 2) : [];
    const titleY = 600 - Math.max(0, titleLines.length - 2) * 56;
    const subtitleY = titleY + titleLines.length * 82 + 34;
    const storyY = Math.max(820, subtitleY + subtitleLines.length * 46 + 88);
    const storySvg = textLinesSvg({
      lines: storyLines,
      x: 148,
      y: storyY,
      lineHeight: 42,
      size: 31,
      weight: 650,
      fill: "#fffdf8",
    });
    const endingSvg =
      endingLines.length > 0
        ? textLinesSvg({
            lines: endingLines,
            x: 148,
            y: 1190,
            lineHeight: 42,
            size: 30,
            weight: 650,
            fill: "#fff7ed",
          })
        : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${originalWidth} ${originalHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="poster-clip"><rect x="88" y="88" width="904" height="1264" rx="44"/></clipPath>
    <linearGradient id="hero-overlay" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#11110f" stop-opacity="0.12"/>
      <stop offset="34%" stop-color="#11110f" stop-opacity="0.22"/>
      <stop offset="58%" stop-color="#11110f" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="#11110f" stop-opacity="0.82"/>
    </linearGradient>
    <radialGradient id="hero-vignette" cx="50%" cy="32%" r="78%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.38"/>
    </radialGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#332514" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#f7f1e7"/>
  <rect x="88" y="88" width="904" height="1264" rx="44" fill="#11110f" filter="url(#soft-shadow)"/>
  <image x="88" y="88" width="904" height="1264" href="${escapeHtml(heroSrc)}" xlink:href="${escapeHtml(heroSrc)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#poster-clip)"/>
  <rect x="88" y="88" width="904" height="1264" rx="44" fill="url(#hero-overlay)"/>
  <rect x="88" y="88" width="904" height="1264" rx="44" fill="url(#hero-vignette)"/>
  <text x="148" y="158" font-size="28" font-weight="900" fill="#fffdf8">OTR STORY</text>
  ${textLinesSvg({
    lines: titleLines,
    x: 148,
    y: titleY,
    lineHeight: 82,
    size: 72,
    weight: 850,
    fill: "#ffffff",
  })}
  ${textLinesSvg({
    lines: subtitleLines,
    x: 148,
    y: subtitleY,
    lineHeight: 46,
    size: 32,
    weight: 560,
    fill: "#fff7ed",
  })}
  ${storySvg}
  ${endingSvg}
  <line x1="148" x2="932" y1="1260" y2="1260" stroke="#fff7ed" stroke-opacity="0.48" stroke-width="2"/>
  <text x="148" y="1310" font-size="28" font-weight="900" fill="#fffdf8">OTR</text>
</svg>`;
  }

  const titleLines = wrapText(title, 19, 3);
  const subtitleLines = wrapText(subtitle, 36, 2);
  const footerY = 1278;
  let y = 540;
  const sectionSvg = displaySections
    .slice(0, 3)
    .map((section, index) => {
      const lines = wrapText(section, 42, 3);
      const height = Math.max(112, 46 + lines.length * 34);
      const block = [
        `<rect x="108" y="${y - 46}" width="864" height="${height}" rx="28" fill="${index === 0 ? "#ffffff" : "#fffaf0"}" stroke="#e7dfd2" stroke-width="2"/>`,
        textLinesSvg({
          lines,
          x: 148,
          y,
          lineHeight: 34,
          size: 28,
          weight: 620,
          fill: "#292524",
        }),
      ].join("");
      y += height + 24;
      return block;
    })
    .join("");
  const endingLines = ending ? wrapText(ending, 40, 2) : [];
  const endingSvg =
    endingLines.length > 0 && y + endingLines.length * 34 < footerY - 42
      ? textLinesSvg({
          lines: endingLines,
          x: 148,
          y: y + 8,
          lineHeight: 34,
          size: 26,
          weight: 650,
          fill: "#047857",
        })
      : "";
  const titleY = 290;
  const subtitleY = titleY + titleLines.length * 80 + 34;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${originalWidth} ${originalHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="memory-shot-bg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#fffdf8"/>
      <stop offset="100%" stop-color="#f3eadc"/>
    </linearGradient>
    <linearGradient id="hero-overlay" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#11110f" stop-opacity="0"/>
      <stop offset="52%" stop-color="#11110f" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#11110f" stop-opacity="0.58"/>
    </linearGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="28" flood-color="#332514" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="#f7f1e7"/>
  <rect x="88" y="88" width="904" height="1264" rx="44" fill="url(#memory-shot-bg)" filter="url(#soft-shadow)" stroke="#e7dfd2" stroke-width="2"/>
  <circle cx="820" cy="210" r="120" fill="#d1fae5" opacity="0.55"/>
  <circle cx="218" cy="470" r="92" fill="#fde68a" opacity="0.35"/>
  <text x="148" y="170" font-size="28" font-weight="900" fill="#047857">OTR STORY</text>
  ${textLinesSvg({
    lines: titleLines,
    x: 148,
    y: titleY,
    lineHeight: 80,
    size: 72,
    weight: 850,
    fill: "#11110f",
  })}
  ${textLinesSvg({
    lines: subtitleLines,
    x: 148,
    y: subtitleY,
    lineHeight: 48,
    size: 34,
    weight: 500,
    fill: "#57534e",
  })}
  ${sectionSvg}
  ${endingSvg}
  <text x="148" y="${footerY}" font-size="28" font-weight="900" fill="#047857">OTR</text>
</svg>`;
}

async function updateRenderState(
  supabase: RendererSupabase,
  memoryShotId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("memory_shots")
    .update(patch)
    .eq("id", memoryShotId);

  if (error) throw error;
}

async function loadMemoryShot(
  supabase: RendererSupabase,
  memoryShotId: string,
) {
  const { data, error } = await supabase
    .from("memory_shots")
    .select(
      "id, journey_id, title, subtitle, status, preview_url, render_status, render_error, content, metadata",
    )
    .eq("id", memoryShotId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Memory Shot not found.");
  return data as MemoryShotRow;
}

async function ensurePosterArtifact(
  supabase: RendererSupabase,
  memoryShot: MemoryShotRow,
) {
  const [existing] = await listMemoryShotArtifacts(memoryShot.id, {
    supabase,
    artifactType: "poster",
    variant: "long_poster",
    limit: 1,
  });
  if (existing) {
    return updateMemoryShotArtifactStatus(
      existing.id,
      {
        status: "rendering",
        renderError: null,
        renderWarning: null,
        metadata: {
          ...(existing.metadata ?? {}),
          renderer: {
            version: rendererVersion,
            width: originalWidth,
            height: originalHeight,
            contentSource: "memory_shots.content.htmlPreview",
          },
        },
      },
      { supabase },
    );
  }

  return createMemoryShotArtifact(
    {
      memoryShotId: memoryShot.id,
      artifactType: "poster",
      variant: "long_poster",
      status: "rendering",
      title: memoryShot.title,
      metadata: {
        renderer: {
          version: rendererVersion,
          width: originalWidth,
          height: originalHeight,
          contentSource: "memory_shots.content.htmlPreview",
        },
      },
    },
    { supabase },
  );
}

async function tryEnsurePosterArtifact(
  supabase: RendererSupabase,
  memoryShot: MemoryShotRow,
) {
  try {
    return await ensurePosterArtifact(supabase, memoryShot);
  } catch {
    return null;
  }
}

async function syncPosterArtifactAssets(
  supabase: RendererSupabase,
  artifactId: string,
  memoryShotId: string,
) {
  const { data, error } = await supabase
    .from("memory_shot_assets")
    .select("asset_type, source_id, role, sort_order, metadata")
    .eq("memory_shot_id", memoryShotId)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  const assets = ((data ?? []) as MemoryShotAssetRow[]).map((asset) => ({
    assetType: asset.asset_type,
    assetId: asset.source_id,
    role: asset.role ?? "source",
    sortOrder: asset.sort_order,
    metadata: asset.metadata ?? {},
  }));

  const { error: deleteError } = await supabase
    .from("memory_shot_artifact_assets")
    .delete()
    .eq("artifact_id", artifactId);

  if (deleteError) throw deleteError;
  await addMemoryShotArtifactAssets(artifactId, assets, { supabase });
}

async function trySyncPosterArtifactAssets(
  supabase: RendererSupabase,
  artifactId: string,
  memoryShotId: string,
) {
  try {
    await syncPosterArtifactAssets(supabase, artifactId, memoryShotId);
  } catch {
    // Artifact asset sync is best-effort during dual write.
  }
}

async function tryMarkPosterArtifactFailed(
  supabase: RendererSupabase,
  artifact: MemoryShotArtifact | null,
  renderError: string,
) {
  if (!artifact) return;
  try {
    await markMemoryShotArtifactFailed(
      artifact.id,
      {
        renderError,
        metadata: {
          ...(artifact.metadata ?? {}),
          renderer: {
            version: rendererVersion,
            width: originalWidth,
            height: originalHeight,
            contentSource: "memory_shots.content.htmlPreview",
          },
        },
      },
      { supabase },
    );
  } catch {
    // Artifact failure sync must not change legacy render failure handling.
  }
}

export async function renderMemoryShotPreview(
  input: RenderMemoryShotInput,
) {
  const memoryShot = await loadMemoryShot(input.supabase, input.memoryShotId);
  let posterArtifact: MemoryShotArtifact | null = null;

  if (memoryShot.status !== "ready") {
    throw new Error("Only ready Memory Shots can be rendered.");
  }
  if (memoryShot.render_status === "rendering" && !input.force) {
    throw new Error("Memory Shot preview is already rendering.");
  }

  await updateRenderState(input.supabase, memoryShot.id, {
    render_status: "rendering",
    render_error: null,
    render_warning: null,
  });
  posterArtifact = await tryEnsurePosterArtifact(input.supabase, memoryShot);

  try {
    const htmlPreview = getHtmlPreview(memoryShot.content);
    if (!htmlPreview) {
      throw new Error("Memory Shot content.htmlPreview is missing.");
    }

    const svg = await renderShell(memoryShot.content);
    const originalPngBuffer = await sharp(Buffer.from(svg), {
      density: 144,
      failOn: "none",
    })
      .png()
      .toBuffer();
    const previewWebpBuffer = await sharp(originalPngBuffer, { failOn: "none" })
      .resize({ width: previewWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const thumbnailWebpBuffer = await sharp(originalPngBuffer, { failOn: "none" })
      .resize({ width: thumbnailWidth, withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();

    const [originalRender, previewRender, thumbnailRender] = await Promise.all([
      uploadOriginalRender({
        supabase: input.supabase,
        journeyId: memoryShot.journey_id,
        memoryShotId: memoryShot.id,
        buffer: originalPngBuffer,
        filename: "original_render.png",
        contentType: "image/png",
        width: originalWidth,
        height: originalHeight,
      }),
      uploadPreviewRender({
        supabase: input.supabase,
        journeyId: memoryShot.journey_id,
        memoryShotId: memoryShot.id,
        buffer: previewWebpBuffer,
        filename: "preview_render.webp",
        contentType: "image/webp",
        width: previewWidth,
        height: Math.round((originalHeight / originalWidth) * previewWidth),
      }),
      uploadThumbnailRender({
        supabase: input.supabase,
        journeyId: memoryShot.journey_id,
        memoryShotId: memoryShot.id,
        buffer: thumbnailWebpBuffer,
        filename: "thumbnail_render.webp",
        contentType: "image/webp",
        width: thumbnailWidth,
        height: Math.round((originalHeight / originalWidth) * thumbnailWidth),
      }),
    ]);
    const renderWarning = [
      originalRender.warning,
      previewRender.warning,
      thumbnailRender.warning,
    ]
      .filter((warning): warning is string => Boolean(warning))
      .join(" ");
    const renderedAt = new Date().toISOString();
    const previewHeight = Math.round((originalHeight / originalWidth) * previewWidth);
    const thumbnailHeight = Math.round(
      (originalHeight / originalWidth) * thumbnailWidth,
    );

    const metadata = {
      ...(memoryShot.metadata ?? {}),
      render: {
        renderer: rendererVersion,
        originalRender: {
          provider: originalRender.provider,
          path: originalRender.path,
          contentType: "image/png",
          width: originalWidth,
          height: originalHeight,
          target: "google_drive",
          driveFileId: originalRender.driveFileId ?? null,
          driveUrl: originalRender.driveUrl ?? null,
          metadata: originalRender.metadata ?? {},
        },
        previewRender: {
          provider: previewRender.provider,
          path: previewRender.path,
          contentType: "image/webp",
          width: previewWidth,
          height: previewHeight,
          url: previewRender.url,
          metadata: previewRender.metadata ?? {},
        },
        thumbnailRender: {
          provider: thumbnailRender.provider,
          path: thumbnailRender.path,
          contentType: "image/webp",
          width: thumbnailWidth,
          height: thumbnailHeight,
          url: thumbnailRender.url,
          metadata: thumbnailRender.metadata ?? {},
        },
      },
    };

    await updateRenderState(input.supabase, memoryShot.id, {
      preview_url: previewRender.url,
      thumbnail_url: thumbnailRender.url,
      original_drive_file_id: originalRender.driveFileId ?? null,
      original_drive_url: originalRender.driveUrl ?? null,
      original_storage_provider: originalRender.provider,
      original_storage_path: originalRender.path,
      preview_storage_provider: previewRender.provider,
      preview_storage_path: previewRender.path,
      thumbnail_storage_provider: thumbnailRender.provider,
      thumbnail_storage_path: thumbnailRender.path,
      render_status: "ready",
      render_error: null,
      render_warning: renderWarning || null,
      rendered_at: renderedAt,
      metadata,
    });
    if (posterArtifact) {
      try {
        const artifactStorage = {
          original: {
            provider: originalRender.provider,
            path: originalRender.path,
            url: null,
            driveFileId: originalRender.driveFileId ?? null,
            driveUrl: originalRender.driveUrl ?? null,
            contentType: "image/png",
            width: originalWidth,
            height: originalHeight,
            metadata: originalRender.metadata ?? {},
          },
          preview: {
            provider: previewRender.provider,
            path: previewRender.path,
            url: previewRender.url,
            contentType: "image/webp",
            width: previewWidth,
            height: previewHeight,
            metadata: previewRender.metadata ?? {},
          },
          thumbnail: {
            provider: thumbnailRender.provider,
            path: thumbnailRender.path,
            url: thumbnailRender.url,
            contentType: "image/webp",
            width: thumbnailWidth,
            height: thumbnailHeight,
            metadata: thumbnailRender.metadata ?? {},
          },
        };
        posterArtifact = await markMemoryShotArtifactReady(
          posterArtifact.id,
          {
            title: memoryShot.title,
            previewUrl: previewRender.url,
            thumbnailUrl: thumbnailRender.url,
            storage: artifactStorage,
            metadata: {
              ...(posterArtifact.metadata ?? {}),
              renderer: {
                version: rendererVersion,
                original: { width: originalWidth, height: originalHeight },
                preview: { width: previewWidth, height: previewHeight },
                thumbnail: { width: thumbnailWidth, height: thumbnailHeight },
              },
              contentSource: "memory_shots.content.htmlPreview",
              fallbackProviderInfo: {
                original: {
                  provider: originalRender.provider,
                  warning: originalRender.warning ?? null,
                },
                preview: {
                  provider: previewRender.provider,
                  warning: previewRender.warning ?? null,
                },
                thumbnail: {
                  provider: thumbnailRender.provider,
                  warning: thumbnailRender.warning ?? null,
                },
              },
              renderWarning: renderWarning || null,
            },
            renderWarning: renderWarning || null,
            renderedAt,
          },
          { supabase: input.supabase },
        );
        await trySyncPosterArtifactAssets(
          input.supabase,
          posterArtifact.id,
          memoryShot.id,
        );
      } catch {
        // Artifact dual write must not change legacy render success handling.
      }
    }

    return {
      memoryShotId: memoryShot.id,
      previewUrl: previewRender.url,
      thumbnailUrl: thumbnailRender.url,
      renderStatus: "ready" as const,
      renderWarning: renderWarning || null,
      storage: {
        original: originalRender,
        preview: previewRender,
        thumbnail: thumbnailRender,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not render Memory Shot.";
    await updateRenderState(input.supabase, memoryShot.id, {
      render_status: "failed",
      render_error: message,
    });
    await tryMarkPosterArtifactFailed(input.supabase, posterArtifact, message);
    throw error;
  }
}

export function rendererWorkerInfo() {
  return {
    worker: "renderer_worker",
    renderer: rendererVersion,
    supports: ["memory_shot_daily_best_moments"],
    width: previewWidth,
    height: Math.round((originalHeight / originalWidth) * previewWidth),
    storageRouter: ["google_drive", "media_server", "supabase_fallback"],
    note: escapeHtml(
      "Renderer uses the existing content/htmlPreview contract and emits a story poster with optional hero imagery.",
    ),
  };
}
