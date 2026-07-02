#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

function usage() {
  return `
Cover selection smoke test

Usage:
  node scripts/test-cover-selection.mjs --journey-id <journey-id> --date 2026-07-02

Options:
  --max-results 10
  --preferred-layout cinematic_full_bleed
  --story-intent daily_best_moments
  --require-public-safe
  --html /tmp/cover-selection.html
  --token <supabase-access-token>

Env:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY + --token
`.trim();
}

function parseArgs(argv) {
  const args = {
    journeyId: process.env.JOURNEY_ID || "",
    date: process.env.MEMORY_SHOT_DATE || "",
    maxResults: 10,
    preferredLayoutKey: "cinematic_full_bleed",
    storyIntentKey: "daily_best_moments",
    requirePublicSafe: false,
    htmlPath: "",
    token: process.env.OTR_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      args.help = true;
      continue;
    }
    if (key === "--require-public-safe") {
      args.requirePublicSafe = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--")) continue;
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value.`);
    index += 1;

    if (key === "--journey-id" || key === "--journeyId") args.journeyId = value;
    else if (key === "--date") args.date = value;
    else if (key === "--max-results") args.maxResults = Number(value);
    else if (key === "--preferred-layout") args.preferredLayoutKey = value;
    else if (key === "--story-intent") args.storyIntentKey = value;
    else if (key === "--html") args.htmlPath = value;
    else if (key === "--token") args.token = value;
    else throw new Error(`Unknown option: ${key}`);
  }
  return args;
}

function requireArgs(args) {
  const missing = [];
  if (!args.journeyId) missing.push("--journey-id");
  if (!args.date) missing.push("--date");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !args.token) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY or --token");
  }
  if (missing.length > 0) {
    throw new Error(`Missing required input: ${missing.join(", ")}\n\n${usage()}`);
  }
}

function dateKey(value) {
  return value ? String(value).slice(0, 10) : null;
}

function strings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function numberScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function includesAny(value, words) {
  const normalized = String(value || "").toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function scoreText(text, pattern) {
  return [...String(text || "").toLowerCase().matchAll(pattern)].length;
}

function stringHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function continuousNoise(seed, max = 6) {
  if (!seed) return 0;
  return ((stringHash(seed) % 1000) / 1000) * max;
}

function hashJitter(value) {
  return (stringHash(value) % 401) / 100;
}

function aspectRatio(photo) {
  return photo.width && photo.height ? photo.width / photo.height : null;
}

function resolutionMegapixels(photo) {
  return photo.width && photo.height ? (photo.width * photo.height) / 1_000_000 : null;
}

function inferOrientation(photo) {
  if (!photo.width || !photo.height) return "square";
  if (Math.abs(photo.width - photo.height) / Math.max(photo.width, photo.height) < 0.08) {
    return "square";
  }
  return photo.height > photo.width ? "portrait" : "landscape";
}

function inferSceneType(tags, objects) {
  const text = [...tags, ...objects].join(" ").toLowerCase();
  const scores = {
    document: scoreText(text, /receipt|ticket|passport|document|screen|screenshot|menu|bill|invoice|boarding pass/g),
    landscape: scoreText(text, /mountain|waterfall|lake|river|sea|beach|sky|landscape|nature|canyon|valley|glacier|forest|cliff|sunset|sunrise|vista|scenic/g),
    cityscape: scoreText(text, /skyline|cityscape|harbor|harbour|downtown|city view/g),
    city: scoreText(text, /city|street|building|architecture|town|village/g),
    people: scoreText(text, /person|people|group|selfie|face|portrait/g),
    transport: scoreText(text, /car|bus|train|plane|airport|transport|road|vehicle|flight/g),
    food: scoreText(text, /food|restaurant|dish|meal|drink|coffee|dessert/g),
    hotel: scoreText(text, /hotel|room|bed|lobby|suite|accommodation/g),
  };
  if (scores.document >= 2) return "document";
  if (
    scores.landscape >= 1 &&
    scores.landscape >= Math.max(scores.hotel, scores.transport, scores.people)
  ) {
    return "landscape";
  }
  if (scores.cityscape >= 1) return "cityscape";
  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] || "unknown";
}

function localContentSignal(photo, index) {
  const text = [
    ...strings(photo.scene_tags),
    ...strings(index.content?.objects),
    index.caption || "",
    photo.id,
  ].join(" ").toLowerCase();
  const scenic = scoreText(text, /mountain|waterfall|lake|river|sky|sunset|sunrise|beach|glacier|canyon|valley|scenic|landscape|view|nature/g);
  const personal = scoreText(text, /friend|group|family|people|smile|selfie|portrait/g);
  const privateish = scoreText(text, /receipt|passport|ticket|screen|document|bill|invoice/g);
  return numberScore(
    48 +
      Math.min(24, scenic * 7) +
      Math.min(12, personal * 4) -
      Math.min(34, privateish * 11) +
      continuousNoise(text, 9),
    50,
  );
}

function inferNegativeSpace(photo, index) {
  const provided = index.composition?.negativeSpace || "none";
  if (provided !== "none") return provided;
  const shotType = index.composition?.shotType || "medium";
  if (shotType === "close_up" || shotType === "detail") return "none";
  const text = [...strings(photo.scene_tags), ...strings(index.content?.objects)]
    .join(" ")
    .toLowerCase();
  if (/sky|cloud|sunrise|sunset|mountain|cliff|waterfall/.test(text)) return "top";
  if (/water|lake|river|sea|beach|road|ground|snow|sand/.test(text)) return "bottom";
  const subjectPosition = index.composition?.subjectPosition;
  if (subjectPosition === "left") return "right";
  if (subjectPosition === "right") return "left";
  if (
    index.composition?.orientation === "landscape" &&
    ["landscape", "nature", "cityscape"].includes(index.content?.sceneType)
  ) {
    return "top";
  }
  return "none";
}

function inferDesignMetadata(photo, index) {
  const existing = index.designMetadata || {};
  const sceneType = index.content?.sceneType || "unknown";
  const isDocument = ["document", "screenshot"].includes(sceneType);
  const isLandscape = [
    "landscape",
    "city",
    "cityscape",
    "nature",
    "water",
    "architecture",
  ].includes(sceneType);
  const isGroup = Boolean(index.people?.isGroupPhoto);
  const orientation = index.composition?.orientation || inferOrientation(photo);
  const negativeSpace = inferNegativeSpace(photo, index);
  index.composition = {
    ...index.composition,
    negativeSpace,
  };
  const contentSignal = localContentSignal(photo, index);
  const seed = [
    photo.id,
    sceneType,
    orientation,
    index.composition?.shotType || "",
    negativeSpace,
    strings(photo.scene_tags).join("|"),
    strings(index.content?.objects).join("|"),
  ].join("|");
  const variance = continuousNoise(seed, 11) - 5.5;
  const clutterLevel =
    index.composition?.clutterLevel === "low"
      ? 24
      : index.composition?.clutterLevel === "high"
        ? 78
        : 52;
  const privacyRisk = index.safety?.isSensitive ? 84 : isDocument ? 68 : 12;
  const fallbackUseCases = isDocument
    ? ["not_recommended", "thumbnail"]
    : isGroup
      ? ["collage", "hero_top", "thumbnail"]
      : isLandscape
        ? ["full_bleed", "hero_top", "thumbnail"]
        : sceneType === "route"
          ? ["route", "hero_top"]
          : ["magazine", "hero_top", "thumbnail"];
  return {
    compositionType: existing.compositionType || `${orientation} ${sceneType}`,
    shotDistance: existing.shotDistance || index.composition?.shotType || "medium",
    primarySubjectType: existing.primarySubjectType || (isGroup ? "people" : sceneType),
    subjectStrength: numberScore(
      existing.subjectStrength,
      (isLandscape ? 72 : isGroup ? 76 : isDocument ? 42 : sceneType === "food" ? 64 : 54) +
        variance +
        (contentSignal - 50) * 0.08,
    ),
    travelAtmosphere: numberScore(
      existing.travelAtmosphere,
      (isLandscape ? 82 : sceneType === "transport" ? 72 : isDocument ? 18 : 48) +
        variance +
        (contentSignal - 50) * 0.16,
    ),
    typographySpace: numberScore(
      existing.typographySpace,
      negativeSpace !== "none"
        ? 62 + continuousNoise(`${seed}:space`, 18)
        : orientation === "portrait" && isLandscape
          ? 48 + continuousNoise(`${seed}:portrait-space`, 15)
          : 28 + continuousNoise(`${seed}:none-space`, 18),
    ),
    typographySpacePosition: existing.typographySpacePosition || negativeSpace,
    clutterLevel: numberScore(existing.clutterLevel, clutterLevel),
    lightingMood: existing.lightingMood || "mixed",
    colorMood: existing.colorMood || "neutral",
    emotionalTone: existing.emotionalTone || (isLandscape ? "adventure" : isGroup ? "family" : "documentary"),
    storyPotential: numberScore(
      existing.storyPotential,
      (isLandscape || sceneType === "people" || sceneType === "transport"
        ? 72
        : isDocument
          ? 22
          : 50) +
        variance +
        (contentSignal - 50) * 0.12,
    ),
    privacyRisk: numberScore(existing.privacyRisk, privacyRisk),
    publicShareRisk: numberScore(existing.publicShareRisk, Math.max(privacyRisk, index.safety?.isSensitive ? 76 : 16)),
    cropFlexibility: numberScore(
      existing.cropFlexibility,
      orientation === "portrait"
        ? 72 + continuousNoise(`${seed}:portrait-crop`, 12)
        : orientation === "landscape"
          ? 48 + continuousNoise(`${seed}:landscape-crop`, 15)
          : 58 + continuousNoise(`${seed}:square-crop`, 10),
    ),
    posterUseCases: strings(existing.posterUseCases).length > 0 ? strings(existing.posterUseCases) : fallbackUseCases,
    reasons: existing.reasons || {
      subjectStrength: `Inferred from ${sceneType}.`,
      travelAtmosphere: `Inferred from scene type ${sceneType}.`,
      typographySpace: `Inferred from negativeSpace ${negativeSpace}.`,
      clutterLevel: `Mapped from V1 clutter.`,
      storyPotential: `Inferred from scene type ${sceneType}.`,
      privacyRisk: index.safety?.isSensitive ? "Sensitive image." : "No obvious sensitive signal.",
      cropFlexibility: `Inferred from orientation ${orientation}.`,
    },
  };
}

function visualQuality(index) {
  const technical = index.technicalMetadata || {};
  const resolutionBonus = technical.resolutionMegapixels
    ? Math.min(8, Math.max(-6, (technical.resolutionMegapixels - 2.4) * 1.2))
    : 0;
  const blurPenalty = technical.blurScore
    ? Math.min(16, Math.max(0, technical.blurScore * 12))
    : 0;
  return numberScore(average([
    numberScore(index.visualQuality?.sharpness, 70),
    numberScore(index.visualQuality?.exposure, 70),
    numberScore(index.visualQuality?.contrast, 65),
    numberScore(index.visualQuality?.colorAppeal, 65),
    numberScore(index.visualQuality?.lightingQuality, 65),
    numberScore(index.visualQuality?.overallAesthetic, 55),
  ]) + resolutionBonus - blurPenalty, 55);
}

function aspectCoverSignal(index) {
  const ratio = index.technicalMetadata?.aspectRatio;
  if (!ratio) return 0;
  return numberScore(
    82 -
      Math.min(42, Math.abs(ratio - 0.75) * 32) -
      Math.min(12, Math.abs(ratio - 1) * 8),
    52,
  );
}

function resolutionSignal(index) {
  const mp = index.technicalMetadata?.resolutionMegapixels;
  if (!mp) return 52;
  if (mp < 0.8) return 28 + mp * 18;
  if (mp < 2.4) return 48 + mp * 10;
  if (mp < 8) return 72 + Math.min(15, (mp - 2.4) * 2.4);
  return 88;
}

function orientationCoverSignal(index) {
  if (index.composition?.orientation === "portrait") return 82;
  if (index.composition?.orientation === "square") return 68;
  return 56;
}

function negativeSpaceSignal(index) {
  const position = index.designMetadata?.typographySpacePosition;
  if (position === "top" || position === "bottom") return 82;
  if (position === "left" || position === "right") return 73;
  if (position === "center") return 58;
  return 34;
}

function computeSuitability(index) {
  const meta = index.designMetadata;
  const scene = index.content?.sceneType || "unknown";
  const privacyPenalty = Math.max(
    meta.privacyRisk * 0.35,
    meta.publicShareRisk * 0.55,
    index.safety?.isSensitive ? 28 : 0,
  );
  const sceneCoverBonus =
    ["landscape", "nature", "water"].includes(scene)
      ? 12
      : ["city", "cityscape", "architecture"].includes(scene)
        ? 8
      : scene === "people" && index.people?.isGroupPhoto
        ? 7
        : ["document", "screenshot"].includes(scene)
          ? -28
          : scene === "food" || scene === "hotel"
            ? -12
            : 0;
  const shotCoverPenalty = includesAny(meta.shotDistance, ["close", "detail", "macro"]) ? -18 : includesAny(meta.shotDistance, ["medium"]) ? -4 : 4;
  const coverScore = numberScore(
    meta.travelAtmosphere * 0.15 +
      meta.typographySpace * 0.16 +
      meta.cropFlexibility * 0.12 +
      (100 - meta.clutterLevel) * 0.11 +
      orientationCoverSignal(index) * 0.08 +
      aspectCoverSignal(index) * 0.08 +
      resolutionSignal(index) * 0.06 +
      negativeSpaceSignal(index) * 0.08 +
      visualQuality(index) * 0.08 +
      (index.technicalMetadata?.contentSignal || 50) * 0.04 +
      meta.storyPotential * 0.04 +
      sceneCoverBonus +
      shotCoverPenalty -
      privacyPenalty -
      (["document", "screenshot"].includes(scene) ? 36 : 0),
    0,
  );
  const subjectHeroBonus =
    index.people?.isGroupPhoto || includesAny(meta.primarySubjectType, ["person", "people", "group", "action"])
      ? 8
      : includesAny(meta.primarySubjectType, ["food", "object", "detail", "ticket", "medal"])
        ? 4
        : 0;
  const heroScore = numberScore(
    meta.subjectStrength * 0.28 +
      meta.storyPotential * 0.22 +
      visualQuality(index) * 0.16 +
      meta.travelAtmosphere * 0.11 +
      (100 - meta.clutterLevel) * 0.08 +
      meta.cropFlexibility * 0.05 +
      resolutionSignal(index) * 0.04 +
      (index.technicalMetadata?.contentSignal || 50) * 0.04 +
      numberScore(index.visualQuality?.lightingQuality, 65) * 0.06 +
      subjectHeroBonus +
      (includesAny(meta.shotDistance, ["close", "detail", "macro"]) ? 7 : 2) -
      Math.max(0, meta.privacyRisk - 65) * 0.25,
    0,
  );
  const backgroundScore = numberScore(
    meta.typographySpace * 0.34 +
      negativeSpaceSignal(index) * 0.14 +
      meta.cropFlexibility * 0.13 +
      (100 - meta.clutterLevel) * 0.16 +
      aspectCoverSignal(index) * 0.08 +
      numberScore(index.visualQuality?.lightingQuality, 65) * 0.1 +
      numberScore(index.visualQuality?.colorAppeal, 65) * 0.08 +
      meta.travelAtmosphere * 0.1 -
      privacyPenalty * 0.55,
    0,
  );
  const collageScore = numberScore(
    meta.subjectStrength * 0.25 +
      meta.storyPotential * 0.2 +
      visualQuality(index) * 0.16 +
      (100 - meta.clutterLevel) * 0.12 +
      meta.cropFlexibility * 0.1 +
      meta.travelAtmosphere * 0.15 +
      resolutionSignal(index) * 0.04 +
      (index.people?.visiblePeopleCount > 0 ? 8 : 0) -
      privacyPenalty * 0.35,
    0,
  );
  const thumbnailScore = numberScore(
    meta.subjectStrength * 0.28 +
      visualQuality(index) * 0.18 +
      numberScore(index.visualQuality?.contrast, 65) * 0.14 +
      numberScore(index.visualQuality?.colorAppeal, 65) * 0.12 +
      (100 - meta.clutterLevel) * 0.14 +
      meta.storyPotential * 0.12 -
      privacyPenalty * 0.45,
    0,
  );
  const supportsLargeTitle =
    meta.typographySpace >= 58 &&
    meta.clutterLevel <= 62 &&
    meta.typographySpacePosition !== "none" &&
    meta.publicShareRisk < 72;
  const suggestedLayouts = [];
  if (meta.posterUseCases.includes("full_bleed") || (coverScore >= 72 && supportsLargeTitle)) {
    suggestedLayouts.push("cinematic_full_bleed");
  }
  if (meta.posterUseCases.includes("collage") || collageScore >= coverScore + 8 || index.people?.isGroupPhoto) {
    suggestedLayouts.push("collage_memory_board");
  }
  if (meta.posterUseCases.includes("route") || scene === "route") suggestedLayouts.push("route_story_card");
  if (meta.posterUseCases.includes("hero_top") || backgroundScore >= 58) suggestedLayouts.push("hero_top_story_bottom");
  if (meta.posterUseCases.includes("magazine") || suggestedLayouts.length === 0) suggestedLayouts.push("magazine_white_space");
  const avoidAsCoverReason =
    meta.posterUseCases.includes("not_recommended")
      ? "Model marked this photo as not recommended for poster use."
      : index.safety?.isSensitive || meta.publicShareRisk >= 70
        ? "High privacy or public sharing risk."
        : ["document", "screenshot"].includes(scene)
          ? "Document or screenshot-like image is not suitable as a public cover."
          : meta.clutterLevel >= 78
            ? "Clutter is too high for a clean cover."
            : meta.typographySpace < 28
              ? "Not enough clean typography space for a title."
              : coverScore < 40
                ? "Low travel atmosphere and visual poster suitability."
                : "";
  const reasonForCoverScore = `travel ${meta.travelAtmosphere}; typeSpace ${meta.typographySpace}@${meta.typographySpacePosition}; crop ${meta.cropFlexibility}; clutter ${meta.clutterLevel}; orientation ${index.composition?.orientation}; aspect ${index.technicalMetadata?.aspectRatio?.toFixed?.(2) || "?"}; mp ${index.technicalMetadata?.resolutionMegapixels?.toFixed?.(1) || "?"}; visual ${Math.round(visualQuality(index))}; risk ${meta.publicShareRisk}${avoidAsCoverReason ? `; avoid: ${avoidAsCoverReason}` : ""}`;
  const reasonForHeroScore = `subjectStrength ${meta.subjectStrength}; storyPotential ${meta.storyPotential}; emotionalTone ${meta.emotionalTone}; visualQuality ${Math.round(visualQuality(index))}`;
  return {
    coverScore,
    heroScore,
    backgroundScore,
    collageScore,
    thumbnailScore,
    supportsLargeTitle,
    suggestedLayouts: [...new Set(suggestedLayouts)],
    avoidAsCoverReason,
    reasonForCoverScore,
    reasonForHeroScore,
  };
}

function fallbackIndex(photo) {
  const metadata = photo.ai_metadata || {};
  const tags = strings(photo.scene_tags);
  const objects = strings(metadata.objects);
  const sceneType = inferSceneType(tags, objects);
  const cover =
    sceneType === "landscape" || sceneType === "city"
      ? 72
      : sceneType === "people"
        ? 62
        : sceneType === "document"
          ? 18
          : 48;
  const baseIndex = {
    version: 2,
    content: {
      sceneType,
      objects,
      locationHints: strings(metadata.locationHints),
      activityHints: strings(metadata.activities),
    },
    composition: {
      orientation: inferOrientation(photo),
      shotType: "medium",
      subjectPosition: "center",
      negativeSpace: "none",
      depth: "layered",
      clutterLevel: "medium",
    },
    visualQuality: {
      sharpness: 70,
      exposure: 70,
      contrast: 65,
      colorAppeal: 65,
      lightingQuality: 65,
      overallAesthetic: cover,
    },
    technicalMetadata: {
      width: photo.width ?? null,
      height: photo.height ?? null,
      aspectRatio: aspectRatio(photo),
      resolutionMegapixels: resolutionMegapixels(photo),
      blurScore: photo.blur_score ?? null,
      contentSignal: 50,
    },
    posterSuitability: {
      coverScore: cover,
      heroScore: cover,
      backgroundScore: cover,
      collageScore: sceneType === "people" ? 72 : 52,
      thumbnailScore: cover,
      supportsLargeTitle: sceneType !== "document",
      suggestedLayouts:
        sceneType === "people"
          ? ["collage_memory_board", "hero_top_story_bottom"]
          : ["cinematic_full_bleed", "hero_top_story_bottom"],
      avoidAsCoverReason: sceneType === "document" ? "Document-like image." : "",
    },
    mood: { primary: "documentary", secondary: [], energy: "medium" },
    people: {
      visiblePeopleCount: 0,
      isGroupPhoto: false,
      isSelfie: false,
      faceVisibility: "none",
    },
    safety: {
      isSensitive: sceneType === "document",
      sensitiveReasons: sceneType === "document" ? ["document"] : [],
      allowPublicPoster: sceneType !== "document",
    },
    caption: typeof metadata.summary === "string" ? metadata.summary : "",
    indexConfidence: typeof metadata.confidence === "number" ? metadata.confidence : 0.45,
  };
  baseIndex.technicalMetadata.contentSignal = localContentSignal(photo, baseIndex);
  baseIndex.designMetadata = inferDesignMetadata(photo, baseIndex);
  const computed = computeSuitability(baseIndex);
  baseIndex.posterSuitability = {
    ...computed,
    computedCoverScore: computed.coverScore,
    computedHeroScore: computed.heroScore,
    computedBackgroundScore: computed.backgroundScore,
    computedCollageScore: computed.collageScore,
    computedThumbnailScore: computed.thumbnailScore,
    rawModelScores: {
      coverScore: cover,
      heroScore: cover,
      backgroundScore: cover,
      collageScore: sceneType === "people" ? 72 : 52,
      thumbnailScore: cover,
    },
  };
  return baseIndex;
}

function photoIndex(photo) {
  const existing =
    photo.ai_metadata?.photoIndexV2 || photo.ai_metadata?.photo_index_v2 || fallbackIndex(photo);
  existing.technicalMetadata = {
    width: photo.width ?? existing.technicalMetadata?.width ?? null,
    height: photo.height ?? existing.technicalMetadata?.height ?? null,
    aspectRatio: aspectRatio(photo) ?? existing.technicalMetadata?.aspectRatio ?? null,
    resolutionMegapixels:
      resolutionMegapixels(photo) ??
      existing.technicalMetadata?.resolutionMegapixels ??
      null,
    blurScore: photo.blur_score ?? existing.technicalMetadata?.blurScore ?? null,
    contentSignal: existing.technicalMetadata?.contentSignal ?? 50,
  };
  existing.technicalMetadata.contentSignal = localContentSignal(photo, existing);
  existing.designMetadata = inferDesignMetadata(photo, existing);
  const rawScores = {
    coverScore: existing.posterSuitability?.coverScore ?? null,
    heroScore: existing.posterSuitability?.heroScore ?? null,
    backgroundScore: existing.posterSuitability?.backgroundScore ?? null,
    collageScore: existing.posterSuitability?.collageScore ?? null,
    thumbnailScore: existing.posterSuitability?.thumbnailScore ?? null,
    ...(existing.posterSuitability?.rawModelScores || {}),
  };
  const computed = computeSuitability(existing);
  existing.posterSuitability = {
    ...computed,
    computedCoverScore: computed.coverScore,
    computedHeroScore: computed.heroScore,
    computedBackgroundScore: computed.backgroundScore,
    computedCollageScore: computed.collageScore,
    computedThumbnailScore: computed.thumbnailScore,
    rawModelScores: rawScores,
  };
  return existing;
}

function scoreCandidate(photo, index, args) {
  let score =
    numberScore(index.posterSuitability?.coverScore, 50) * 0.72 +
    numberScore(index.posterSuitability?.heroScore, 50) * 0.1 +
    numberScore(index.designMetadata?.typographySpace, 50) * 0.07 +
    numberScore(index.designMetadata?.cropFlexibility, 50) * 0.06 +
    (100 - numberScore(index.designMetadata?.publicShareRisk, 20)) * 0.05;
  if (dateKey(photo.taken_at) === args.date || dateKey(photo.created_at) === args.date) {
    score += 5;
  }
  if (
    args.preferredLayoutKey &&
    !strings(index.posterSuitability?.suggestedLayouts).includes(args.preferredLayoutKey)
  ) {
    score -= 8;
  }
  if (args.requirePublicSafe && !index.safety?.allowPublicPoster) score -= 120;
  score += hashJitter(photo.id);
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

function candidateReason(index, score) {
  const parts = [
    `${index.content?.sceneType || "unknown"} photo`,
    `cover ${index.posterSuitability?.coverScore ?? "?"}`,
    `hero ${index.posterSuitability?.heroScore ?? "?"}`,
    `gap ${(index.posterSuitability?.coverScore ?? 0) - (index.posterSuitability?.heroScore ?? 0)}`,
    `aesthetic ${index.visualQuality?.overallAesthetic ?? "?"}`,
    `typography ${index.designMetadata?.typographySpace ?? "?"}`,
    `clutter ${index.designMetadata?.clutterLevel ?? "?"}`,
  ];
  if (index.posterSuitability?.supportsLargeTitle) parts.push("has title space");
  if (index.safety?.isSensitive) {
    parts.push(`sensitive: ${(index.safety.sensitiveReasons || []).join(", ")}`);
  }
  if (index.posterSuitability?.avoidAsCoverReason) {
    parts.push(`avoid: ${index.posterSuitability.avoidAsCoverReason}`);
  }
  parts.push(`final ${score}`);
  return parts.join("; ");
}

function previewUrl(photo) {
  return (
    photo.preview_url ||
    photo.thumbnail_url ||
    photo.provider_thumbnail_url ||
    photo.thumbnail_drive_web_url ||
    ""
  );
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeHtmlGrid(filePath, candidates) {
  const cards = candidates
    .map(({ photo, index, score, reason }, idx) => {
      const url = previewUrl(photo);
      const gap = (index.posterSuitability?.coverScore ?? 0) - (index.posterSuitability?.heroScore ?? 0);
      return `<article><div class="rank">#${idx + 1} · selection ${score}</div>${url ? `<img src="${htmlEscape(url)}" />` : "<div class='missing'>No preview URL</div>"}<h2>${htmlEscape(index.caption || photo.id)}</h2><div class="scores"><b>cover ${index.posterSuitability?.coverScore ?? "?"}</b><b>hero ${index.posterSuitability?.heroScore ?? "?"}</b><b>gap ${gap}</b><b>${htmlEscape(index.posterSuitability?.suggestedLayouts?.[0] || "no layout")}</b><b>type ${htmlEscape(index.designMetadata?.compositionType || "?")}</b><b>space ${index.designMetadata?.typographySpace ?? "?"}@${htmlEscape(index.designMetadata?.typographySpacePosition || "?")}</b><b>clutter ${index.designMetadata?.clutterLevel ?? "?"}</b><b>crop ${index.designMetadata?.cropFlexibility ?? "?"}</b><b>risk ${index.designMetadata?.publicShareRisk ?? "?"}</b><b>aspect ${index.technicalMetadata?.aspectRatio?.toFixed?.(2) || "?"}</b><b>mp ${index.technicalMetadata?.resolutionMegapixels?.toFixed?.(1) || "?"}</b><b>content ${index.technicalMetadata?.contentSignal ?? "?"}</b></div><p>${htmlEscape(index.posterSuitability?.reasonForCoverScore || reason)}</p><p>${htmlEscape(index.posterSuitability?.reasonForHeroScore || "")}</p>${index.posterSuitability?.avoidAsCoverReason ? `<p class="avoid">${htmlEscape(index.posterSuitability.avoidAsCoverReason)}</p>` : ""}<code>${htmlEscape(photo.id)}</code></article>`;
    })
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cover Selection</title><style>body{font-family:Arial,sans-serif;background:#f6f1e8;margin:24px;color:#151515}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}article{background:#fff;border:1px solid #ddd6ca;border-radius:12px;padding:12px}img,.missing{width:100%;aspect-ratio:3/4;object-fit:contain;border-radius:8px;background:#eee}.rank{font-weight:800;color:#007a55;margin-bottom:8px}.scores{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.scores b{border-radius:999px;background:#e8fff5;color:#075f49;padding:4px 8px;font-size:11px}h2{font-size:16px}p{font-size:13px;line-height:1.4;color:#555}.avoid{color:#b42318;background:#fff1f0;border-radius:8px;padding:8px}code{font-size:11px;word-break:break-all}</style></head><body><h1>Cover Selection</h1><div class="grid">${cards}</div></body></html>`;
  fs.writeFileSync(filePath, html);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  requireArgs(args);

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    global: args.token ? { headers: { Authorization: `Bearer ${args.token}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("media_assets")
    .select("id, trip_id, asset_type, preview_url, thumbnail_url, provider_thumbnail_url, thumbnail_drive_web_url, width, height, blur_score, scene_tags, ai_metadata, taken_at, created_at")
    .eq("trip_id", args.journeyId)
    .eq("asset_type", "image")
    .limit(1000);

  if (error) throw error;
  const photos = (data || []).filter(
    (photo) => dateKey(photo.taken_at) === args.date || dateKey(photo.created_at) === args.date,
  );
  const candidates = photos
    .map((photo) => {
      const index = photoIndex(photo);
      const score = scoreCandidate(photo, index, args);
      return {
        photo,
        index,
        score,
        reason: candidateReason(index, score),
        suggestedLayoutKey:
          index.posterSuitability?.suggestedLayouts?.[0] || "cinematic_full_bleed",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, args.maxResults);

  console.log(`Found ${photos.length} photos for ${args.date}. Top ${candidates.length}:`);
  for (const [index, candidate] of candidates.entries()) {
    console.log(
      JSON.stringify(
        {
          rank: index + 1,
          mediaAssetId: candidate.photo.id,
          previewUrl: previewUrl(candidate.photo),
          coverScore: candidate.index.posterSuitability?.coverScore,
          heroScore: candidate.index.posterSuitability?.heroScore,
          computedCoverScore:
            candidate.index.posterSuitability?.computedCoverScore ??
            candidate.index.posterSuitability?.coverScore,
          computedHeroScore:
            candidate.index.posterSuitability?.computedHeroScore ??
            candidate.index.posterSuitability?.heroScore,
          scoreGap:
            (candidate.index.posterSuitability?.coverScore ?? 0) -
            (candidate.index.posterSuitability?.heroScore ?? 0),
          aesthetic: candidate.index.visualQuality?.overallAesthetic,
          suggestedLayouts: candidate.index.posterSuitability?.suggestedLayouts || [],
          layout: candidate.suggestedLayoutKey,
          compositionType: candidate.index.designMetadata?.compositionType,
          primarySubjectType: candidate.index.designMetadata?.primarySubjectType,
          typographySpace: candidate.index.designMetadata?.typographySpace,
          typographySpacePosition:
            candidate.index.designMetadata?.typographySpacePosition,
          clutterLevel: candidate.index.designMetadata?.clutterLevel,
          cropFlexibility: candidate.index.designMetadata?.cropFlexibility,
          publicShareRisk: candidate.index.designMetadata?.publicShareRisk,
          aspectRatio: candidate.index.technicalMetadata?.aspectRatio,
          resolutionMegapixels: candidate.index.technicalMetadata?.resolutionMegapixels,
          contentSignal: candidate.index.technicalMetadata?.contentSignal,
          reasonForCoverScore:
            candidate.index.posterSuitability?.reasonForCoverScore || null,
          reasonForHeroScore:
            candidate.index.posterSuitability?.reasonForHeroScore || null,
          reason: candidate.reason,
          avoidAsCoverReason: candidate.index.posterSuitability?.avoidAsCoverReason || null,
          rawModelScores: candidate.index.posterSuitability?.rawModelScores || null,
        },
        null,
        2,
      ),
    );
  }

  if (args.htmlPath) {
    writeHtmlGrid(args.htmlPath, candidates);
    console.log(`HTML preview written to ${args.htmlPath}`);
  }
}

main().catch((error) => {
  console.error("Cover selection test failed");
  console.error(error.message || error);
  process.exit(1);
});
