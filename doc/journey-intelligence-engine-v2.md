# Journey Intelligence Engine Design V2

## Highest Principle

Journey Intelligence Engine, or JIE, is the unified AI OS for OTR v2.

JIE is not a single feature, a Highlights generator, or a page-specific AI
integration. It is the shared platform layer that powers every current and
future AI capability in OTR: photo indexing, people understanding, translation,
capture escalation, parser upgrades, Memory Shots, Daily Reports, Journey
Stories, Discover distribution, and future video or book generation.

All AI work in OTR must move toward this rule:

```text
No product surface calls an AI provider directly.
All AI work goes through AI Job Queue -> Model Router -> Prompt Center.
```

The product name for this capability is Journey Intelligence Engine. The
internal implementation may use AI Platform naming where useful, but product and
architecture documents should prefer JIE.

## Relationship To Capture Engine V2

Journey Capture Engine V2 remains the primary input architecture. It is defined
in `doc/journey-capture-engine-v2.md`.

Capture is responsible for understanding what the user just gave OTR:

- voice
- typed text
- photos
- videos
- attachments
- GPS and trip context
- local metadata
- intent classification
- structured actions

JIE is responsible for understanding and producing value from the full Journey
over time:

- continuous journey intelligence
- media and people indexing
- language translation
- daily and trip-level summaries
- recommendations
- story generation
- Memory Shot generation
- rendering
- public sharing and Discover distribution
- cost, routing, prompt, and provider governance

The boundary is:

```text
Capture Engine
  -> understands one capture
  -> creates one raw event
  -> generates structured actions
  -> updates Journey source data

Journey Intelligence Engine
  -> reads Journey source data
  -> enriches, indexes, recommends, generates, renders, and distributes
  -> never becomes the source of truth for the Journey
```

Capture first. Structure later. Intelligence continuously.

## Source Of Truth

AI does not own Journey data.

Journey data remains the source of truth:

- raw capture events
- planner items
- ledger entries
- memory entries
- media assets
- people
- places
- chat
- GPS and map data
- ratings and engagement

JIE may create derived artifacts, indexes, summaries, recommendations, and
rendered outputs. Those outputs must be traceable to source Journey data and
should store snapshots when stability matters.

## Overall Architecture

```text
Capture
Planner
Timeline
Map
Ledger
People
Media
Chat
GPS
Ratings

  -> Journey Source Of Truth

  -> Journey Intelligence Layer

  -> AI Job Queue

  -> Worker System
       Photo Index Worker
       Face Worker
       Location Worker
       Ledger Worker
       Translation Worker
       Summary Worker
       Recommendation Worker
       Story Worker
       Renderer Worker
       Discover Safety Worker

  -> Model Router

  -> Prompt Center

  -> AI Providers / Local Services

  -> Generated Artifacts
       Memory Shots
       Daily Reports
       Journey Stories
       Travel Guides
       Public Discover Shots
       PDFs
       Posters
       Long Images
       Future Video

  -> Storage / Delivery
       Supabase
       Google Drive
       Public Links
       Discover Feed
```

## Required AI Request Flow

Every AI request must move toward this flow:

```text
Frontend or Server Action
  -> create AI job
  -> enqueue work
  -> worker claims job
  -> worker gathers Journey source data
  -> worker selects prompt template
  -> Model Router selects provider and model
  -> provider executes request
  -> usage and cost are recorded
  -> result is persisted
  -> frontend is notified through existing app state
```

Business code should not instantiate provider clients directly. Existing direct
provider calls can remain until migrated, but new work should use JIE by
default.

## Core Infrastructure

### AI Job Queue

The AI Job Queue is the audit and execution layer for all AI work.

It records:

- worker
- task
- journey
- user
- status
- provider
- model
- prompt version
- input tokens
- output tokens
- estimated cost
- started time
- finished time
- retry count
- error
- result metadata

The existing `background_jobs` system can be reused as the first queue
implementation, then expanded with AI-specific metadata.

### Worker System

Each AI capability should be implemented as a worker, not as page-specific
logic.

Initial workers:

- Photo Index Worker
- Face Worker
- Translation Worker
- Summary Worker
- Recommendation Worker
- Story Worker
- Renderer Worker
- Discover Safety Worker

Workers own task-specific orchestration, but they do not choose providers
directly. Provider and model selection belongs to the Model Router.

### Model Router

The Model Router decides which provider and model should handle a task.

It must support:

- provider enablement
- model enablement
- task-based routing
- fallback chains
- budget controls
- rate limits
- local-first routing
- error classification
- usage reporting

Example routes:

```text
photo_index:
  primary: qwen_vl_local
  fallback: openai_vision

translation:
  primary: deepseek
  fallback: openai_mini

story_generation:
  primary: premium_story_model
  fallback: low_cost_story_model
```

### Prompt Center

Prompts must be centrally managed and versioned.

Prompt Center stores:

- template key
- task
- worker
- language
- version
- status
- prompt body
- output schema
- metadata

Workers request prompt templates by key and version policy. Generated artifacts
must record the prompt version used so outputs can be audited or regenerated.

### AI Providers And Models

Providers and models should be configurable, not hard-coded into product
surfaces.

Provider examples:

- OpenAI
- DeepSeek
- Qwen local
- Qwen cloud
- Alibaba
- Claude
- Gemini
- Face service
- OCR service

Model examples:

- chat models
- reasoning models
- vision models
- OCR models
- embedding models
- local metadata-only models

## Cost And Escalation Policy

JIE inherits the Capture Engine cost principle:

LLM must never be called by default.

Escalation levels:

1. Level 0: deterministic program logic, statistics, dates, GPS, amounts,
   ratings, and joins.
2. Level 1: local AI and local services such as OCR, face detection, embeddings,
   CLIP, EXIF, blur, duplicate, and location checks.
3. Level 2: low-cost cloud models for translation, classification, extraction,
   and light drafting.
4. Level 3: premium models for high-value generation, reasoning, ambiguity,
   recommendations, and polished story output.

Workers should gather local and structured signals before requesting generative
model output.

## Generated Outputs

JIE produces outputs from Journey data. The first product outputs are Memory
Shots, Daily Reports, and Discover.

### Memory Shots

Memory Shots are AI artifacts, not raw memories.

A Memory Shot is a generated, shareable object created from Journey source data.
It may include text, photos, people, maps, expenses, planner context, ratings,
and rendered media.

Memory Shots should store a snapshot of the source IDs used during generation:

- photo IDs
- memory IDs
- chat IDs
- expense IDs
- planner IDs
- people IDs
- GPS or place IDs
- prompt version
- template version

The snapshot allows a Memory Shot to remain stable even as the Journey changes.

Initial templates:

- Daily Best Moments
- Today Spending
- People Together

Future templates:

- Magazine
- Instagram Story
- Map Story
- Food Story
- Family Album
- Movie Poster
- Travel Book
- Annual Album

### Daily Report

Daily Report is a JIE-generated summary of a Journey day.

It should read from:

- capture events
- memories
- media
- planner items
- ledger entries
- people and locations
- ratings and engagement

Daily Report may create one or more Memory Shots, but it is not limited to the
Memory Shot format. It can also serve the Daily page, notifications, or later
trip recap generation.

### Discover

Discover is the public distribution layer for user-authorized Memory Shots.

Discover does not create content on its own. It only displays Memory Shots that
the user explicitly chooses to make public.

```text
Journey Memory Shot
  -> user chooses public sharing
  -> privacy and safety check
  -> public review state
  -> Discover feed
```

Memory Shot visibility must support:

- `private`: only the author can view.
- `journey_members`: Journey members can view.
- `public_unlisted`: anyone with the link can view, but the item is not shown
  in Discover.
- `public_discover`: public and eligible for Discover.

Default visibility must not be public. The default should be
`journey_members` unless a more restrictive product choice is made later.

Submitting to Discover requires explicit user authorization and clear privacy
copy. Users must understand that public Discover content may be visible to
everyone and should only include people, places, and details they are allowed to
share.

Before publishing to Discover, JIE should check for:

- minors
- faces
- hotel addresses
- flight numbers
- passports, tickets, receipts, or license plates
- precise home addresses
- sensitive chat content
- detailed expense data
- private member names

Public outputs should hide or reduce precision for:

- exact timestamps
- hotel addresses
- full spending details
- personal contact information
- raw chat text
- private member names

Discover Phase 1 should support:

- Featured
- Latest
- Destination
- Popular
- public Memory Shot cards
- public links
- view count
- like
- save
- share
- report
- admin hide or remove
- "Generated with OTR"
- "Create your own travel memory" call to action

Comments, follows, private messaging, and complex recommendation algorithms are
out of scope for Phase 1.

## Renderer

Renderer Worker does not call AI.

It receives a generated content payload and template selection, then produces
rendered artifacts:

- HTML preview
- PNG
- PDF
- poster
- long image

Renderer may use:

- HTML
- CSS
- template assets
- Playwright
- Google Drive storage
- Supabase preview records

Separating rendering from generation keeps visual output deterministic and
regenerable.

## Recommendation System

The Recommendation Worker continuously analyzes Journey data and suggests
valuable outputs.

Examples:

- generate today's Daily Best Moments
- create a People Together shot
- create a food-focused Memory Shot
- summarize today's spending
- regenerate a shot after new photos are added
- suggest Discover sharing for strong public-safe content

Recommendations should be stored separately from generated artifacts so the user
can accept, ignore, or dismiss them.

## Admin Console

JIE needs operational visibility.

Admin should eventually include:

- Dashboard
- AI Providers
- AI Models
- Routing Rules
- Workers
- Jobs
- Prompts
- Feature Flags
- Cost Analysis
- Queue Monitor
- Retry Failed Jobs
- System Health
- Discover moderation

The first admin version can be basic, but it must expose enough data to debug
failed jobs, provider errors, prompt versions, and cost.

## Privacy And Safety

JIE must be conservative with public output.

Rules:

- Journey data is private by default.
- Memory Shots are not public by default.
- Discover requires explicit user action.
- Public output should reduce precision for sensitive data.
- Safety checks should run before public Discover publishing.
- Users must be able to remove public content.
- Admins must be able to hide or remove unsafe public content.

## Implementation Roadmap

### Phase 0: Architecture Document

Create this document and establish JIE as the OTR v2 unified AI OS.

No business code, migrations, or UI changes.

### Phase 1: AI Job Queue Standardization

Extend the existing background job foundation into the AI Job Queue.

Deliverables:

- common AI job metadata
- job status lifecycle
- worker naming
- retry policy
- job result conventions
- usage and cost fields
- debug-friendly job records

### Phase 2: Model Router

Create the first general Model Router.

Deliverables:

- provider interface
- model interface
- task routing rules
- fallback routing
- usage reporting
- compatibility with existing vision, translation, and capture AI code

### Phase 3: Prompt Center

Centralize prompts.

Deliverables:

- prompt template schema
- prompt versioning
- prompt lookup helpers
- initial prompts for Memory Shots, Daily Report, translation, and Discover
  safety

### Phase 4: Memory Shots Data Model

Add the artifact model.

Deliverables:

- Memory Shot tables
- template tables
- snapshot storage
- visibility model
- generated asset references
- recommendation records

### Phase 5: Memory Shot MVP

Build one complete generation path.

Deliverables:

- Daily Best Moments template
- Memory Shot Worker
- source data collection
- prompt execution through Model Router
- stored snapshot
- basic preview record

Then add:

- Today Spending
- People Together

### Phase 6: Renderer Worker

Separate generation from presentation.

Deliverables:

- HTML preview renderer
- deterministic template input
- PNG or PDF output path
- Google Drive storage integration
- Supabase preview metadata

### Phase 7: Admin Console

Make JIE observable and configurable.

Deliverables:

- job list
- job detail
- retry failed jobs
- provider and model status
- prompt versions
- worker status
- cost summary

### Phase 8: Discover Phase 1

Create public Memory Shot distribution.

Deliverables:

- public visibility flow
- privacy and safety checks
- public Memory Shot records
- Discover feed
- public detail page
- view, like, save, share, report
- admin moderation
- Generated with OTR branding
- Create your own CTA

## Existing Modules To Reuse

The current repository already contains several building blocks that should be
reused rather than replaced:

- `background_jobs`: base queue and activity tracking.
- Capture state machine: local intent and action foundation.
- Capture AI config: early routing and prompt configuration ideas.
- Vision router: early provider abstraction for image analysis.
- Image indexing service: photo understanding foundation.
- Face service: people and face detection foundation.
- Translation modules: content and language-pack translation foundation.
- Google Drive storage integration: artifact and media storage foundation.
- Memories, Ledger, Planner, People, Map, Chat data models: Journey source of
  truth.
- Daily, Highlights, and Discover pages: product surfaces that can later read
  from JIE outputs.

## Existing Modules To Migrate

These areas should migrate toward JIE over later phases:

- direct provider calls in page-specific or route-specific AI code
- image analysis routing that only supports vision-specific providers
- capture escalation prompts that are separate from Prompt Center
- translation jobs that do not record shared AI job cost and routing metadata
- Daily and Highlights placeholder or local-only logic that should read from
  Memory Shots and JIE recommendations
- Discover placeholder page that should become a public Memory Shot feed
- admin configuration that is capture-specific but should become shared JIE
  routing, prompt, and provider governance

