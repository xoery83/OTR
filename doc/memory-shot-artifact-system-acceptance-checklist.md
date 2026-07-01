# Memory Shot Artifact System Acceptance Checklist

This checklist decides whether the first-stage Memory Shot artifact system can remain as the foundation for Discover, sharing, and future template expansion.

Scope:

- Daily Best Moments Memory Shot.
- Poster artifact dual write.
- Motion Story skeleton artifact.
- Existing Highlights display.
- Storage fallback and permission boundaries.

Out of scope:

- Discover.
- Public share.
- New templates.
- Grid 9 rendering.
- Admin UI.
- Video editing or music.

## Acceptance Standard

The artifact system is acceptable when:

- `memory_shot.status` represents Story Script readiness.
- `memory_shot_artifacts.status` represents each concrete output readiness.
- Poster and Motion Story can succeed or fail independently.
- Existing Highlights behavior remains stable.
- Fallback storage does not mark the Memory Shot failed.
- Non-members cannot generate or read private artifact database rows.
- Motion Story HTML is safe enough for skeleton delivery.

## Manual Verification Items

### Daily Best Moments Generates Memory Shot

- Open `/trips/<journey-id>/highlights` as a Journey member.
- Click `Generate`.
- Confirm a Daily Best Moments Memory Shot is created.
- Confirm status becomes `ready` or a clear `failed`.

Expected pass:

- `memory_shot.status = ready` when Story Script content is ready.
- `content.title`, `content.subtitle`, `content.sections`, and `content.htmlPreview` are present.
- Existing rankings and Journey page remain usable.

### Poster Artifact Dual Write

- Generate or retry render for a ready Memory Shot.
- Query `memory_shot_artifacts`.
- Confirm a row exists:

```text
artifact_type = poster
variant = long_poster
status = ready
```

Expected pass:

- Existing `memory_shots.preview_url`, `thumbnail_url`, `render_status`, and storage fields are still written.
- Poster artifact stores `storage.original`, `storage.preview`, and `storage.thumbnail`.
- Poster artifact stores renderer metadata and fallback warning metadata.
- `memory_shot_artifact_assets` mirrors related `memory_shot_assets`.

### Poster Preview / Thumbnail Display

- Open Highlights after poster render.
- Confirm poster preview or thumbnail displays in the Memory Shot card.
- Confirm card still has text fallback when image URLs are absent.

Expected pass:

- Page reads existing `memory_shots.preview_url` or `thumbnail_url`.
- Page does not load Google Drive original images.
- Preview is mobile-friendly and does not dominate the page height.

### Motion Story Artifact Generation

Use:

```bash
node scripts/verify-memory-shot-render-chain.mjs \
  --base-url http://localhost:3000 \
  --journey-id <journey-id> \
  --memory-shot-id <ready-memory-shot-id> \
  --motion-story-only \
  --token <access-token>
```

Expected pass:

```text
artifact_type = motion_story
variant = scroll_story
status = ready
public_url or preview_url is present
thumbnail_url is present when poster preview/thumbnail exists
```

### Motion Story URL Opens

- Open the returned `public_url` or `preview_url`.
- Confirm mobile-first HTML loads.
- Confirm structure includes cover, chapters, and ending card.

Expected pass:

- URL returns a successful HTTP response.
- OTR branding is visible.
- Page is usable on mobile width.

### Manifest Access

- Open the returned manifest URL from `storage.manifest.url`.
- Parse as JSON.

Expected pass:

```text
manifest.artifact_type = motion_story
manifest.variant = scroll_story
manifest.chapters is an array
manifest.layout.aspectRatio = 9:16
manifest.branding.enabled = true
```

### Media Worker Fallback

- Run app with invalid or missing media worker env.
- Generate Poster and Motion Story.

Expected pass:

- Poster preview/thumbnail fallback to Supabase.
- Motion Story web/manifest fallback to Supabase.
- `render_warning` records media worker fallback.
- `memory_shot.status` remains `ready`.
- Existing poster artifact is not overwritten by Motion Story fallback.

### Supabase Fallback

Confirm fallback outputs are accessible:

- poster preview/thumbnail signed URL
- Motion Story HTML signed URL
- Motion Story manifest signed URL

Expected pass:

- URLs open during expected signed URL lifetime.
- Bucket policies do not allow unauthorized writes.
- Fallback does not create public database read policies.

### Google Drive Original Fallback

- Use a Journey without Google Drive binding, or run without Google Drive service env.
- Generate or retry poster render.

Expected pass:

```text
poster original provider = supabase_fallback
original_drive_file_id = null
original_drive_url = null
memory_shot.status remains ready
poster artifact.status remains ready
```

Highlights must not load Google Drive original assets directly.

### Status Boundary

Verify independent status behavior:

- Story Script generation failure sets `memory_shot.status = failed`.
- Poster render failure sets poster `artifact.status = failed` and legacy `memory_shots.render_status = failed`.
- Motion Story render failure sets Motion Story `artifact.status = failed`.
- Motion Story failure does not change poster artifact status.
- Poster failure does not block future Motion Story generation from a ready Story Script.

Expected pass:

- `memory_shot.status` answers: is the Story Script ready?
- `artifact.status` answers: is this output ready?

### Non-Journey Member Permission

Use a token for a non-member.

Try:

- list Memory Shots
- render poster
- generate Motion Story
- query artifact rows through Supabase client

Expected pass:

```text
403 or no rows
No new artifact row is created
No storage object is uploaded
No public database read is available
```

### HTML Safety

Inspect Motion Story HTML.

Required:

- User text is escaped.
- No `<script>` tag.
- No `javascript:` URL.
- External background media URL is `http` or `https`.
- Page does not use Google Drive original images directly.
- OTR branding remains present.

Script check:

```bash
node scripts/verify-memory-shot-render-chain.mjs \
  --base-url http://localhost:3000 \
  --journey-id <journey-id> \
  --memory-shot-id <ready-memory-shot-id> \
  --motion-story-only \
  --token <access-token>
```

Expected pass:

```text
HTML contains OTR branding
HTML does not contain <script>
HTML does not contain javascript:
```

### Mobile Display

Verify on a narrow viewport:

- Highlights Memory Shot card remains scannable.
- Poster preview is contained.
- `View Motion Story` appears only when URL exists.
- Motion Story HTML is readable as a vertical scroll story.
- No horizontal scrolling is required.

Expected pass:

- Title, subtitle, chapters, and OTR ending card fit mobile display.
- Missing Motion Story URL does not render a broken link.

## Known Limitations

- Motion Story is only a skeleton.
- No video clipping.
- No music.
- No Discover.
- No public share.
- No `grid_9` rendering.
- No Admin UI.
- No MP4 export.
- No template picker.
- No Motion Story analytics.
- No artifact cleanup/retention policy yet.

## Launch Blockers To Resolve Or Accept

- Confirm production migration order through `060_memory_shot_artifacts_v1.sql`.
- Confirm `memory-shot-renders` bucket policy and signed URL behavior.
- Confirm media worker accepts Motion Story `web` and `manifest` uploads.
- Confirm eslint hang is resolved in CI or accepted with a temporary alternative.
- Confirm non-member RLS behavior in a real Supabase environment.

## Optional Next Directions

### A. Discover Phase 1

- Add explicit user authorization before public distribution.
- Add safety review artifact or job.
- Add public read policies only for approved Discover artifacts.
- Publish preview/thumbnail only, not Google Drive originals.

### B. Grid 9 Poster

- Add `grid_9` renderer path.
- Store `grid_slices`.
- Keep `single/long poster` compatibility.
- Display grid only where the UI can handle it.

### C. Admin AI Dashboard

- Show AI jobs, prompt versions, model usage, cost estimates, render status, and artifact errors.
- Provide retry controls for failed artifacts.
- Keep Journey user UI simple.

### D. Motion Story UI Polish

- Add richer transitions and chapter layout variants.
- Improve cover image selection.
- Add inline preview in Highlights.
- Keep HTML skeleton safe and mobile-first.

### E. Unread Red Dot

- Use `memory_shot_reads` to show unread state for Journey members.
- Keep unread state scoped to Journey members.
- Do not expose unread state publicly.

## Go / No-Go

Go when all manual verification items pass and launch blockers are resolved or explicitly accepted.

No-go if:

- Artifact write failures can break existing Memory Shot generation.
- Motion Story failure changes `memory_shot.status`.
- Fallback storage marks artifacts or Memory Shots failed incorrectly.
- Non-members can generate or read private artifacts.
- Highlights can show broken Motion Story links.
- Motion Story HTML can execute injected script.
