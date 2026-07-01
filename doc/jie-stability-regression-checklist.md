# JIE Stability Regression Checklist

## Stability Principle

Existing service stability is the first principle for every JIE phase.

JIE must be introduced as an adapter layer before it becomes the default
execution path for business features. Capture, planner import, photo indexing,
translation, vision, geocoding, place resolution, and Google Drive upload must
continue to work exactly as they do today while JIE infrastructure evolves.

Until each migration point has a completed risk review and passing regression
check, do not replace an existing production call chain with the new Model
Router.

## Current Guardrails

### Old Behavior Must Remain Stable

The following chains must keep their current request shape, response shape,
error behavior, environment variables, and user-visible fallback behavior:

- Capture text and media input.
- Itinerary parser and planner import.
- Photo upload and image indexing.
- Content translation and menu language pack generation.
- Legacy vision router.
- Geocoding and place resolution.
- Google Drive OAuth, folder creation, and upload.

### Model Router Must Stay Adapter-First

Model Router v1 is allowed to exist underneath old APIs only when these rules
hold:

- Old API input remains unchanged.
- Old API output remains unchanged.
- Old error messages and HTTP statuses remain unchanged unless explicitly fixed
  in a separate task.
- Old environment variables continue to work.
- Existing features do not require the new `ai_jobs` tables to exist.
- Existing background jobs continue to use `background_jobs`.
- New router metadata must not leak into public responses unless the old API
  already returned debug metadata.
- If Model Router fails inside an adapter, the old fallback behavior must still
  be preserved.

### No Hidden Feature Coupling

Before Prompt Center, Memory Shots, or Discover work begins, the following must
remain true:

- Capture can save raw events without Model Router.
- Local itinerary parser can return local results without Model Router.
- Photo indexing can use the image-index service without Model Router.
- Translation can use LibreTranslate without Model Router.
- Geocoding can use existing provider order without Model Router.
- Google Drive upload can complete without Model Router or `ai_jobs`.

## Smoke Test Checklist

Run these checks after any change to JIE, Model Router, AI provider plumbing, or
worker orchestration.

### 1. Capture Text Input

Flow:

```text
Capture UI
  -> /api/capture/events
  -> journey_capture_events
```

Test:

- Open a Journey.
- Capture one text memory such as "Coffee was great at the station."
- Confirm one raw capture event is created.
- Confirm no LLM call is required for saving the raw event.
- Confirm the user sees the normal Capture success state.

Pass criteria:

- Request succeeds with existing auth.
- Response still returns `captureEventId`.
- No dependency on `ai_jobs`.
- No new user-visible error copy.

### 2. Itinerary Image Import

Flow:

```text
Planner import image
  -> /api/ai/read-itinerary-image
  -> legacy vision router adapter
  -> planner import text parse
```

Test:

- Upload or select an itinerary image in planner import.
- Confirm OCR/vision result appears as before.
- Continue into parse/import flow.

Pass criteria:

- Existing `analyzeImage(...)` and `analyzeImageForDebug(...)` signatures work.
- `IMAGE_INDEX_VISION_PROVIDER`, `OPENAI_VISION_MODEL`, and
  `DASHSCOPE_VISION_MODEL` still behave as before.
- Basic mode can still return local metadata-only output.
- Debug path can still expose raw model response where it did before.

### 3. Photo Upload And Image Indexing

Flow:

```text
Photo upload
  -> Google Drive or existing storage
  -> background_jobs
  -> /api/ai/index-photo
  -> image-index service
  -> vision fallback only if service fails
```

Test:

- Upload one photo into a Journey.
- Confirm media asset is created.
- Confirm image indexing job is queued.
- Confirm `/api/ai/index-photo` marks the asset processing, then indexed.
- If the image-index service is unavailable in the test environment, confirm
  the existing vision fallback behavior still works.

Pass criteria:

- `background_jobs` remains the job system for this path.
- `IMAGE_INDEX_SERVICE_URL` or `AI_SERVER_URL` and `AI_SERVER_SECRET` still
  control the primary indexing service.
- Fallback still writes `ai_status`, `ai_metadata`, `ocr_text`, `scene_tags`,
  and `indexed_at`.
- No hard dependency on `ai_jobs`.

### 4. Menu Language Pack Generation

Flow:

```text
Admin localization
  -> generate locale bundle job
  -> generateMenuLanguagePack
  -> configured LLM provider
```

Test:

- Start a menu language pack generation job.
- Confirm the job uses the existing provider selection.
- Confirm generated JSON validates and placeholder repair still runs.

Pass criteria:

- `MENU_TRANSLATION_PROVIDER` remains honored.
- Provider order remains DeepSeek fallback or configured provider first.
- OpenAI, DeepSeek, and Bailian/Qwen env names remain supported.
- Existing JSON repair and placeholder validation remain unchanged.

### 5. Translate One Message

Flow:

```text
TranslatedText or i18n content route
  -> translateUserContent
  -> translation/provider
  -> LibreTranslate by default
```

Test:

- Translate one memory/message from the UI.
- Confirm cached translation lookup still works.
- Confirm a new translation writes the existing `content_translations` fields.

Pass criteria:

- `TRANSLATION_PROVIDER=libretranslate` remains the default.
- `TRANSLATION_API_BASE_URL` and `TRANSLATION_API_KEY` remain required for
  LibreTranslate.
- Unsupported `deepseek` or `openai` direct translation behavior is not changed
  until an explicit migration task.
- Existing error messages remain stable.

### 6. Place Geocoding

Flow:

```text
Map / location resolve
  -> /api/geocode or /api/locations/resolve
  -> existing geocoder order
```

Test:

- Search a normal destination such as "Reykjavik".
- Resolve a place from a planner or memory location.
- Confirm a coordinate is returned and saved where expected.

Pass criteria:

- `/api/geocode` still tries Nominatim, then Photon.
- Place service still honors `ENABLE_GOOGLE_PLACES`,
  `ENABLE_GOOGLE_GEOCODING`, `ENABLE_MAPBOX_GEOCODING`, and
  `ENABLE_NOMINATIM`.
- LLM location normalization remains opt-in through
  `ENABLE_LLM_LOCATION_NORMALIZATION`.
- Missing OpenAI key does not break ordinary geocoding.

### 7. Google Drive Upload

Flow:

```text
Photo capture/upload
  -> /api/google-drive/upload-photo
  -> storage connection
  -> Google token refresh
  -> Drive folder creation
  -> Drive upload
  -> media variants
```

Test:

- Connect Google Drive if needed.
- Upload one photo.
- Confirm original and thumbnail folder handling works.
- Confirm media asset stores Drive references as before.

Pass criteria:

- `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, and
  `GOOGLE_CLIENT_SECRET` behavior remains unchanged.
- Existing encrypted token flow remains unchanged.
- Existing folder creation and media folder metadata remain unchanged.
- No dependency on Model Router, Prompt Center, or `ai_jobs`.

## Migration Risk Register

Each migration must update this section before code changes are made.

### Capture AI

Current call chain:

```text
Capture UI / capture-ai client
  -> /api/capture-ai/detect
  -> src/lib/capture-ai/server.ts
  -> local pre-parser and rule engine
  -> optional OpenAI/DeepSeek LLM
  -> local memory fallback
```

Env dependencies:

- `AI_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_API_URL`
- `OPENAI_MODEL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_API_URL`
- `DEEPSEEK_MODEL`

Failure fallback:

- Local intent engine when confidence is sufficient.
- Local fallback when LLM routing is disabled.
- Local memory fallback after LLM failure.

User impact risk:

- High. Capture is the primary input path.
- Any response shape change can break confirmation cards, action graph UI, or
  memory fallback behavior.

Recommended migration:

- Do not migrate first.
- Add a narrow adapter behind the existing provider loop only after Capture
  smoke tests are automated.
- Preserve `providerErrors`, `rawResponse`, normalized detection shape, and
  local fallback exactly.

### Itinerary Parser

Current call chain:

```text
Planner import
  -> /api/ai/parse-itinerary
  -> exact parser example
  -> local parser
  -> OpenAI/DeepSeek provider loop
  -> parser parse log
```

Env dependencies:

- `AI_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_API_URL`
- `OPENAI_MODEL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_API_URL`
- `DEEPSEEK_MODEL`

Failure fallback:

- Exact corrected parser example.
- Local parser.
- Provider fallback from preferred provider to the next configured provider.
- Returns existing parse error if all AI providers fail.

User impact risk:

- High for planner import.
- Structured JSON schema behavior differs between OpenAI and DeepSeek.
- Existing parser logs and local example matching must not change.

Recommended migration:

- Wrap only `callOpenAI(prompt)` with Model Router after preserving strict
  OpenAI schema behavior and DeepSeek JSON object behavior.
- Keep exact-example and local-parser stages outside Model Router.
- Keep `source: "example" | "local" | "ai"` unchanged.

### Photo Indexing

Current call chain:

```text
Photo upload
  -> enqueueMediaProcessingJobs
  -> background_jobs
  -> /api/ai/index-photo
  -> image-index service
  -> vision fallback through legacy vision router
```

Env dependencies:

- `IMAGE_INDEX_SERVICE_URL`
- `AI_SERVER_URL`
- `AI_SERVER_SECRET`
- `IMAGE_INDEX_VISION_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL`
- `OPENAI_BASE_URL`
- `OPENAI_API_URL`
- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `DASHSCOPE_VISION_MODEL`

Failure fallback:

- If image-index service fails, fallback to legacy vision router.
- Asset status and metadata are updated by the route.

User impact risk:

- High for photo-heavy Journeys.
- Breaking metadata writes affects Timeline, Photos, People, search, and later
  Memory Shots.

Recommended migration:

- Keep `background_jobs` as the execution queue until a Worker Manager exists.
- Keep image-index service as primary.
- Model Router may remain under the legacy vision adapter for fallback only.
- Do not change `PhotoIndexResult` shape.

### Translation Provider

Current call chain:

```text
TranslatedText / content translation route
  -> translateUserContent
  -> src/lib/translation/provider.ts
  -> LibreTranslate
```

Env dependencies:

- `TRANSLATION_PROVIDER`
- `TRANSLATION_API_BASE_URL`
- `TRANSLATION_API_KEY`

Failure fallback:

- Empty text returns disabled result.
- Unsupported providers currently throw "not implemented yet".
- LibreTranslate network errors include network details.

User impact risk:

- Medium to high.
- Translation is visible across user content and admin localization.
- Changing engine labels can break caching or reporting.

Recommended migration:

- Do not silently switch default translation from LibreTranslate to LLM.
- Add an explicit `TRANSLATION_PROVIDER=model_router` mode later.
- Preserve `TranslateTextResult.engine` values or add new values with migration
  handling.

### Menu Language Pack

Current call chain:

```text
Admin localization
  -> background_jobs
  -> generateMenuLanguagePack
  -> OpenAI / DeepSeek / Bailian provider config
  -> JSON repair and placeholder validation
```

Env dependencies:

- `MENU_TRANSLATION_PROVIDER`
- `MENU_TRANSLATION_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_API_URL`
- `OPENAI_MODEL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_API_URL`
- `DEEPSEEK_MODEL`
- `BAILIAN_API_KEY`
- `DASHSCOPE_API_KEY`
- `ALIBABA_API_KEY`
- `BAILIAN_BASE_URL`
- `DASHSCOPE_BASE_URL`
- `BAILIAN_MODEL`

Failure fallback:

- Preferred configured provider is used when valid.
- Without preferred provider, DeepSeek is preferred when present, otherwise the
  first configured provider.
- Missing configuration throws a clear setup error.

User impact risk:

- Medium.
- Bad migration can generate broken language packs or invalid placeholders.

Recommended migration:

- Keep provider-specific JSON repair and placeholder validation outside Model
  Router.
- Route only the raw chat completion call through Model Router after Prompt
  Center exists.

### Vision Router

Current call chain:

```text
Legacy callers
  -> src/lib/ai/vision/router.ts
  -> Model Router adapter
  -> local / Qwen / OpenAI vision provider
```

Env dependencies:

- `IMAGE_INDEX_VISION_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_API_URL`
- `OPENAI_VISION_MODEL`
- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `DASHSCOPE_VISION_MODEL`

Failure fallback:

- `mode: "basic"` returns metadata-only local analysis.
- `mode: "vision"` prefers configured Qwen/OpenAI route.
- `mode: "reasoning"` prefers OpenAI, then Qwen.

User impact risk:

- Medium.
- This is already adapted, so the main risk is response metadata leakage or
  changed provider order.

Recommended migration:

- Keep old exported functions stable.
- Keep public `VisionAnalysis` output without router metadata.
- Use debug function only where raw response was already expected.

### Geocoding And Place Service

Current call chain:

```text
/api/geocode
  -> Nominatim
  -> Photon

/api/locations/resolve
  -> place cache
  -> Google Places / Google Geocoding / Mapbox / Nominatim
  -> optional LLM query normalization
```

Env dependencies:

- `GEOCODING_USER_AGENT`
- `ENABLE_GOOGLE_PLACES`
- `ENABLE_GOOGLE_GEOCODING`
- `GOOGLE_MAPS_API_KEY`
- `ENABLE_MAPBOX_GEOCODING`
- `MAPBOX_ACCESS_TOKEN`
- `ENABLE_NOMINATIM`
- `ENABLE_LLM_LOCATION_NORMALIZATION`
- `OPENAI_API_KEY`
- `LOCATION_NORMALIZATION_MODEL`

Failure fallback:

- Provider functions return null on unavailable provider or failed fetch.
- Service moves to the next configured provider.
- LLM normalization is disabled by default.

User impact risk:

- Medium.
- Geocoding is not a general AI capability except optional normalization.
- Provider order and null fallback are important.

Recommended migration:

- Do not move ordinary geocoding into Model Router.
- Only optional LLM query normalization should later route through Model Router.
- Keep geocoder provider order unchanged.

### Google Drive Upload

Current call chain:

```text
/api/google-drive/upload-photo
  -> Supabase auth and storage connection
  -> decrypt token
  -> refresh Google token if needed
  -> ensure Journey/media folders
  -> upload original/thumbnail
  -> media asset records and variants
```

Env dependencies:

- `GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- Google token encryption configuration used by `google-token`.

Failure fallback:

- Missing connection or folder returns existing upload error.
- Token refresh path handles expired access tokens.
- Media variant generation remains outside AI routing.

User impact risk:

- High.
- Upload is core Capture infrastructure and must not depend on JIE.

Recommended migration:

- Do not migrate to Model Router.
- Later JIE renderer artifacts may reuse Google Drive helpers, but photo upload
  must stay independent.

## Required Pre-Migration Review

Before migrating any call to Model Router or AI Job Queue, answer:

- What exact API shape must remain unchanged?
- What env variables must continue to work?
- What is the current fallback order?
- What user-facing errors can appear today?
- Does the route currently write database records during partial failure?
- Can the new adapter be bypassed with an env flag?
- Does the route still work if `ai_jobs` tables are absent?
- Which smoke tests from this document must pass?

## Phase Gate Before Prompt Center

Do not start Phase 3 Prompt Center until:

- This checklist is reviewed and accepted.
- Current Model Router adapter behavior is verified for legacy vision calls.
- At least one manual smoke run is recorded for Capture, itinerary image import,
  photo indexing, translation, geocoding, and Google Drive upload.
- Existing full-project lint failures are either fixed or documented as
  pre-existing build hygiene debt.
- No additional business call chains have been migrated without a risk review.

