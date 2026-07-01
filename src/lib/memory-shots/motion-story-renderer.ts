import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMemoryShotArtifactAssets,
  createMemoryShotArtifact,
  listMemoryShotArtifacts,
  markMemoryShotArtifactFailed,
  markMemoryShotArtifactReady,
  updateMemoryShotArtifactStatus,
  type MemoryShotArtifact,
} from "./artifacts";
import { uploadMotionStoryWebArtifact } from "./render-storage-router";
import type { MemoryShot, MemoryShotAssetType } from "./types";

type MotionStorySupabase = SupabaseClient;

type RenderMotionStoryInput = {
  supabase: MotionStorySupabase;
  memoryShotId: string;
};

type MemoryShotRow = {
  id: string;
  journey_id: string;
  title: string | null;
  subtitle: string | null;
  status: MemoryShot["status"];
  preview_url: string | null;
  thumbnail_url: string | null;
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

type MotionStoryChapter = {
  id: string;
  title: string;
  text: string;
  layout: "cover_text" | "text" | "image_text" | "video_text";
  background: {
    type: "image" | "video" | "none";
    assetRef: string | null;
    url: string | null;
    fit: "cover" | "contain";
  };
  clip: {
    startSec: number;
    endSec: number;
  };
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storyScript(content: Record<string, unknown>) {
  return objectValue(content.storyScript) ?? objectValue(content.story_script);
}

function chapterText(chapter: Record<string, unknown>) {
  return textValue(
    chapter.text,
    textValue(chapter.body, textValue(chapter.summary, "A Journey moment was saved.")),
  );
}

function assetRefFromAsset(asset?: MemoryShotAssetRow | null) {
  return asset ? `${asset.asset_type}:${asset.source_id}` : null;
}

function safeMediaUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function assetUrl(asset?: MemoryShotAssetRow | null) {
  const metadata = asset?.metadata ?? {};
  const candidate = textValue(
    metadata.previewUrl,
    textValue(metadata.url, textValue(metadata.src)),
  );
  return candidate ? safeMediaUrl(candidate) : null;
}

function buildChapters(
  memoryShot: MemoryShotRow,
  assets: MemoryShotAssetRow[],
): MotionStoryChapter[] {
  const script = storyScript(memoryShot.content);
  const scriptChapters = Array.isArray(script?.chapters)
    ? script.chapters
    : [];
  const sourceChapters =
    scriptChapters.length > 0
      ? scriptChapters
      : stringArray(memoryShot.content.sections).map((section, index) => ({
          id: `section_${index + 1}`,
          title: `Moment ${index + 1}`,
          text: section,
        }));
  const fallbackChapters =
    sourceChapters.length > 0
      ? sourceChapters
      : [
          {
            id: "intro",
            title: memoryShot.title ?? "Daily Best Moments",
            text:
              memoryShot.subtitle ??
              "A small story from this Journey is ready to revisit.",
          },
        ];
  const mediaAssets = assets.filter((asset) =>
    ["photo", "memory"].includes(asset.asset_type),
  );

  return fallbackChapters.slice(0, 6).map((chapter, index) => {
    const record = objectValue(chapter) ?? {};
    const asset = mediaAssets[index % Math.max(mediaAssets.length, 1)] ?? null;
    const backgroundType =
      asset?.asset_type === "photo" || asset?.asset_type === "memory"
        ? "image"
        : "none";
    return {
      id: textValue(record.id, `chapter_${index + 1}`),
      title: textValue(record.title, index === 0 ? "Cover" : `Chapter ${index + 1}`),
      text: chapterText(record),
      layout: backgroundType === "image" ? "image_text" : "text",
      background: {
        type: backgroundType,
        assetRef: assetRefFromAsset(asset),
        url: assetUrl(asset) || null,
        fit: "cover",
      },
      clip: {
        startSec: index * 5,
        endSec: index * 5 + 5,
      },
    };
  });
}

function buildManifest(input: {
  memoryShot: MemoryShotRow;
  chapters: MotionStoryChapter[];
  coverUrl: string | null;
}) {
  const durationSec = Math.max(input.chapters.length * 5 + 3, 12);
  return {
    artifact_type: "motion_story",
    variant: "scroll_story",
    title: input.memoryShot.title ?? "Daily Best Moments",
    theme: {
      name: "otr_warm_journal",
      tone: textValue(storyScript(input.memoryShot.content)?.tone, "warm"),
      colors: {
        background: "#f7f1e7",
        text: "#111111",
        accent: "#047857",
      },
    },
    layout: {
      aspectRatio: "9:16",
      width: 720,
      height: 1280,
      mode: "vertical_scroll",
    },
    cover: {
      title: input.memoryShot.title ?? "Daily Best Moments",
      subtitle: input.memoryShot.subtitle ?? null,
      background: input.coverUrl,
    },
    chapters: input.chapters,
    ending: {
      text: textValue(
        objectValue(storyScript(input.memoryShot.content)?.ending)?.text,
        "Made with OTR.",
      ),
      layout: "brand_end_card",
    },
    branding: {
      enabled: true,
      label: "OTR",
      placement: "bottom_left",
    },
    durationSec,
  };
}

function renderHtml(manifest: ReturnType<typeof buildManifest>) {
  const coverBackground = manifest.cover.background
    ? `background-image: linear-gradient(180deg, rgba(17,17,17,.14), rgba(17,17,17,.5)), url('${escapeHtml(manifest.cover.background)}');`
    : "";
  const chapterHtml = manifest.chapters
    .map((chapter, index) => {
      const background =
        chapter.background.url && chapter.background.type === "image"
          ? `style="background-image: linear-gradient(180deg, rgba(17,17,17,.08), rgba(17,17,17,.52)), url('${escapeHtml(chapter.background.url)}');"`
          : "";
      return `<section class="chapter ${chapter.background.url ? "has-media" : ""}" ${background}>
        <p class="kicker">Chapter ${index + 1}</p>
        <h2>${escapeHtml(chapter.title)}</h2>
        <p>${escapeHtml(chapter.text)}</p>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(manifest.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html { background: #f7f1e7; color: #111111; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; }
    main { width: min(100vw, 520px); margin: 0 auto; background: #fffdf8; }
    section { min-height: 100svh; padding: 28px; display: flex; flex-direction: column; justify-content: flex-end; border-bottom: 1px solid rgba(120, 113, 108, .16); }
    .cover, .chapter.has-media { background-size: cover; background-position: center; color: white; text-shadow: 0 2px 18px rgba(0,0,0,.35); }
    .cover { ${coverBackground} }
    .chapter:not(.has-media) { background: linear-gradient(180deg, #fffdf8 0%, #f3eadc 100%); color: #111111; }
    .kicker { margin: 0 0 12px; color: #047857; font-size: 13px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .has-media .kicker, .cover .kicker { color: #d1fae5; }
    h1, h2 { margin: 0; letter-spacing: 0; line-height: .98; }
    h1 { font-size: clamp(42px, 12vw, 68px); }
    h2 { font-size: clamp(34px, 9vw, 54px); }
    p { max-width: 30rem; font-size: 19px; line-height: 1.45; }
    .brand { min-height: 72svh; background: #11110f; color: white; }
    .logo { margin-top: 36px; color: #34d399; font-weight: 950; letter-spacing: .08em; }
  </style>
</head>
<body>
  <main>
    <section class="cover">
      <p class="kicker">Memory Shot</p>
      <h1>${escapeHtml(manifest.cover.title)}</h1>
      ${manifest.cover.subtitle ? `<p>${escapeHtml(manifest.cover.subtitle)}</p>` : ""}
    </section>
    ${chapterHtml}
    <section class="brand">
      <p class="kicker">Journey</p>
      <h2>${escapeHtml(manifest.ending.text)}</h2>
      <p class="logo">OTR</p>
    </section>
  </main>
</body>
</html>`;
}

async function loadMemoryShot(
  supabase: MotionStorySupabase,
  memoryShotId: string,
) {
  const { data, error } = await supabase
    .from("memory_shots")
    .select(
      "id, journey_id, title, subtitle, status, preview_url, thumbnail_url, content, metadata",
    )
    .eq("id", memoryShotId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Memory Shot not found.");
  return data as MemoryShotRow;
}

async function loadMemoryShotAssets(
  supabase: MotionStorySupabase,
  memoryShotId: string,
) {
  const { data, error } = await supabase
    .from("memory_shot_assets")
    .select("asset_type, source_id, role, sort_order, metadata")
    .eq("memory_shot_id", memoryShotId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data ?? []) as MemoryShotAssetRow[];
}

async function ensureMotionStoryArtifact(
  supabase: MotionStorySupabase,
  memoryShot: MemoryShotRow,
) {
  const [existing] = await listMemoryShotArtifacts(memoryShot.id, {
    supabase,
    artifactType: "motion_story",
    variant: "scroll_story",
    limit: 1,
  });
  if (existing) {
    return updateMemoryShotArtifactStatus(
      existing.id,
      { status: "rendering", renderError: null, renderWarning: null },
      { supabase },
    );
  }

  return createMemoryShotArtifact(
    {
      memoryShotId: memoryShot.id,
      artifactType: "motion_story",
      variant: "scroll_story",
      status: "rendering",
      title: memoryShot.title,
      metadata: {
        renderer: {
          version: "motion-story-scroll-skeleton-v1",
          contentSource: "memory_shots.content.storyScript/htmlPreview",
        },
      },
    },
    { supabase },
  );
}

async function syncArtifactAssets(
  supabase: MotionStorySupabase,
  artifactId: string,
  assets: MemoryShotAssetRow[],
) {
  const { error } = await supabase
    .from("memory_shot_artifact_assets")
    .delete()
    .eq("artifact_id", artifactId);

  if (error) throw error;

  await addMemoryShotArtifactAssets(
    artifactId,
    assets.map((asset) => ({
      assetType: asset.asset_type,
      assetId: asset.source_id,
      role: asset.role ?? "source",
      sortOrder: asset.sort_order,
      metadata: asset.metadata ?? {},
    })),
    { supabase },
  );
}

export async function renderMotionStorySkeleton(
  input: RenderMotionStoryInput,
) {
  const memoryShot = await loadMemoryShot(input.supabase, input.memoryShotId);
  let artifact: MemoryShotArtifact | null = null;

  if (memoryShot.status !== "ready") {
    throw new Error("Only ready Memory Shots can generate Motion Story.");
  }

  try {
    artifact = await ensureMotionStoryArtifact(input.supabase, memoryShot);
    const assets = await loadMemoryShotAssets(input.supabase, memoryShot.id);
    const coverUrl = safeMediaUrl(
      memoryShot.thumbnail_url ?? memoryShot.preview_url ?? "",
    );
    const chapters = buildChapters(memoryShot, assets);
    const manifest = buildManifest({ memoryShot, chapters, coverUrl });
    const html = renderHtml(manifest);

    const [webUpload, manifestUpload] = await Promise.all([
      uploadMotionStoryWebArtifact(
        {
          supabase: input.supabase,
          journeyId: memoryShot.journey_id,
          memoryShotId: memoryShot.id,
          buffer: Buffer.from(html),
          filename: "index.html",
          contentType: "text/html; charset=utf-8",
        },
        "web",
      ),
      uploadMotionStoryWebArtifact(
        {
          supabase: input.supabase,
          journeyId: memoryShot.journey_id,
          memoryShotId: memoryShot.id,
          buffer: Buffer.from(JSON.stringify(manifest, null, 2)),
          filename: "manifest.json",
          contentType: "application/json; charset=utf-8",
        },
        "manifest",
      ),
    ]);
    const renderWarning = [webUpload.warning, manifestUpload.warning]
      .filter((warning): warning is string => Boolean(warning))
      .join(" ");
    const storage = {
      web: {
        provider: webUpload.provider,
        path: webUpload.path,
        url: webUpload.url,
        contentType: "text/html",
        metadata: webUpload.metadata ?? {},
      },
      manifest: {
        provider: manifestUpload.provider,
        path: manifestUpload.path,
        url: manifestUpload.url,
        contentType: "application/json",
        metadata: manifestUpload.metadata ?? {},
      },
      assets: {
        provider: "source_reference",
        count: assets.length,
      },
      cover: {
        provider: coverUrl ? "memory_shots" : null,
        url: coverUrl,
      },
    };
    artifact = await markMemoryShotArtifactReady(
      artifact.id,
      {
        title: manifest.title,
        previewUrl: webUpload.url,
        publicUrl: webUpload.url,
        thumbnailUrl: coverUrl,
        manifest,
        storage,
        renderWarning: renderWarning || null,
        metadata: {
          ...(artifact.metadata ?? {}),
          renderer: {
            version: "motion-story-scroll-skeleton-v1",
            contentSource: "memory_shots.content.storyScript/htmlPreview",
          },
          fallbackProviderInfo: {
            web: {
              provider: webUpload.provider,
              warning: webUpload.warning ?? null,
            },
            manifest: {
              provider: manifestUpload.provider,
              warning: manifestUpload.warning ?? null,
            },
          },
          renderWarning: renderWarning || null,
        },
      },
      { supabase: input.supabase },
    );
    await syncArtifactAssets(input.supabase, artifact.id, assets);

    return {
      artifact,
      publicUrl: webUpload.url,
      previewUrl: webUpload.url,
      thumbnailUrl: coverUrl,
      renderWarning: renderWarning || null,
      storage,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not render Motion Story.";
    if (artifact) {
      await markMemoryShotArtifactFailed(
        artifact.id,
        {
          renderError: message,
          metadata: {
            ...(artifact.metadata ?? {}),
            renderer: {
              version: "motion-story-scroll-skeleton-v1",
              contentSource: "memory_shots.content.storyScript/htmlPreview",
            },
          },
        },
        { supabase: input.supabase },
      );
    }
    throw error;
  }
}
