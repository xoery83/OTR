# Story Recommendation Engine V1

This document defines the first design for driving the Story page "Worth Creating" section from JIE recommendations.

Phase 8A is design-first. It does not implement cron, dynamic AI intent, or LLM-based recommendation generation.

## Goal

Story recommendations should suggest what a Journey member can create next.

The first version should:

- Use existing Journey resources only.
- Score deterministic story ideas.
- Write the Top 5 results to `memory_shot_recommendations`.
- Let the Story page read recommendations from that table.
- Start the existing Memory Shot generate flow only after the user clicks Create.

## Product Boundary

User-facing product name:

- Story recommendation
- Worth Creating

Technical storage:

- `memory_shot_recommendations`

Recommendations are not Memory Shots. They are suggested creation intents. A recommendation becomes a Story only after a user explicitly clicks Create and the existing Memory Shot generation chain succeeds.

```text
Journey resources
-> deterministic scoring
-> Top 5 memory_shot_recommendations
-> Story page Worth Creating
-> user clicks Create
-> existing Memory Shot generate flow
```

## Trigger Phases

### Phase 1: Owner/Admin Manual Refresh

Only Journey owner/admin can refresh recommendations manually.

Expected behavior:

- Owner/admin clicks or calls a manual refresh entry.
- Server validates Journey membership and owner/admin role.
- Recommendation engine scans current Journey resources.
- Existing active recommendations for the same Journey may be expired or replaced.
- Top 5 recommendations are inserted into `memory_shot_recommendations`.
- No LLM is called.
- No Story is generated during refresh.

This is the only trigger supported by the first implementation.

### Phase 2: Page Lazy Refresh

Future behavior:

- Story page may request a refresh if recommendations are missing or stale.
- The refresh should still be deterministic and non-LLM by default.
- It should be rate-limited per Journey.
- It should not block page rendering.

Phase 2 should only be added after manual refresh is stable.

### Phase 3: Cron/Scheduled Refresh

Future behavior:

- Scheduled jobs refresh recommendations for active Journeys.
- Refresh frequency should depend on Journey activity.
- Cron should skip inactive or completed Journeys unless explicitly requested.
- Cron should respect cost, rate, and storage limits.

Cron is explicitly out of scope for Phase 8A.

## Non-LLM Rule

Recommendation generation must not call LLMs in V1.

Allowed inputs:

- Planner days and items
- Memories
- Photos and media asset metadata
- People and Journey members
- Places and locations
- Ledger entries and balances
- Existing rating, like, favorite, comment, and contribution counts
- Existing Memory Shot and artifact status

Disallowed in V1:

- LLM summarization
- LLM dynamic intent generation
- Prompt Center rendering
- Model Router calls
- AI Job Queue jobs for recommendation scoring

LLM generation starts only after the user clicks Create on a recommendation that maps to an existing supported template.

## Scoring Model

V1 scoring should be deterministic and explainable.

Each candidate recommendation should include:

- `recommendation_key`
- `title`
- `reason`
- `score`
- `payload`
- `metadata`

Suggested scoring dimensions:

- Freshness: recent activity in the Journey.
- Density: enough memories/photos/planner items exist for a story.
- Diversity: multiple content types are available.
- Social signal: multiple members contributed or appear together.
- Novelty: the same recommendation was not recently accepted.
- Renderability: the current template can produce a useful Story with available inputs.

The score should be normalized to `0.0000` through `1.0000`.

## Candidate Types

Phase 8A should design for multiple candidates but only needs to support templates that already have a generation path.

Initial active candidate:

- `memory_shot_daily_best_moments`

Future deterministic candidates:

- Best photos of the day
- People together
- Route recap
- Food and spending story
- Most memorable place
- Group contribution recap
- Ledger highlight

Future candidates may use leaderboard data as scoring signals, but the traditional leaderboard UI remains hidden on the Story page.

## Output Contract

Write at most Top 5 active recommendations to `memory_shot_recommendations`.

Recommended row mapping:

- `journey_id`: current Journey id
- `user_id`: optional target user, or null for Journey-level recommendation
- `template_id`: optional matching Memory Shot template id
- `recommendation_key`: stable deterministic key
- `title`: user-facing title
- `reason`: short user-facing reason
- `score`: normalized score
- `status`: `active`
- `payload`: create-time parameters and candidate inputs
- `metadata`: scoring details, version, and refresh source

Example payload:

```json
{
  "templateKey": "memory_shot_daily_best_moments",
  "date": "2026-07-09",
  "language": "zh-CN",
  "contentTypes": ["photos", "people", "route", "ledger"]
}
```

Example metadata:

```json
{
  "engine": "story_recommendation_engine_v1",
  "refreshMode": "manual_owner_admin",
  "scoring": {
    "freshness": 0.9,
    "density": 0.8,
    "diversity": 0.7,
    "social": 0.5,
    "novelty": 1,
    "renderability": 1
  },
  "sourceCounts": {
    "photos": 12,
    "memories": 8,
    "plannerItems": 5,
    "ledgerEntries": 3,
    "members": 4
  }
}
```

## Manual Refresh API Design

Phase 8A may reserve this API shape without implementing it:

```http
POST /api/journeys/[journeyId]/story-recommendations/refresh
```

Request:

```json
{
  "mode": "manual",
  "limit": 5
}
```

Response:

```json
{
  "recommendations": [
    {
      "id": "uuid",
      "recommendationKey": "daily-best-moments:2026-07-09",
      "title": "今日最佳瞬间",
      "reason": "今天有照片、地点和账本记录，适合生成一篇回顾故事。",
      "score": 0.86,
      "payload": {
        "templateKey": "memory_shot_daily_best_moments",
        "date": "2026-07-09"
      }
    }
  ]
}
```

Permission:

- Must be authenticated.
- Must be a Journey member.
- Must be Journey owner/admin.

Failure modes:

- `401`: unauthenticated
- `403`: not owner/admin
- `404`: Journey not found
- `422`: no scoreable resources
- `500`: refresh failed

## Create Flow

Clicking Create on a recommendation should not create a custom recommendation-specific worker path.

It should:

1. Read the recommendation payload.
2. Validate that `templateKey` is supported.
3. Call the existing Memory Shot generation API or service.
4. Mark the recommendation as `accepted` only after the generation request is accepted.

The first supported template remains:

- `memory_shot_daily_best_moments`

## Ownership and Permissions

Manual refresh is restricted to Journey owner/admin.

Journey members may read active recommendations according to existing RLS rules. Public read is not enabled.

Future public or Discover recommendations require separate authorization design.

## Refresh Semantics

Recommended V1 behavior:

- Compute all deterministic candidates.
- Sort by score descending.
- Keep only the Top 5.
- Insert new active recommendations.
- Expire previous active recommendations not present in the new Top 5.
- Preserve `accepted` and `dismissed` rows for history.

The refresh should be idempotent for the same Journey state and scoring version.

## Stability Requirements

Manual refresh must not affect existing Journey behavior.

It must not:

- Generate a Memory Shot automatically.
- Call Model Router.
- Call Prompt Center.
- Create AI jobs.
- Modify existing Memory Shots.
- Modify artifacts.
- Trigger renderer worker.
- Change Story page navigation.

Failure to refresh recommendations should only affect the Worth Creating section.

## Current Limitations

- No cron.
- No page lazy refresh.
- No LLM dynamic intent.
- No new story templates.
- No personalization beyond optional `user_id`.
- No Discover integration.
- No public sharing.
- No automatic dismissal or cooldown logic beyond basic status.

## Follow-Up Plan

1. Implement owner/admin manual refresh API.
2. Add deterministic candidate scorer for Daily Best Moments.
3. Render Story page Worth Creating from `memory_shot_recommendations`.
4. Add Create-from-recommendation flow using the existing Memory Shot generate API.
5. Add page lazy refresh once manual refresh is stable.
6. Add scheduled refresh only after scoring, permissions, and stability are proven.
