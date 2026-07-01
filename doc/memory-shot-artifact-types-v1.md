# Memory Shot Artifact Types V1

This document defines the first artifact model for Memory Shots.

Phase 7A is design-only. It does not change database schema, renderer code, UI, storage router, or existing Daily Best Moments behavior.

## Core Principle

A Memory Shot is:

```text
Memory Shot = Story Script + Artifacts
```

The Story Script is the AI-generated source content. It captures the narrative, structure, selected source references, tone, and intended pacing.

Artifacts are rendered outputs produced from the same Story Script. The first phase supports:

- Poster
- Motion Story

This means Poster and Motion Story should not ask AI to invent separate stories. They should render different formats from one stable script.

## First Artifact Types

### poster

Poster is a static visual artifact for Highlights, feeds, sharing previews, and future download.

Supported variants:

- `single_poster`
- `long_poster`
- `grid_9`

### motion_story

Motion Story is a lightweight, browser-playable story artifact. In the first phase it should be manifest/html-driven, not video-generation-driven.

Supported variants:

- `scroll_story`

## Story Script Schema

The Story Script is stored as structured content, not as renderer-specific HTML.

```json
{
  "title": "Golden Circle Day in Reykholt",
  "subtitle": "July 9, 2026 in Iceland",
  "language": "en",
  "tone": "warm, concise, reflective",
  "dateRange": {
    "start": "2026-07-09",
    "end": "2026-07-09",
    "timezone": "Atlantic/Reykjavik"
  },
  "chapters": [
    {
      "id": "chapter_1",
      "title": "Arrival",
      "text": "Checked into the Golden Circle house with hot tub in Reykholt.",
      "assetRefs": ["memory:abc", "photo:def"],
      "location": "Reykholt, Iceland",
      "timeRange": {
        "start": "2026-07-09T15:00:00Z",
        "end": "2026-07-09T16:00:00Z"
      }
    }
  ],
  "ending": {
    "text": "A quiet base for tomorrow's first sightseeing stop.",
    "cta": null
  },
  "assetRefs": [
    {
      "ref": "photo:def",
      "assetType": "photo",
      "sourceId": "def",
      "role": "cover",
      "metadata": {}
    }
  ],
  "durationSec": 18
}
```

Required fields:

- `title`
- `subtitle`
- `language`
- `tone`
- `dateRange`
- `chapters`
- `ending`
- `assetRefs`
- `durationSec`

The Story Script should be saved together with the source snapshot so future Journey edits do not change an already generated Memory Shot.

## Poster Artifact Schema

Poster artifacts are static renders derived from the Story Script.

```json
{
  "artifact_type": "poster",
  "variant": "single_poster",
  "status": "ready",
  "storage": {
    "original": {
      "provider": "google_drive",
      "path": null,
      "url": null,
      "drive_file_id": "drive-file-id",
      "mime_type": "image/png",
      "width": 1080,
      "height": 1920
    },
    "preview": {
      "provider": "media_server",
      "path": "memory-shots/shot-id/preview.webp",
      "url": "https://media.xoery.art/...",
      "mime_type": "image/webp",
      "width": 720,
      "height": 1280
    },
    "thumbnail": {
      "provider": "media_server",
      "path": "memory-shots/shot-id/thumbnail.webp",
      "url": "https://media.xoery.art/...",
      "mime_type": "image/webp",
      "width": 360,
      "height": 640
    }
  },
  "grid_slices": [
    {
      "index": 0,
      "row": 0,
      "col": 0,
      "storage": {
        "preview": {
          "provider": "media_server",
          "path": "memory-shots/shot-id/grid-0.webp",
          "url": "https://media.xoery.art/..."
        }
      }
    }
  ],
  "render_error": null,
  "render_warning": null,
  "rendered_at": "2026-07-01T00:00:00Z"
}
```

Required fields:

- `artifact_type`
- `variant`
- `storage.original`
- `storage.preview`
- `storage.thumbnail`
- `grid_slices`

`grid_slices` is optional for `single_poster` and `long_poster` at runtime, but the schema should reserve it for `grid_9`.

## Motion Story Manifest Schema

Motion Story artifacts should be driven by a manifest. The manifest describes a scrollable, timed, or chapter-based browser experience.

```json
{
  "artifact_type": "motion_story",
  "variant": "scroll_story",
  "title": "Golden Circle Day in Reykholt",
  "theme": {
    "name": "otr_warm_journal",
    "tone": "warm",
    "colors": {
      "background": "#f7f1e7",
      "text": "#111111",
      "accent": "#007a55"
    }
  },
  "chapters": [
    {
      "id": "chapter_1",
      "layout": "image_text",
      "background": {
        "type": "image",
        "assetRef": "photo:def",
        "url": "https://media.xoery.art/...",
        "fit": "cover"
      },
      "clip": {
        "startSec": 0,
        "endSec": 6
      },
      "text": {
        "title": "Arrival",
        "body": "Checked into the Golden Circle house with hot tub in Reykholt.",
        "position": "bottom"
      }
    }
  ],
  "layout": {
    "aspectRatio": "9:16",
    "width": 720,
    "height": 1280,
    "mode": "vertical_scroll"
  },
  "ending": {
    "text": "A quiet base for tomorrow's first sightseeing stop.",
    "layout": "brand_end_card"
  },
  "branding": {
    "enabled": true,
    "label": "OTR",
    "placement": "bottom_left"
  }
}
```

Required manifest concepts:

- `title`
- `theme`
- `chapters`
- `layout`
- background image/video
- clip start/end
- text
- ending
- OTR branding

In Phase 7B, Motion Story should be manifest/html skeleton only. It should not do video clipping or AI video generation.

## Storage Strategy

Storage keeps display assets fast while preserving high-quality originals separately.

### Original

Original artifacts are high-quality source outputs.

Strategy:

```text
Google Drive first
-> Supabase/private original fallback
```

Use Google Drive when the user or Journey has an eligible binding. If Drive is unavailable, fallback to Supabase private original storage and record a warning.

### Preview And Thumbnail

Preview and thumbnail are web delivery assets used by Highlights, Feed, and future Discover.

Strategy:

```text
media server first
-> Supabase fallback
```

The first preferred media host is `media.xoery.art` through the existing media worker env.

### Motion Story HTML / Manifest / Assets

Motion Story delivery assets should use the same web-serving strategy:

```text
media server first
-> Supabase fallback
```

Manifest, HTML shell, preview image, and lightweight assets should be optimized for browser delivery.

### Page Loading Rule

Product pages must never directly load Google Drive original images.

Highlights, Feed, Discover, and embedded views should read only:

```text
preview_url
thumbnail_url
motion_story_url
manifest_url
```

High-quality original files should be accessed only for explicit download, export, or user-authorized share actions.

## Generation Flow

```text
Journey data
  -> snapshot
  -> Story Script
  -> create artifacts
  -> Poster Renderer
  -> Motion Story Renderer
  -> storage router
  -> Highlights display
```

Detailed flow:

1. Worker collects Journey data for the target date/range.
2. Worker saves a snapshot of source inputs.
3. Prompt Center and Model Router generate the Story Script.
4. Memory Shot is marked ready when the Story Script is ready.
5. Artifact rows are created for requested outputs.
6. Poster Renderer renders poster variants from the Story Script.
7. Motion Story Renderer creates manifest/html skeleton from the Story Script.
8. Storage Router uploads original, preview, thumbnail, manifest, and delivery assets.
9. Highlights displays the best available preview/thumbnail and keeps text fallback.

## Status Design

`memory_shot.status` describes the Story Script lifecycle.

Recommended values:

- `draft`
- `generating`
- `ready`
- `failed`
- `archived`

Artifact status describes each concrete output lifecycle.

Recommended values:

- `queued`
- `rendering`
- `ready`
- `failed`
- `archived`

Rules:

- `memory_shot.status = ready` means the Story Script is ready.
- `artifact.status = ready` means that specific output is ready.
- Poster failure must not make Motion Story fail.
- Motion Story failure must not make Poster fail.
- Artifact failures should record `render_error` or `render_warning`.
- Highlights should display the best ready artifact and fallback to Story Script text when no artifact is ready.

## Phase 7B Code Plan

Phase 7B should be a small schema/service step, not a broad product migration.

Planned work:

1. Add `memory_shot_artifacts` table.
2. Add artifact type and variant enums or constrained text values.
3. Add artifact storage fields for original, preview, thumbnail, manifest/html, and warnings.
4. Migrate current `memory_shots` render fields into a `poster` artifact model.
5. Keep backward compatibility while Highlights still reads existing `preview_url` and `thumbnail_url`.
6. Current Daily Best Moments should first generate only one `poster` artifact.
7. Motion Story should start as manifest/html skeleton only.
8. Do not generate, clip, transcode, or upload video files in Phase 7B.

Compatibility note:

The current `memory_shots.content.htmlPreview`, `preview_url`, `thumbnail_url`, `render_status`, `render_error`, and `render_warning` fields can remain as compatibility fields until the artifact table is stable.

## Explicitly Out Of Scope

Phase 7A and 7B do not include:

- AI video generation.
- Complex video clipping.
- Music.
- Discover.
- New Memory Shot templates.
- Admin UI.
- Public sharing controls.
- Google Drive download UX.
- PDF export.
- Full Feed integration.
- Migration of existing Capture, parser, translation, or photo indexing AI calls.
