# Motion Story Smoke Checklist

This checklist verifies the Phase 7D `motion_story / scroll_story` skeleton.

Scope:

- Existing ready Memory Shot only.
- No AI call.
- No animation upgrade.
- No video clipping.
- No MP4 export.
- No Discover.
- No new UI beyond the existing `View Motion Story` link.

## Required Preconditions

Apply migrations through:

```text
060_memory_shot_artifacts_v1.sql
```

Start the app:

```bash
npm run dev
```

Use a logged-in Journey member token. From the browser console:

```js
const key = Object.keys(localStorage).find(
  (item) => item.startsWith("sb-") && item.endsWith("-auth-token"),
);
const value = JSON.parse(localStorage.getItem(key));
copy(value.access_token || value.currentSession?.access_token);
```

## Verification Script

Script:

```text
scripts/verify-memory-shot-render-chain.mjs
```

Motion Story only:

```bash
node scripts/verify-memory-shot-render-chain.mjs \
  --base-url http://localhost:3000 \
  --journey-id <journey-id> \
  --memory-shot-id <ready-memory-shot-id> \
  --motion-story-only \
  --token <access-token>
```

Full generate, poster render, then Motion Story:

```bash
node scripts/verify-memory-shot-render-chain.mjs \
  --base-url http://localhost:3000 \
  --journey-id <journey-id> \
  --date 2026-07-09 \
  --token <access-token> \
  --language en
```

The script prints:

- artifact id
- artifact status
- public URL
- preview URL
- thumbnail URL
- `storage.web.provider/path/url`
- `storage.manifest.provider/path/url`
- manifest fetch result
- HTML fetch result
- basic HTML safety result

Expected pass:

```text
artifact.status = ready
publicUrl or previewUrl is present
storage.web.provider is media_server or supabase_fallback
storage.manifest.provider is media_server or supabase_fallback
manifest URL is accessible and parses as JSON
HTML URL is accessible
HTML contains OTR branding
HTML does not contain <script>
HTML does not contain javascript:
```

## Manual API Check

Call:

```bash
curl -X POST \
  http://localhost:3000/api/journeys/<journey-id>/memory-shots/<memory-shot-id>/motion-story \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response:

```json
{
  "artifact": {
    "artifactType": "motion_story",
    "variant": "scroll_story",
    "status": "ready"
  },
  "publicUrl": "...",
  "previewUrl": "...",
  "thumbnailUrl": "...",
  "storage": {
    "web": {
      "provider": "media_server",
      "path": "...",
      "url": "..."
    },
    "manifest": {
      "provider": "media_server",
      "path": "...",
      "url": "..."
    }
  }
}
```

## Fallback Verification

### Media Worker Down

Temporarily run the app with an invalid media worker URL or without media worker env:

```text
MEDIA_WORKER_URL=http://127.0.0.1:9
```

Generate Motion Story.

Expected pass:

```text
artifact.status = ready
storage.web.provider = supabase_fallback
storage.manifest.provider = supabase_fallback
artifact.render_warning contains media_server fallback reason
memory_shot.status remains ready
poster artifact remains unchanged
```

The fallback must not:

- mark the Memory Shot failed
- overwrite poster artifact storage
- remove existing `preview_url` or `thumbnail_url`
- break Highlights

### Media Worker Preferred Path

Run with:

```text
MEDIA_WORKER_URL
MEDIA_WORKER_SECRET
```

Expected pass:

```text
storage.web.provider = media_server
storage.manifest.provider = media_server
render_warning = null
```

## Permission Verification

### Journey Member

A Journey member can call:

```text
POST /api/journeys/:journeyId/memory-shots/:memoryShotId/motion-story
```

Expected:

```text
200 OK
artifact.status = ready
```

### Non-Member

Use an access token for a user who is not a Journey member.

Expected:

```text
403
No motion_story artifact is created
No storage object is uploaded
```

### Public Read

Public database read is not open in Phase 7.

Expected:

```text
Anonymous Supabase clients cannot list memory_shot_artifacts
Discover/public policies are not present
```

Note: `publicUrl` may point to media server or signed Supabase delivery for the generated HTML. That is delivery storage access, not public database read.

## Highlights Verification

Open:

```text
/trips/<journey-id>/highlights
```

Expected pass:

- `View Motion Story` appears only when a ready `motion_story / scroll_story` artifact has a URL.
- The link opens the generated mobile-first HTML.
- If artifact URL is missing, no broken link is shown.
- Existing poster preview and text fallback still work.
- Existing Generate / Regenerate behavior is unchanged.

## HTML Safety Checklist

The Motion Story renderer must keep the HTML skeleton safe.

Required:

- User text is escaped before insertion into HTML.
- No `<script>` tag is emitted.
- No `javascript:` URL is emitted.
- OTR branding is present in the ending card.
- The page does not load Google Drive original images directly.
- Image/video resource URLs should be from:
  - media server
  - Supabase fallback/signed URL
  - safe source image/video URLs already stored in Memory Shot asset metadata

Manual checks:

1. Open the generated HTML URL.
2. View source.
3. Search for:

```text
<script
javascript:
OTR
```

Expected:

```text
<script is absent
javascript: is absent
OTR is present
```

## Non-Goals

This phase does not include:

- Animation upgrade.
- Video clipping.
- Music.
- MP4 export.
- Discover.
- New Memory Shot templates.
- New complex UI.
