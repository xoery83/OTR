# JIE Phase 5A Smoke Checklist

Phase 5A validates the smallest safe Memory Shot generation path for
`memory_shot_daily_best_moments`.

## Scope

- Generate one Daily Best Moments Memory Shot from the existing Highlights page.
- Use `ai_jobs` as the job record.
- Use Prompt Center to render the prompt.
- Use Model Router `generateChat` to generate structured content.
- Save the frozen snapshot, linked assets, and HTML preview content.
- Show generated Memory Shots in the existing Highlights page.

## Out of Scope

- No Discover distribution.
- No Google Drive export.
- No PNG or PDF renderer.
- No unread badge.
- No Admin UI.
- No migration of existing Capture, parser, translation, or vision calls.
- No complex Highlights redesign.

## Smoke Path

1. Open an existing journey as the journey creator or a journey member.
2. Confirm the Highlights page loads existing rankings.
3. Click `Generate` in the Memory Shots card.
4. Confirm the button enters the generating state and cannot be double-submitted.
5. Confirm an `ai_jobs` row is created with:
   - `worker = memory_shot_worker`
   - `task = memory_shot_daily_best_moments`
   - `prompt_key = memory_shot_daily_best_moments`
6. Confirm a `memory_shots` row is created with:
   - `status = generating` during the run
   - `visibility = journey_members` by default
7. Confirm a `memory_shot_snapshots` row is saved before model output is applied.
8. Confirm Model Router records provider/model usage in job metadata or cost events when available.
9. Confirm the Memory Shot is marked `ready`.
10. Confirm the Highlights page shows the new Memory Shot with title, subtitle, visibility, and up to three sections.

## Failure Checks

1. If `ai_jobs` insert fails, the API response must include the database error message.
2. If Prompt Center fails, the Memory Shot must not affect existing Highlights rankings.
3. If Model Router fails, the Memory Shot must end in `failed`.
4. If generation fails after an `ai_jobs` row exists, the API error should include the `aiJobId`.
5. Existing Journey pages must remain usable after any Memory Shot failure.

## RLS Checks

1. Journey creator can create and list Memory Shots.
2. Journey member can create and list Memory Shots.
3. Non-member cannot create or list journey Memory Shots.
4. `public_unlisted` and `public_discover` are not used by Phase 5A.

## Known Limits

- Generation is synchronous inside the API request for the MVP skeleton.
- The UI is intentionally minimal and lives only in Highlights.
- The generated preview is stored as HTML content, not a rendered image.
- The worker collects only the source tables currently available in the repo.
- Existing service stability remains the first priority; no legacy AI paths are migrated in this phase.

## Next Stabilization Candidates

- Move execution from request-time synchronous work to an async worker loop.
- Add idempotency for same journey/template/date generation.
- Add a `failed` item view with retry metadata.
- Add focused tests around worker failure transitions.
- Add lightweight job detail logs for support/debugging.
