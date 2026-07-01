# Poster Design System v1

## Purpose

Poster Design System v1 defines how OTR renders Journey Stories into poster artifacts.

The poster renderer must not behave like an open-ended layout generator. It consumes:

1. A Story Script: the narrative content generated from Journey data.
2. A Design Decision: a deterministic layout and asset selection plan.
3. Real Journey assets: user photos, route data, memories, planner items, people, and locations.

The renderer then produces a poster artifact using a known layout contract. This keeps output quality predictable, reviewable, and safe to evolve.

## Product Principle

User-visible output is a Story poster, not a debug summary and not a fake illustration.

Rules:

- Do not call an image generation model.
- Do not generate fake travel photos.
- Do not invent places, people, scenes, routes, or expenses.
- Use only user-owned Journey photos and existing Journey data.
- If no suitable image exists, use a text-first fallback layout.
- Pages should load preview or thumbnail assets, not Google Drive originals.

## Inputs

### Story Script

Story Script is the narrative source shared by Poster and Motion Story artifacts.

Expected fields:

```ts
type StoryScript = {
  title: string;
  subtitle: string;
  language: string;
  tone: string;
  dateRange: {
    start: string;
    end: string;
  };
  chapters: Array<{
    title?: string;
    text: string;
    assetRefs?: string[];
  }>;
  ending?: string;
  assetRefs: string[];
  durationSec?: number;
};
```

### Design Decision

Design Decision is the renderer-facing contract. It decides which layout to use, which real asset becomes the visual anchor, and what content is safe to render.

```ts
type PosterDesignDecision = {
  layoutKey:
    | "cinematic_full_bleed"
    | "hero_top_story_bottom"
    | "magazine_white_space"
    | "collage_memory_board"
    | "route_story_card";
  theme: {
    palette: "warm" | "cool" | "neutral" | "high_contrast";
    typography: "editorial" | "clean" | "soft";
    mood: string[];
  };
  heroAssetId: string | null;
  supportAssetIds: string[];
  title: string;
  subtitle: string;
  storyBeats: string[];
  safetyFlags: {
    hasSensitiveExpense: boolean;
    hasPrivateLocation: boolean;
    hasWeakPhotoQuality: boolean;
    hasMissingHeroAsset: boolean;
    textOnlyFallback: boolean;
  };
};
```

## Built-In Layouts

### cinematic_full_bleed

Best for high-quality landscape or atmosphere photos.

Structure:

- Full-bleed vertical photo.
- Gradient overlay for readability.
- Large title over the image.
- Date/location subtitle under title.
- 2-4 story beats in the lower third.
- OTR branding at the bottom.

Use when:

- A clear scenic image exists.
- The photo has enough contrast or can tolerate overlay.
- The story benefits from emotion and place.

### hero_top_story_bottom

Best for normal usable photos where full-bleed would reduce readability.

Structure:

- Hero image in the top 45-55%.
- Story panel in the lower half.
- Title can overlay the image or sit at the panel boundary.
- Story beats are short and readable.
- OTR branding in the panel footer.

Use when:

- A real photo exists but is visually busy.
- The story needs more text support.
- The image is useful but not strong enough for full-bleed.

### magazine_white_space

Best for weaker photos, sparse content, or a quieter editorial style.

Structure:

- Off-white background.
- One restrained photo card or no image.
- Strong title hierarchy.
- Generous margins.
- Short narrative blocks.

Use when:

- Photos are low contrast, blurry, repetitive, or unavailable.
- Text carries the story better than the image.
- The output should feel calm and collectible.

### collage_memory_board

Best for people/group-heavy days.

Structure:

- 3-6 real photos arranged as a memory board.
- Main title and subtitle layered around the collage.
- Small captions or story beats.
- Warm, social tone.

Use when:

- Multiple people photos are available.
- No single image dominates.
- The story is about shared moments more than location.

### route_story_card

Best for movement-heavy days.

Structure:

- Route/map-derived visual area if route data exists.
- Optional supporting photo strip.
- Story beats arranged as stops or stages.
- Title emphasizes movement, direction, or arrival.

Use when:

- Route or location sequence data is available.
- Planner items or captured locations show a clear path.
- The story is about the day’s movement rather than one scene.

## Layout Selection Rules

The first version should use deterministic rules. LLMs may provide Story Script text, but layout selection should remain inspectable.

Recommended priority:

1. If there is a high-quality landscape or place photo, choose `cinematic_full_bleed`.
2. If there are multiple people/group photos, choose `collage_memory_board`.
3. If route data or a strong location sequence exists, choose `route_story_card`.
4. If photos exist but quality is average, choose `magazine_white_space`.
5. If a single usable photo exists and text needs support, choose `hero_top_story_bottom`.
6. If no usable photo exists, choose `magazine_white_space` with `textOnlyFallback = true`.

Photo quality signals can include:

- Image dimensions.
- Blur or sharpness score, if available.
- Scene tags.
- Face/group detection metadata, if available.
- Whether the URL can be rendered by the server.
- Whether the image is duplicated or extremely dark.

## Renderer Contract

The renderer receives a Story Script and a Design Decision.

It must:

- Render only the selected `layoutKey`.
- Use `heroAssetId` only if the asset exists and is renderable.
- Use `supportAssetIds` only as optional supporting visuals.
- Respect `safetyFlags`.
- Fall back to a safe text-first layout if required assets fail to load.
- Never fetch or display Google Drive original images directly on public or in-app story pages.

The renderer must not:

- Pick arbitrary layouts at render time without a Design Decision.
- Invent photos.
- Generate AI images.
- Put sensitive ledger amounts on shareable posters.
- Expose private debug metadata in the visual artifact.

## Storage

Poster artifact storage follows the existing artifact strategy:

- Original: Google Drive first, fallback to private Supabase original storage.
- Preview: media server first, fallback Supabase.
- Thumbnail: media server first, fallback Supabase.

Stories, Highlights, Feed, and future Discover should read `preview_url` or `thumbnail_url`.

High-resolution original assets are for download/share flows only and should not be loaded directly in the browsing UI.

## Future Implementation Plan

Phase 1:

- Add Design Decision generation service.
- Store design decision in poster artifact metadata or manifest.
- Keep Daily Best Moments using only real Journey photos.

Phase 2:

- Implement the five layout renderers behind `layoutKey`.
- Keep existing render storage router unchanged.
- Continue dual-writing legacy `memory_shots.preview_url` fields until migration is complete.

Phase 3:

- Add photo quality scoring.
- Add people/group and route-aware selection.
- Add safety review around private locations and sensitive expenses.

Phase 4:

- Move poster rendering fully to artifact-first reads.
- Let Stories page prefer poster artifacts over legacy memory_shots render fields.

## Current Non-Goals

- No image generation model.
- No fake scenic backgrounds.
- No AI video generation.
- No complex template marketplace.
- No Discover distribution changes.
- No new Story templates.
- No migration away from existing Memory Shot fields in this phase.
