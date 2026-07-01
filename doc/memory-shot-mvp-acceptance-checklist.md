# Memory Shot MVP Acceptance Checklist

This checklist decides whether `memory_shot_daily_best_moments` can remain visible as the first Memory Shot MVP.

Scope:

- Daily Best Moments only.
- Highlights page only.
- Generate, render, storage fallback, and preview display only.
- No Discover, no new templates, no Admin UI, and no download/share workflow.

## Acceptance Standard

The MVP is acceptable when:

- A Journey member can generate and regenerate a Daily Best Moments Memory Shot.
- A failed AI or render step does not break the Journey page.
- The page can show either image preview/thumbnail or text fallback.
- Fallback storage paths are recorded as warnings, not fatal user-facing failures.
- Mobile layout remains usable and the preview image does not dominate the whole page.

## Manual Verification Items

### Generate

- Open `/trips/<journey-id>/highlights` as a Journey member.
- Click `Generate` for Daily Best Moments.
- Confirm a Memory Shot row is created.
- Confirm status moves through `generating` and eventually becomes `ready` or `failed`.
- Confirm the Journey page remains usable during generation.

Expected pass:

- No duplicate submission from a single click.
- Ready Shot has `title`, `subtitle`, `sections`, `htmlPreview`, `modelInfo`, `visibility`, and `created_at`.

### Regenerate

- Generate one ready Daily Best Moments Shot.
- Click `Regenerate`.
- Confirm the app creates a new Shot/version instead of mutating the existing ready Shot unexpectedly.
- Confirm older Shots remain visible and sorted newest first.

Expected pass:

- Regenerate is explicit and does not overwrite existing visible content silently.
- If another Shot is currently `generating` for the same date/template, a duplicate generate is blocked.

### AI Failed

- Temporarily make Model Router fail, or use an invalid model/provider env in a local test.
- Click `Generate`.
- Confirm the Memory Shot status becomes `failed`.
- Confirm the AI job records the error.
- Confirm Highlights shows a short failure message with debug details collapsed.

Expected pass:

- No half-ready Shot is shown as successful.
- Existing Journey data and Highlights rankings still render.

### Render Failed

- Generate a ready Shot.
- Force render retry to fail, or make the renderer unavailable in a local test.
- Confirm `memory_shots.render_status = failed`.
- Confirm `render_error` is recorded.
- Confirm the Shot itself remains `ready`.
- Confirm Highlights shows text fallback and a short render failure message.

Expected pass:

- Render failure does not change `memory_shots.status` from `ready` to `failed`.
- User can still read the generated Memory Shot content.

### Media Worker Fallback

- Run without `MEDIA_WORKER_URL`, with an invalid `MEDIA_WORKER_URL`, or with the media worker stopped.
- Generate or retry render.
- Confirm preview and thumbnail storage fallback to Supabase.
- Confirm `render_warning` records the media worker fallback reason.

Expected pass:

- `render_status = ready`.
- `render_error = null`.
- `preview_storage_provider = supabase_fallback`.
- `thumbnail_storage_provider = supabase_fallback`.
- Highlights still displays `preview_url` or `thumbnail_url` if present.

### Google Drive Fallback

- Test with a Journey that has no Google Drive binding, or without required Google Drive env locally.
- Generate or retry render.
- Confirm original render falls back to Supabase.
- Confirm `render_warning` records the Google Drive fallback reason.

Expected pass:

- `render_status = ready`.
- `render_error = null`.
- `original_storage_provider = supabase_fallback`.
- `original_drive_file_id = null`.
- `original_drive_url = null`.
- Highlights does not attempt to load Google Drive original image.

### Preview / Thumbnail Display

- Generate a ready Shot with `preview_url` and/or `thumbnail_url`.
- Open Highlights on desktop and mobile widths.
- Confirm the image appears before text content.
- Confirm the card prefers `preview_url` when available.
- Confirm the preview image is contained within the card and does not exceed the intended mobile-friendly size.

Expected pass:

- Image uses contained sizing, rounded border, and does not stretch full page height.
- Sections are summarized, with extra details collapsed.

### Text Fallback

- Test a ready Shot with no `preview_url` and no `thumbnail_url`.
- Open Highlights.
- Confirm title, subtitle, visibility, created time, and section text still display.

Expected pass:

- No broken image placeholder.
- Full text fallback remains readable.

### Mobile Layout

- Open Highlights on a narrow mobile viewport.
- Confirm Generate/Regenerate button remains usable.
- Confirm preview image fits within the card.
- Confirm status, visibility, created time, and warning/error messages do not overlap.
- Confirm bottom navigation and floating capture button do not hide the essential card controls.

Expected pass:

- Memory Shot card is scannable without horizontal scrolling.
- Long titles and sections wrap or clamp cleanly.

### Permission Check

- Try generating as a user who is not a Journey member.
- Try listing Memory Shots as a user who is not a Journey member.
- Try rendering/retrying a Memory Shot as a user who is not a Journey member.

Expected pass:

- Requests return a clear authorization error.
- No Memory Shot, AI job, render file, or storage object is created for unauthorized users.
- Existing authorized member flow still works.

## Known Limitations

- Only `memory_shot_daily_best_moments` is supported.
- No Discover distribution.
- No long image download.
- No PDF export.
- No Admin UI for Prompt Center, templates, or render jobs.
- No unread red dot state.
- No Google Drive user-facing download/share flow.
- No complex Memory Shot template system.
- No batch generation.
- No full migration of existing AI calls into Model Router.

## Must Fix Before Launch

### Eslint Hang Investigation

- `npx eslint 'src/app/trips/[tripId]/highlights/page.tsx'` has hung in the local environment without output.
- Confirm whether this is project config, Next/ESLint version behavior, local process state, or environment-specific.
- Launch should not proceed until targeted page lint can complete reliably in CI or an equivalent check.

### Migration Order Confirmation

Confirm the production migration order:

```text
052_jie_ai_job_queue.sql
053_jie_prompt_center.sql
054_memory_shots_v1.sql
055_ai_jobs_current_step.sql
056_jie_creator_rls_compat.sql
057_memory_shot_renderer_v1.sql
058_memory_shot_render_storage_router.sql
```

Required checks:

- Existing production tables are not overwritten.
- RLS policies allow Journey members to read expected data.
- Server-side workers can write required job, shot, snapshot, and render fields.
- Prompt seed for `memory_shot_daily_best_moments` is active.

### Supabase Bucket Permission Confirmation

Confirm fallback buckets before launch:

- Original render fallback bucket accepts server-side upload.
- Preview render fallback bucket accepts server-side upload.
- Thumbnail render fallback bucket accepts server-side upload.
- Public or signed URL behavior matches the app's display path.
- Bucket policies do not allow unauthorized writes.
- Expiration/access behavior will not break Highlights preview display.

## Go / No-Go

Go when every manual verification item above passes, and every launch blocker is resolved or explicitly accepted with a rollback plan.

No-go if:

- Generate can break existing Highlights.
- Render failure can hide a ready Shot.
- Storage fallback can mark the Shot failed.
- Unauthorized users can create or read Memory Shots.
- The page has no reliable fallback when preview image is missing.
