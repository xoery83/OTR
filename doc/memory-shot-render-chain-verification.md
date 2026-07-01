# Memory Shot Render Chain Verification

This document verifies the Phase 6 render chain for `memory_shot_daily_best_moments`.

## Scope

- Generate a Daily Best Moments Memory Shot.
- Render `content.htmlPreview` into image buffers.
- Store original, preview, and thumbnail renders through Render Storage Router.
- Verify Highlights can keep using `preview_url` or `thumbnail_url`.

Out of scope:

- No new Memory Shot templates.
- No Discover.
- No PDF.
- No Google Drive UI changes.
- No existing photo upload pipeline changes.

## Chain

```text
POST /api/journeys/:journeyId/memory-shots/generate
  -> AI Job Queue creates ai_jobs row
  -> memory_shot_worker creates memory_shots row
  -> worker collects Journey data
  -> worker saves snapshot
  -> Prompt Center renders memory_shot_daily_best_moments
  -> Model Router generates title/subtitle/sections
  -> worker saves content.htmlPreview
  -> renderer_worker creates image buffers
  -> original_render.png
  -> preview_render.webp
  -> thumbnail_render.webp
  -> Render Storage Router
     -> original: Google Drive first, Supabase fallback
     -> preview: media worker first, Supabase fallback
     -> thumbnail: media worker first, Supabase fallback
  -> memory_shots stores provider/path/url fields
  -> Highlights reads thumbnail_url or preview_url
```

## Storage Fields

Original render:

```text
original_drive_file_id
original_drive_url
original_storage_provider
original_storage_path
```

Preview render:

```text
preview_url
preview_storage_provider
preview_storage_path
```

Thumbnail render:

```text
thumbnail_url
thumbnail_storage_provider
thumbnail_storage_path
```

Render status:

```text
render_status
render_error
render_warning
rendered_at
```

Highlights, Discover, and Feed should only read:

```text
thumbnail_url
preview_url
```

They must not load `original_drive_url`.

## Environment Dependencies

App/API:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Media worker:

```text
MEDIA_WORKER_URL
MEDIA_WORKER_FALLBACK_URL
MEDIA_WORKER_SECRET
AI_SERVER_URL
```

Google Drive:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_TOKEN_ENCRYPTION_KEY
```

OpenAI/Model Router/Prompt Center dependencies are still required for the generate step, but renderer retry does not call AI.

## Test Script

Script:

```text
scripts/verify-memory-shot-render-chain.mjs
```

Usage:

```bash
node scripts/verify-memory-shot-render-chain.mjs \
  --base-url http://localhost:3000 \
  --journey-id <journey-id> \
  --date 2026-07-09 \
  --token <user-access-token> \
  --language en
```

Environment alternatives:

```bash
OTR_BASE_URL=http://localhost:3000
JOURNEY_ID=<journey-id>
MEMORY_SHOT_DATE=2026-07-09
OTR_ACCESS_TOKEN=<user-access-token>
MEMORY_SHOT_LANGUAGE=en
```

The script performs:

1. `POST /api/journeys/:journeyId/memory-shots/generate`
2. `POST /api/journeys/:journeyId/memory-shots/:memoryShotId/render`
3. `GET /api/journeys/:journeyId/memory-shots`

It prints:

- `renderStatus`
- `renderError`
- `renderWarning`
- `previewUrl`
- `thumbnailUrl`
- `originalDriveFileId`
- `originalDriveUrl`
- original/preview/thumbnail provider and path
- `metadata.render`

## Fallback Verification

### Media Worker Fallback

To verify preview/thumbnail fallback:

1. Temporarily set an invalid media worker URL:

```bash
MEDIA_WORKER_URL=http://127.0.0.1:9
```

2. Run the script.
3. Confirm:

```text
render_status = ready
render_error = null
render_warning contains "media_server unavailable"
preview_storage_provider = supabase_fallback
thumbnail_storage_provider = supabase_fallback
preview_url is present
thumbnail_url is present
```

### Google Drive Fallback

To verify original fallback:

1. Use a Journey without a connected Google Drive account, or run without:

```text
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET / GOOGLE_TOKEN_ENCRYPTION_KEY
```

2. Run the script.
3. Confirm:

```text
render_status = ready
render_error = null
render_warning contains "google_drive unavailable"
original_storage_provider = supabase_fallback
original_storage_path is present
original_drive_file_id is null
original_drive_url is null
```

### Full Preferred Path

To verify preferred storage:

1. Ensure the Journey has Google Drive connected.
2. Ensure media worker is reachable and accepts:

```text
POST /memory-shots/renders
header x-media-worker-secret
```

3. Run the script.
4. Confirm:

```text
original_storage_provider = google_drive
original_drive_file_id is present
preview_storage_provider = media_server
thumbnail_storage_provider = media_server
render_warning is null
```

## Manual Browser Check

1. Apply migrations through `058_memory_shot_render_storage_router.sql`.
2. Start the app:

```bash
npm run dev
```

3. Open the target Journey Highlights page.
4. Click `Generate` under Memory Shots.
5. Confirm a Memory Shot appears as `ready`.
6. If `thumbnail_url` or `preview_url` exists, confirm the image appears.
7. If media worker or Drive is unavailable, confirm text fallback still appears and the original Journey page remains usable.

## Expected Safety Behavior

- Renderer failure must not change `memory_shot.status`.
- Storage provider fallback must not set `render_status = failed`.
- Fallback should set `render_warning`.
- Only renderer/image-generation failure should set `render_status = failed`.
- Existing Capture, itinerary parser, photo indexing, translation, vision router, place/geocoding, and Google Drive photo upload flows are not modified by this verification phase.
