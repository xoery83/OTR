# Journey Capture Engine Design V2

## Highest Principle

Journey is not a travel planner. Journey is an Event Operating System for travel.

Capture is the heart of Journey. Planner, Ledger, Memories, Photos, Hotels,
Reviews, Daily Summary, Travel Story, and future modules are outputs generated
from captured real-world events.

Users should not need to decide whether they are creating a planner item,
memory, expense, hotel reservation, restaurant review, or daily summary. They
describe what happened. Journey turns that event into structured travel data.

Capture first. Structure later.

## Core Architecture

Every Capture creates exactly one raw event.

```text
Capture
  -> Raw Event
  -> Intent Engine
  -> Structured Actions
  -> Journey Modules
```

Every Journey module should be derivable from raw events. A single capture may
generate multiple structured actions, and new product features should usually be
added by introducing a new action handler rather than by adding a new primary
input workflow.

## Supported Capture Inputs

Capture supports:

- Voice recordings
- Typed text
- Photos
- Videos
- Existing photos
- Existing videos
- Attachments

All input types enter the same processing pipeline.

## Automatic Context

Every capture automatically includes context when available:

- Journey
- Current day
- Current time
- GPS
- Timezone
- Current participants
- Nearby POI
- Current accommodation
- Current vehicle, future
- Weather, future

Users should not need to enter this context manually.

## Capture Pipeline

```text
User Capture
  -> Extract Metadata
  -> Local Processing
  -> Intent Classification
  -> Confidence Score
  -> Need LLM?
      -> Yes: LLM Escalation
      -> No: Generate Actions
  -> Save Event
  -> Execute Actions
  -> Timeline
```

## AI Cost Principle

LLM must never be called by default.

Journey should always try to solve a capture locally first. Escalation order:

1. Rule engine
2. Local NLP
3. Local vision
4. LLM, only when necessary

LLM is reserved for reasoning, summarization, recommendations, semantic
ambiguity, conflict resolution, and multi-intent captures that cannot be handled
confidently by local processing.

## Local Processing

### Voice

Voice captures flow through speech-to-text, then the same intent pipeline as
typed text.

```text
Voice
  -> Speech-to-Text, Whisper or equivalent
  -> Intent Classification
  -> Entity Extraction
  -> Actions
```

### Photos

Photo captures should extract local signals before considering LLM:

- EXIF
- GPS
- Timestamp
- Camera
- Face detection
- Face embedding
- OCR
- Blur detection
- Duplicate detection

These operations should not require LLM.

### Videos

Video captures should extract:

- Duration
- Thumbnail
- GPS
- Timestamp

Future work:

- Scene detection

## When LLM Is Not Required

These examples should usually complete without LLM:

- "Tomorrow leave at 8." -> planner update
- "Fuel 100 DKK, Leon paid." -> expense
- "This hotel is excellent." -> hotel review
- Upload photos -> face index, GPS, timeline
- Restaurant photo -> OCR menu, restaurant attachment
- Parking sign -> OCR, parking information

## When LLM Is Required

Use LLM when local processing cannot reach sufficient confidence:

- Multiple intentions: "Filled petrol, I paid, coffee was amazing, tomorrow
  let's leave later."
- Ambiguous language: "This place wasn't worth coming."
- Travel summary: "Summarize today."
- Travel diary: "Write today's story."
- Recommendations: "What should we do tomorrow?"
- Conflict resolution: "We changed the hotel because of the weather."

## Confidence Policy

- Confidence above 95%: automatically execute.
- Confidence 70-95%: show a confirmation card.
- Confidence below 70%: ask follow-up questions.

## Multiple Actions

One capture can generate multiple outputs. It must never be restricted to one
destination.

Example:

```text
"Fuel 100 DKK. Leon paid. Coffee was great."
  -> Expense
  -> Payment
  -> Memory
  -> Restaurant Review
  -> Timeline
```

## Event Database

Each raw event stores:

- Original input
- Input type
- Timestamp
- GPS
- Metadata
- Intent
- Confidence
- Generated actions
- Referenced photos
- Referenced videos
- Referenced expenses
- Referenced planner items

This allows Journey to replay, audit, or regenerate structured data in the
future.

## AI Layers

Layer 1: Speech-to-text

- Whisper or equivalent

Layer 2: Vision

- Face detection
- OCR
- Image classification
- EXIF

Layer 3: Intent engine

- Rule engine
- Local NLP
- Entity extraction

Layer 4: Action generator

- Convert intent into Journey operations

Layer 5: LLM escalation

- Reasoning
- Summarization
- Recommendations
- Ambiguity

## Future Vision

Capture becomes the only entry point of Journey.

Planner, Ledger, Memories, Photos, Hotels, Reviews, Daily Summary, Travel Story,
AI Assistant, and future modules such as visa, shopping, equipment, insurance,
AI video, and photo highlights become outputs generated from Capture.

The user interacts with Journey through natural language and media instead of
manually editing structured forms. Journey transforms real-world experiences
into structured travel knowledge with the lowest possible AI cost.

