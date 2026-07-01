import "server-only";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  uploadOriginalRender,
  uploadPreviewRender,
  uploadThumbnailRender,
} from "./render-storage-router";
import type { MemoryShot } from "./types";

const originalWidth = 1080;
const originalHeight = 1440;
const previewWidth = 720;
const thumbnailWidth = 360;

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

function renderShell(htmlPreview: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${originalWidth}" height="${originalHeight}" viewBox="0 0 ${originalWidth} ${originalHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f7f1e7"/>
  <foreignObject x="0" y="0" width="${originalWidth}" height="${originalHeight}">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; }
        .memory-shot-canvas {
          width: ${originalWidth}px;
          min-height: ${originalHeight}px;
          padding: 88px;
          color: #11110f;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: linear-gradient(180deg, #fffdf8 0%, #f4eadc 100%);
        }
        .memory-shot {
          min-height: ${originalHeight - 176}px;
          border: 2px solid rgba(17, 17, 15, 0.08);
          border-radius: 44px;
          padding: 72px;
          background: rgba(255, 255, 255, 0.82);
          box-shadow: 0 32px 80px rgba(51, 37, 20, 0.16);
        }
        .memory-shot-date {
          margin: 0 0 28px;
          color: #047857;
          font-size: 30px;
          font-weight: 900;
          letter-spacing: 0;
          text-transform: uppercase;
        }
        h1 {
          margin: 0;
          max-width: 820px;
          color: #11110f;
          font-size: 76px;
          line-height: 0.98;
          letter-spacing: 0;
        }
        p {
          margin: 36px 0 0;
          max-width: 820px;
          color: #57534e;
          font-size: 34px;
          line-height: 1.36;
        }
        ul {
          display: grid;
          gap: 26px;
          margin: 64px 0 0;
          padding: 0;
          list-style: none;
        }
        li {
          padding: 28px 32px;
          border-radius: 28px;
          color: #292524;
          font-size: 31px;
          line-height: 1.34;
          background: #ffffff;
          border: 1px solid rgba(120, 113, 108, 0.18);
        }
      </style>
      <div class="memory-shot-canvas">${htmlPreview}</div>
    </div>
  </foreignObject>
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

export async function renderMemoryShotPreview(
  input: RenderMemoryShotInput,
) {
  const memoryShot = await loadMemoryShot(input.supabase, input.memoryShotId);

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

  try {
    const htmlPreview = getHtmlPreview(memoryShot.content);
    if (!htmlPreview) {
      throw new Error("Memory Shot content.htmlPreview is missing.");
    }

    const svg = renderShell(htmlPreview);
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

    const metadata = {
      ...(memoryShot.metadata ?? {}),
      render: {
        renderer: "sharp-svg-foreign-object",
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
          metadata: previewRender.metadata ?? {},
        },
        thumbnailRender: {
          provider: thumbnailRender.provider,
          path: thumbnailRender.path,
          contentType: "image/webp",
          width: thumbnailWidth,
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
      rendered_at: new Date().toISOString(),
      metadata,
    });

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
    throw error;
  }
}

export function rendererWorkerInfo() {
  return {
    worker: "renderer_worker",
    renderer: "sharp-svg-foreign-object",
    supports: ["memory_shot_daily_best_moments"],
    width: previewWidth,
    height: Math.round((originalHeight / originalWidth) * previewWidth),
    storageRouter: ["google_drive", "media_server", "supabase_fallback"],
    note: escapeHtml(
      "Phase 6A renders the existing htmlPreview contract without AI.",
    ),
  };
}
