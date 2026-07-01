# Memory Shot Local Smoke Run Support

This guide runs one local end-to-end smoke test for:

```text
Daily Best Moments generation
-> htmlPreview
-> renderer worker
-> original / preview / thumbnail storage
-> Highlights display fields
```

No new template, Discover, UI, or photo upload flow is involved.

## 1. Apply Migrations

Apply pending migrations in numeric order. For the Memory Shot chain, the required sequence is:

```text
052_jie_ai_job_queue.sql
053_jie_prompt_center.sql
054_memory_shots_v1.sql
055_ai_jobs_current_step.sql
056_jie_creator_rls_compat.sql
057_memory_shot_renderer_v1.sql
058_memory_shot_render_storage_router.sql
```

If earlier migrations are already applied, apply only the pending ones. `056` is important for creator/member RLS compatibility. `057` adds renderer fields and the fallback render bucket. `058` adds storage provider/path fields and `render_warning`.

Use the repo's normal Supabase flow. For local Supabase CLI setups this is typically:

```bash
supabase db push
```

For a remote project, apply the same migrations through your deployment flow before running the smoke test.

## 2. Start The App

```bash
npm run dev
```

Keep the app running at:

```text
http://localhost:3000
```

## 3. Confirm Environment

Required for app/API:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Required for model generation:

```text
DeepSeek/OpenAI/Qwen env used by Model Router
```

Required for Google Drive original render preferred path:

```text
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_TOKEN_ENCRYPTION_KEY
```

Required for media worker preferred path:

```text
MEDIA_WORKER_URL
MEDIA_WORKER_FALLBACK_URL
MEDIA_WORKER_SECRET
AI_SERVER_URL
```

`MEDIA_WORKER_FALLBACK_URL` and `AI_SERVER_URL` are optional fallbacks. `MEDIA_WORKER_URL` and `MEDIA_WORKER_SECRET` are enough for the preferred media path.

## 4. Get Current User Access Token

1. Open the app in the browser.
2. Log in as a user who can access the target Journey.
3. Open browser DevTools Console.
4. Run:

```js
const key = Object.keys(localStorage).find(
  (item) => item.startsWith("sb-") && item.endsWith("-auth-token"),
);
const value = JSON.parse(localStorage.getItem(key));
copy(value.access_token || value.currentSession?.access_token);
```

The token is copied to your clipboard. Do not commit or share it.

## 5. Find Journey Id And Date

Use the Journey URL or database row id. The route usually contains:

```text
/trips/<journey-id>/...
```

Pick a date with Journey data, for example:

```text
2026-07-09
```

If there is little or no data on that date, the worker should still create a basic Memory Shot fallback.

## 6. Run Verification Script

```bash
node scripts/verify-memory-shot-render-chain.mjs \
  --base-url http://localhost:3000 \
  --journey-id <journey-id> \
  --date 2026-07-09 \
  --token <paste-access-token> \
  --language en
```

You can also use env:

```bash
OTR_BASE_URL=http://localhost:3000 \
JOURNEY_ID=<journey-id> \
MEMORY_SHOT_DATE=2026-07-09 \
OTR_ACCESS_TOKEN=<paste-access-token> \
MEMORY_SHOT_LANGUAGE=en \
node scripts/verify-memory-shot-render-chain.mjs
```

For help:

```bash
node scripts/verify-memory-shot-render-chain.mjs --help
```

## 7. Expected Successful Output

Look for:

```text
status: ready
renderStatus: ready
previewUrl: present
thumbnailUrl: present
```

Preferred storage path:

```text
original.provider = google_drive
preview.provider = media_server
thumbnail.provider = media_server
renderWarning = null
```

Local fallback path is also acceptable:

```text
original.provider = supabase_fallback
preview.provider = supabase_fallback
thumbnail.provider = supabase_fallback
renderWarning contains fallback reason
```

## 8. Media Worker Fallback

If `MEDIA_WORKER_URL` is missing, wrong, or the worker is down:

```text
preview_render.webp -> Supabase fallback
thumbnail_render.webp -> Supabase fallback
render_status -> ready
render_error -> null
render_warning -> contains "media_server unavailable"
```

This is expected in local development. It should not fail the Memory Shot.

## 9. Google Drive Fallback

If Google Drive is not connected for the Journey, or service role/token env is missing:

```text
original_render.png -> Supabase fallback
original_drive_file_id -> null
original_drive_url -> null
render_status -> ready
render_error -> null
render_warning -> contains "google_drive unavailable"
```

This is expected unless you are specifically validating the Drive preferred path.

## 10. Browser Check

1. Open:

```text
/trips/<journey-id>/highlights
```

2. Confirm the Memory Shot card is visible.
3. Confirm a generated Shot appears.
4. If `thumbnail_url` or `preview_url` exists, the card should show the image.
5. If render fallback happened, the text fallback should still be visible and the Journey page should remain usable.

## 11. Common Failures

Missing token:

```text
Missing required input: --token or OTR_ACCESS_TOKEN
```

Fix by copying the logged-in Supabase access token from the browser.

Not a Journey member:

```text
403 You must be a journey member...
```

Use a Journey that the current logged-in user can access.

Prompt missing:

```text
Prompt Center active prompt not found for memory_shot_daily_best_moments
```

Apply `053_jie_prompt_center.sql` and confirm the seed prompt is active.

RLS insert failure:

```text
new row violates row-level security policy
```

Apply `056_jie_creator_rls_compat.sql`.

Renderer fallback warnings:

```text
renderWarning: google_drive unavailable...
renderWarning: media_server unavailable...
```

These are acceptable for local smoke if `renderStatus` remains `ready`.
