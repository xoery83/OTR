# Capture Semantic Understanding Strategy

## Purpose

This document records the current semantic understanding flow for the Capture
input area and the recommended improvement direction.

Capture should remain the primary entry point for Journey. Planner, Ledger,
Memories, Photos, Hotels, Reviews, Daily Summary, Travel Story, and future
modules should be outputs generated from captured real-world events.

The strategy here follows the Capture Engine V2 principles:

- Capture first. Structure later.
- Every capture creates one raw event.
- One event may generate multiple structured actions.
- LLM must never be called by default.
- Prefer rule engine, local NLP, and local vision before LLM escalation.
- New modules should usually be added as action handlers.

## Current High-Level Flow

```text
User enters text or media in Capture
  -> reviewCapture
  -> Planner import shortcut?
  -> Existing session local follow-up?
  -> Exact parser example?
  -> Frontend Capture State Machine?
  -> Server /api/capture-ai/detect?
      -> localPreparse
      -> localIntentEngine
      -> evaluateComplexity
      -> local result or LLM router
      -> normalizeDetection
  -> UI message and action cards
  -> User confirms
  -> executeCaptureAction
      -> create raw capture event
      -> execute actionGraph into Journey modules
```

## Main Components

### 1. Capture UI Submission

Primary entry point:

- `src/components/CaptureModalProvider.tsx`
- `reviewCapture`

Responsibilities:

- Validate selected Journey.
- Validate that text or media exists.
- Route bulk itinerary-looking text to Planner Import.
- Try local session follow-up.
- Try exact parser examples.
- Try the local Capture State Machine.
- Fall back to `/api/capture-ai/detect`.
- Render messages and action cards.

### 2. Capture Session Context

The UI keeps a `CaptureSessionState` with:

- `currentIntent`
- `currentFields`
- `missingFields`
- `lastQuestion`
- `actionGraph`
- `confidence`
- `completedActions`

`resolverStateFromSession` converts this UI session into state-machine input.
This is what allows short follow-ups such as:

- "我付的"
- "明天呢?"
- "改成下午 3 点"

to be understood as continuations of the previous Capture item.

### 3. Parser Exact Examples

Before general parsing, Capture checks whether the user has previously taught a
correction through Parser Upgrade.

Flow:

```text
Wrong parse
  -> "解析不对？教它一次"
  -> save corrected parse result
  -> future exact match returns corrected parse directly
```

This is good for specific bad phrases. For a broad language pattern, prefer
updating local rules and adding fixtures.

### 4. Frontend Capture State Machine

Main files:

- `src/capture/stateMachine/resolver/index.ts`
- `src/capture/stateMachine/rules/patternLibrary.ts`
- `src/capture/stateMachine/fixtures/capture-fixtures-batch-001.json`

Resolution order:

```text
pendingChoice
lastQuestion
correction
queryFollowup
fixture exact match
query
planner
ledger
memory
mixedIntent
llmFallback
```

The state machine outputs `CaptureResolution`, including:

- `intentType`
- `action`
- `fields`
- `missingFields`
- `confidence`
- `allowLLM`
- `source`

Current strengths:

- Deterministic query handling.
- Basic planner updates.
- Expense extraction with missing payer/split handling.
- Follow-up and correction handling.
- Regression coverage through fixtures.

### 5. Local Query Answering

If a local resolution has `action: "answer"`, the UI calls `answerLocalQuery`.

Current query intent types:

- `query_planner`
- `query_lodging`
- `query_ledger`

These read Journey data locally and produce an answer inside Capture. This
should not require LLM.

Important current quirk:

Query intents are currently folded into the top-level `assistant` intent for UI
type compatibility. If the local query succeeds, the card can still show an
answer through `payload.queryAnswer`. If local query matching fails, the same
sentence may fall through to generic "Ask AI Assistant" behavior.

The recent example:

```text
帮我查一下明天都有什么活动?
```

should be handled as:

```text
intentType: query_planner
action: answer
fields: { date: "tomorrow" }
allowLLM: false
```

### 6. Server Capture AI Detect

Main files:

- `src/app/api/capture-ai/detect/route.ts`
- `src/lib/capture-ai/server.ts`

Server flow:

```text
Validate request and auth
  -> load trip context
  -> load Capture AI config
  -> exact parser example check
  -> detectCaptureIntentOnServer
```

`detectCaptureIntentOnServer` does:

```text
localPreparse(text)
  -> localIntentEngine(text, preparse)
  -> evaluateComplexity(...)
  -> normalizeDetection(local) if simple
  -> LLM router if complex and enabled
  -> local fallback if LLM fails
```

### 7. localPreparse

`localPreparse` extracts cheap local signals:

- amount
- currency
- date hints
- time hints
- duration hints
- keywords
- possible actions
- sentence count
- image or attachment presence

It is a routing radar, not a full parser.

### 8. localIntentEngine

The server-side local intent engine handles:

- entry-point locks and biases
- memory capture
- planner capture
- accommodation capture
- accommodation plus expense action graphs
- expense capture
- navigation capture
- assistant tasks
- planner create/update
- memory fallback

It returns a partial `CaptureIntentDetection`, which is normalized before the UI
sees it.

### 9. Complexity Evaluation

`evaluateComplexity` decides whether LLM is needed.

Complexity increases for:

- image input
- attachment input
- multiple sentences
- multiple possible actions
- conflict or mutation language
- summary, recommendation, writing, weather, or reasoning requests
- Journey-context-heavy questions
- previous-session references
- low local confidence

Only complex captures should route to LLM when LLM routing is enabled.

### 10. normalizeDetection

All local and LLM results pass through `normalizeDetection`.

Responsibilities:

- Validate allowed top-level intent.
- Enforce confidence thresholds.
- Fall back to Memory when confidence is too low.
- Normalize action graph nodes and relations.
- Add required expense missing fields.
- Protect hotel duration from being inferred without explicit user evidence.
- Decide interaction level:
  - `auto_execute`
  - `clarification`
  - `confirm`
  - `full_form`

### 11. Confirmation and Execution

Primary file:

- `src/lib/capture-ai/actions.ts`

After user confirmation, `executeCaptureAction`:

```text
createRawCaptureEvent
  -> executeActionGraph
  -> dispatch capture events
```

For non-memory intents, it writes the raw event first, then executes structured
actions.

For memory or photo capture, it writes the raw event and creates the memory or
photo memory.

Current `executeActionGraph` supports:

- planner updates into itinerary events or reservations
- expenses into ledger entries

Future Journey modules should be added as action handlers behind the action
graph, not as separate primary input workflows.

## Current Problems

### 1. Two Local Understanding Systems

There is a frontend state machine and a server-side local intent engine. They
overlap but are not identical.

The frontend state machine is stronger for:

- deterministic Journey queries
- follow-ups
- fixture-based regression

The server local engine is stronger for:

- action graph generation
- entry-point bias and lock handling
- complex planner/expense combinations

This split can cause inconsistent behavior.

### 2. Query Is Not a First-Class Intent

Current top-level intents are:

- `memory`
- `planner_update`
- `expense`
- `navigation`
- `assistant`

Local query types such as `query_planner` are folded into `assistant`. This
makes UI labels and routing harder to reason about.

### 3. Assistant Means Too Many Things

`assistant` currently covers both:

- deterministic Journey-data answers
- real AI assistant tasks requiring reasoning or generation

These should be separated.

Examples:

```text
明天有什么活动?
```

should be deterministic Journey query.

```text
明天推荐怎么玩?
```

may require assistant reasoning.

### 4. Rules Are Keyword-Heavy

Chinese natural language has many equivalent query forms:

- 明天有什么活动
- 明天玩什么
- 明天都去哪
- 明天有什么项目
- 明天安排了啥
- 明天行程满吗

The local engine needs phrase families, not one-off phrases.

### 5. Date Parsing Is Split

Date logic exists in multiple places:

- state machine date parsing
- server preparse
- action execution date resolution

This can cause mismatches between what Capture understood and what the action
executor writes.

### 6. Action Execution Is Not Yet a Registry

`executeActionGraph` currently has direct loops for planner and expense nodes.
As more modules appear, this should become a registry of action handlers.

## Recommended Improvement Direction

### 1. Optimize For Zero Wrong Execution

Capture 2.0 should optimize for zero wrong execution, not maximum automation.

When classification confidence is not high enough, the system should defer
instead of asking the user to correct intent during a busy moment.

The first version should run in Safe Mode:

```text
Uncertain -> Capture Inbox / Today Review
Semi-certain -> Suggestion or prefilled form, no execution
Very certain -> Immediate action only if it is on the allowlist
Money, itinerary, delete, modify -> Always confirm
```

In a travel context, the worst acceptable outcome is:

```text
已收到，稍后整理。
```

The unacceptable outcomes are:

```text
Saving a memory as an expense
Writing an uncertain expense into Ledger
Changing itinerary from ambiguous language
Deleting or modifying records without confirmation
```

### 2. Make Immediate vs Deferred The First Decision

Capture 2.0 should not start with intent recognition.

The first state-machine decision is:

```text
Does this need immediate user-facing action?
```

Only after that should the system classify intent.

Default routing:

```text
User input
  -> Create raw capture event
  -> Explicit question / navigation / open-page command?
      -> Yes: answer or open immediately
  -> Explicit expense / planner / booking?
      -> Yes: open prefilled form or draft, never auto-save
  -> Explicit modify / delete / undo?
      -> Yes: show confirmation, never auto-execute
  -> Otherwise
      -> Capture Inbox / Today Review
```

### 3. Limit First-Version Immediate Actions

The first Capture 2.0 Preview should only allow four immediate action classes:

1. Answer an explicit Journey question.
2. Open navigation or map.
3. Open a prefilled form.
4. Modify or undo a recent item, with confirmation.

Everything else should be deferred.

Examples:

```text
今天风太大了，Bao差点摔了。
-> Capture Inbox
-> "已收到。"

停车50欧。
-> Open prefilled Ledger form
-> amount = 50, currency = EUR, suggested category = parking
-> no auto-save

今天住哪里？
-> Immediate Journey query answer

导航去酒店。
-> Immediate map/navigation action
```

### 4. Make Query a First-Class Internal Capability

Introduce explicit query action types or internal intents:

- `query_planner`
- `query_lodging`
- `query_ledger`
- future: `query_photos`, `query_memories`, `query_hotel`, `query_route`

Avoid presenting deterministic Journey queries as generic AI assistant tasks.

### 5. Separate Journey Query From AI Assistant

Use this boundary:

```text
Journey Query:
  deterministic lookup of existing Journey data
  no LLM by default

AI Assistant:
  recommendation, reasoning, writing, summarization, ambiguity resolution
  LLM allowed only when local logic cannot solve it
```

### 6. Build Safety And Phrase-Family Fixtures

For every real bad parse, add:

- the exact bad sentence
- nearby phrase-family expressions
- Chinese and English variants when relevant
- follow-up variants
- a safety expectation: immediate, prefilled form, confirmation, or deferred

Example family:

```text
明天有什么活动?
帮我查一下明天都有什么活动?
明天玩什么?
明天都去哪?
明天有什么项目?
明天安排了啥?
What activities do we have tomorrow?
What are we doing tomorrow?
```

These should all map to deterministic planner query behavior.

Safety examples:

```text
今天风太大了，Bao差点摔了。
-> deferred

停车50欧。
-> prefilled_expense_form

午饭改一下。
-> confirmation_required or deferred, never auto-modify
```

### 7. Move Toward A Shared Local Parser Core

Long-term target:

```text
shared local parser
  -> safety classification
  -> slots
  -> intent/action candidates
  -> action graph generator
```

The frontend and server should use the same core parser for deterministic
understanding. Server logic can still handle LLM escalation and richer action
graph generation.

### 8. Introduce Slot Schema

Normalize extracted meaning into slots:

- `date`
- `time`
- `location`
- `amount`
- `currency`
- `payer`
- `participants`
- `target`
- `operation`
- `module`
- `queryScope`
- `aggregate`
- `safetyClass`
- `deferReason`

Rules, examples, and LLM should all produce the same slot shape.

### 9. Improve Debug Visibility

Capture AI Debug should show:

- matched stage
- safety classification
- immediate/deferred decision
- defer reason
- exact example id, if any
- state machine source
- intent type
- extracted fields or slots
- action graph
- missing fields
- local confidence
- complexity reasons
- whether LLM was allowed or used

This will make Capture debugging much faster.

### 10. Create An Action Handler Registry

Replace direct action execution branches with registered handlers:

```text
planner.createEvent
planner.updateEvent
planner.createReservation
ledger.createExpense
memory.create
query.planner
query.ledger
hotel.review
photo.index
story.generate
```

This keeps Capture as the primary entry point while allowing new Journey modules
to plug in cleanly.

## Suggested Near-Term Plan

### 5-Day Preview Goal

The immediate goal is not to finish Capture 2.0.

The goal is to ship a travel-usable Capture 2.0 Preview before departure:

```text
Fast to open
Fast to speak
Fast to upload
Reliable at saving raw input
Low risk of wrong execution
```

Target:

```text
Complete 80% of the foundation needed for real travel use in 5 days.
```

Core principles for this 5-day preview:

1. Do not affect Capture Classic.
2. Capture 2.0 is an independent Preview entry point.
3. Optimize for travel usability, not complete automation.
4. Save every input safely before attempting interpretation.
5. When intent is uncertain, route to deferred / pending.
6. Expense, itinerary, delete, and modify operations must require confirmation.
7. Prioritize UI and experience. Advanced AI can come later.

### Phase 0: Product Architecture Reset

- Rewrite this strategy around Capture 2.0 as a parallel Preview module.
- Put the product principle first: Capture first, understand later.
- Add the Safe Mode principle: fewer actions are better than wrong actions.
- Define Immediate, Semi-immediate, Deferred, and Unsafe categories.
- Document that Capture Classic must remain unchanged until Preview is validated.

Exit criteria:

- The team agrees that the first state-machine decision is Immediate vs Deferred.
- The team agrees that money, itinerary, delete, and modify actions always require confirmation.
- The team agrees that ambiguous inputs go to Inbox / Today Review.

### Phase 1: Capture 2.0 Preview Shell

- Add a separate Capture 2.0 Preview entry point.
- Do not replace Capture Classic.
- Create the minimal Preview UI with four entry points:
  - Push To Talk
  - Upload Photos
  - Full Screen Text Editor
  - Quick Forms
- Create a minimal `CaptureEngine2` orchestration boundary.
- For every input, create or stage a raw capture event first.

Exit criteria:

- Users can open Capture 2.0 Preview without affecting Classic.
- Text input can be captured and safely acknowledged.
- No structured module writes happen automatically.

### Phase 2: Capture Inbox / Today Review

- Add Capture Inbox as the default destination for deferred input.
- Store raw input, input type, timestamp, Journey context, and status.
- Add basic statuses:
  - Captured
  - Analyzing
  - Suggested
  - Confirmed
  - Converted
  - Archived
- Add Today Review as the lightweight daily surface for recent unresolved captures.
- Support manual archive and manual convert-to-memory.

Exit criteria:

- Ambiguous text always lands in Inbox / Today Review.
- The UI never asks the user to correct intent during capture.
- The user can review deferred items later.

### Phase 3: Safe Mode State Machine

- Implement the first Capture 2.0 state machine around safety, not automation.
- First decision: Immediate vs Semi-immediate vs Deferred vs Unsafe.
- Allow only these immediate paths:
  - explicit Journey question
  - navigation/map/open-page command
  - prefilled form
  - modify/undo recent item with confirmation
- Route unknown, memory-like, diary-like, photo-like, and long-form inputs to Inbox.
- Add fixtures that prove dangerous inputs defer instead of executing.

Exit criteria:

- "今天风太大了，Bao差点摔了。" is captured and deferred.
- "停车50欧。" opens a prefilled Ledger form or draft, but does not save.
- "今天住哪里？" returns an immediate Journey answer.
- "导航去酒店。" opens navigation.
- Ambiguous expense/planner inputs never write directly.

### Phase 4: Prefilled Forms And Drafts

- Connect Semi-immediate captures to deterministic forms.
- Expense captures open Ledger form with prefilled amount/currency/category hints.
- Planner or booking captures open Planner/Booking form with prefilled fields.
- Forms can save, cancel, or leave a draft in Inbox.
- No money or itinerary record is created without user confirmation.

Exit criteria:

- Expense-like input can produce a useful prefilled form.
- Planner-like input can produce a useful prefilled form.
- Closing the form does not lose the raw capture.
- No form path bypasses confirmation.

### Phase 5: Background Processing And Suggestions

- Reuse existing OCR, image indexing, face recognition, Google Drive upload,
  geocoding, and AI services.
- Process Inbox items asynchronously.
- Generate suggestions for Memory, Ledger, Planner, Todo, Review, or Story.
- Keep suggestions non-executing until user confirmation.
- Store suggestion confidence, explanation, action graph, and target module.

Exit criteria:

- Photo and long-text captures can be analyzed after capture.
- Suggestions appear in Inbox / Suggestion Center.
- Users can confirm, edit, reject, or archive suggestions.

### Phase 6: Action Handler Registry

- Introduce action handler registration behind confirmed suggestions and forms.
- Move planner and ledger execution into handlers.
- Add memory and query handlers.
- Keep actionGraph as the handoff contract between Capture and Journey modules.

Exit criteria:

- New Journey modules can be added by registering handlers.
- Capture 2.0 remains an orchestration layer.
- Classic behavior remains unchanged unless explicitly migrated.

### Phase 7: Preview Validation And Classic Migration Decision

- Compare Capture Classic and Capture 2.0 Preview behavior.
- Measure wrong execution rate, defer rate, and user confirmation rate.
- Expand phrase-family fixtures and safety fixtures.
- Only migrate stable paths from Classic after validation.

Exit criteria:

- Wrong execution rate is near zero in Preview testing.
- Deferred items are recoverable and reviewable.
- The team can decide which Classic flows should migrate.

## Capture 2.0 First-Version Inputs

### 1. Push To Talk

Primary entry point.

Flow:

```text
Press and hold to speak
  -> record audio
  -> speech-to-text
  -> create capture_event
  -> Safe Mode classification
  -> answer / open form / deferred
```

Minimum requirements:

- Record audio.
- Transcribe speech to text.
- Save raw text and audio URL.
- Show "已收到" after success.
- If transcription fails, do not lose the audio.

### 2. Upload Photos

Secondary entry point.

Flow:

```text
Select photos
  -> upload
  -> create capture_event
  -> link media assets
  -> background processing
```

Minimum requirements:

- Support single-photo upload.
- Support multi-photo upload.
- Show uploading state.
- Show success feedback.
- Do not require immediate Memory generation.

### 3. Full Screen Text Input

Text entry should open a full-screen writing mode.

Best for:

- long diary
- travel journal
- detailed notes
- manual correction

Minimum requirements:

- Full-screen input.
- Save as capture_event.
- Default to deferred.
- Show "已收到，稍后整理".

### 4. Quick Forms

Deterministic fallback entry points:

- Add Memory
- Add Expense
- Add Plan / Booking
- Bulk Import

Requirements:

- Capture 2.0 can open existing forms or pages.
- Do not rewrite stable Classic form capabilities.
- Reuse proven Planner, Ledger, Memory, and Bulk Import flows.

## 5-Day Development And Test Plan

### Day 1: Preview Shell And UI

Build:

- Add Capture 2.0 Preview entry point.
- Keep Capture Classic unchanged.
- Create `Capture2Dialog`.
- Build first-screen UI:
  - Push to Capture
  - Upload
  - Text
  - Quick Forms
- Connect Quick Forms to existing features or pages.

Acceptance:

- Journey page can show a Capture 2.0 Preview button.
- Open and close feels smooth.
- Mobile layout is usable.
- Classic remains available.

### Day 2: Event Store

Build:

- Add or connect minimal `capture_events_v2`.
- Text input can save an event.
- Photo upload can save an event.
- Voice can initially save raw text or mock transcription if needed.

Minimum `capture_events_v2` fields:

```text
id
journey_id
user_id
input_type: voice / text / photo / form
raw_text
audio_url
media_asset_ids
gps
timezone
context_snapshot
classification_result
status: captured / deferred / immediate / failed / processed
created_at
updated_at
```

Acceptance:

- Every input creates a database record.
- Failures show clear feedback.
- Classic behavior is unaffected.

### Day 3: Voice Push To Talk

Build:

- Press and hold to record.
- Release to stop.
- Upload audio.
- Run speech-to-text.
- Save raw audio and raw text.
- Show "已收到" on success.

Acceptance:

- Mandarin can be recognized.
- Mixed Chinese and English can be recognized.
- Slow network does not lose audio.
- If recording fails, user can fall back to text input.

### Day 4: Safe Mode Classifier

Build rule-first classification:

```text
Question -> answer immediately
Navigation -> open map
Expense -> open Ledger form with prefilled fields
Booking / Plan -> open Planner form with prefilled fields
Memory / Unknown -> deferred
```

Avoid heavy LLM dependency in the first version.

Acceptance examples:

```text
今天住哪里？ -> answer
导航去酒店 -> map
停车50欧 -> Ledger form
今晚订了酒店 -> Planner form
今天风特别大 -> 已收到
这家餐厅不错 -> 已收到
```

Safety requirement:

- No ambiguous expense writes directly to Ledger.
- No ambiguous plan writes directly to Planner.
- Memory-like or unknown inputs defer.

### Day 5: Travel Test And Bug Fix

Test:

- Real mobile usage.
- Weak network.
- Multi-photo upload.
- Continuous voice capture.
- Error recovery.
- Preview switch.
- Optional simple developer event list.

Acceptance focus:

- No data loss.
- No wrong Ledger / Planner / Memory writes.
- UI does not interrupt the user.
- Capture Classic remains usable.
- The Preview feels safe enough to use while traveling.

## Travel Test Checklist

### Voice

```text
今天住哪里？
明天几点出发？
导航去酒店
停车50欧
加油100欧
今天终于看到鲸鱼了
这家餐厅不错，之后写游记
Bao差点摔倒
```

### Photos

```text
Upload 1 photo
Upload 10 photos
Upload screenshot
Retry failed upload
Switch page after upload
```

### Text

```text
Write a long travel diary
Add today's story
Enter expense description
Enter ambiguous note
```

### Forms

```text
Open Add Expense
Open Add Plan
Open Add Memory
Open Bulk Import
```

## Departure Go / No-Go Criteria

Go for Preview if:

- Capture Classic is unaffected.
- Capture 2.0 opens reliably.
- At least two of voice, photo, and text can save stably.
- Raw events are not lost.
- Expenses and itinerary items are not auto-saved incorrectly.
- Uncertain inputs become deferred.
- Mobile operation feels smooth.

Not required before departure:

- Complete Inbox.
- Complete Today Review.
- Perfect intent classification.
- Automatic Memory generation.
- Automatic bill splitting.
- Advanced AI self-learning.

Final focus:

```text
Do not chase intelligence first.
Chase trust in the travel moment.

Capture 2.0 Preview succeeds if it opens fast, records fast, uploads fast,
saves reliably, and avoids wrong operations.
```

## Operating Rule For Future Fixes

When a Capture semantic bug is found:

1. Save the exact input as a fixture.
2. Add nearby phrase-family fixtures.
3. Decide whether the safe behavior is immediate, prefilled form, confirmation,
   or deferred.
4. Prefer deferring over asking the user to correct intent in the moment.
5. Confirm the fixture cannot cause wrong execution.
6. Confirm money, itinerary, delete, and modify paths require confirmation.
7. Preserve raw event creation and actionGraph-based execution.

## Capture 2.0 Media Closeout Plan

### Current Product Boundary

Capture 2.0 media upload should split by media type:

- Photos return to the existing Memory and Album pipeline.
- Photo uploads create photo Memories, preserve the Google Drive original, create
  media assets, and use the existing background photo indexing and face
  detection jobs.
- Photos should not remain as ordinary Today Review items after the upload has
  successfully entered the Memory pipeline.
- Videos remain in Capture 2.0 Preview until the video processing module is
  ready.
- Video uploads should save the original file to Google Drive and create a raw
  capture event that is visible in Today Review with media context.

This keeps the first closeout small: photos use the proven production path, and
videos stay safe and reviewable.

### Video Processing Module Plan

Phase V1: Safe Intake

- Accept short videos from Capture 2.0 upload.
- Enforce configurable recommendation and hard limits.
- Save original video to Google Drive as source of truth.
- Create `media_assets` with video metadata: file size, mime type, width, height,
  duration when available, Drive file id, processing status, and metadata JSON.
- Create a `journey_capture_events` row with `referenced_video_ids`.
- Show the video item in Today Review with a placeholder if no thumbnail exists.

Phase V2: Metadata And Thumbnail Worker

- Add a background job type for `video_metadata_extract`.
- Add a background job type for `video_thumbnail`.
- Worker downloads the original video from Google Drive by `drive_file_id` into
  a temporary workspace.
- Extract duration, width, height, poster frame, and lightweight technical
  metadata.
- Upload thumbnail/preview image to Media Server or Supabase.
- Update `media_assets.thumbnail_url`, `preview_url`, `processing_status`, and
  `metadata_json` or `ai_metadata`.
- Delete the temporary original workspace copy after processing.

Phase V3: Preview Transcode

- Add `video_preview_transcode` job.
- Generate a small preview video suitable for mobile playback.
- Keep the original video only in Google Drive.
- Store preview output in Media Server or Supabase with retention policy.
- Today Review can play the preview video, but still does not auto-create a
  Memory.

Phase V4: Clip And Memory Actions

- Add `video_clip_extract` job.
- Let Today Review suggest actions such as "保存为视频记忆" or "生成 Motion Story
  素材".
- All video-derived Memories require user confirmation.
- Generated clips can be stored long-term as artifacts; raw originals stay in
  Google Drive.

Phase V5: Optional Understanding

- Only after the deterministic media pipeline is stable, add local or server-side
  video understanding such as scene detection, OCR on frames, or transcript
  extraction.
- LLM escalation remains optional and should not run by default.
