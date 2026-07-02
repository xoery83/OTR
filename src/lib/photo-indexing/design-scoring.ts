import type {
  PhotoIndexV2,
  PhotoIndexV2ComputedSuitability,
  PhotoIndexV2DesignMetadata,
} from "./types";

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function includesAny(value: string, words: string[]) {
  const normalized = value.toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function design(index: PhotoIndexV2): PhotoIndexV2DesignMetadata {
  return index.designMetadata;
}

function visualQuality(index: PhotoIndexV2) {
  const technical = index.technicalMetadata;
  const resolutionBonus = technical.resolutionMegapixels
    ? Math.min(8, Math.max(-6, (technical.resolutionMegapixels - 2.4) * 1.2))
    : 0;
  const blurPenalty = technical.blurScore
    ? Math.min(16, Math.max(0, technical.blurScore * 12))
    : 0;
  return clampScore(
    average([
    index.visualQuality.sharpness,
    index.visualQuality.exposure,
    index.visualQuality.contrast,
    index.visualQuality.colorAppeal,
    index.visualQuality.lightingQuality,
    index.visualQuality.overallAesthetic,
    ]) + resolutionBonus - blurPenalty,
  );
}

function sceneCoverBonus(index: PhotoIndexV2) {
  const scene = index.content.sceneType;
  if (["landscape", "nature", "water"].includes(scene)) return 12;
  if (["city", "cityscape", "architecture"].includes(scene)) return 8;
  if (scene === "people" && index.people.isGroupPhoto) return 7;
  if (scene === "route" || scene === "transport") return 3;
  if (scene === "food" || scene === "hotel") return -12;
  if (scene === "document" || scene === "screenshot") return -28;
  return 0;
}

function subjectHeroBonus(index: PhotoIndexV2) {
  const metadata = design(index);
  const subject = metadata.primarySubjectType;
  if (index.people.isGroupPhoto) return 8;
  if (includesAny(subject, ["person", "people", "group", "action"])) return 8;
  if (includesAny(subject, ["food", "object", "detail", "ticket", "medal"])) return 4;
  if (includesAny(subject, ["none", "unknown"])) return -4;
  return 2;
}

function shotCoverPenalty(index: PhotoIndexV2) {
  const shot = design(index).shotDistance || index.composition.shotType;
  if (includesAny(shot, ["close", "close_up", "detail", "macro"])) return -18;
  if (includesAny(shot, ["medium"])) return -4;
  return 4;
}

function shotHeroBonus(index: PhotoIndexV2) {
  const shot = design(index).shotDistance || index.composition.shotType;
  if (includesAny(shot, ["close", "close_up", "detail", "macro"])) return 7;
  if (includesAny(shot, ["medium"])) return 4;
  return 2;
}

function privacyPenalty(index: PhotoIndexV2) {
  const metadata = design(index);
  const sensitivePenalty = index.safety.isSensitive ? 28 : 0;
  return Math.max(metadata.privacyRisk * 0.35, metadata.publicShareRisk * 0.55, sensitivePenalty);
}

function aspectRatioCoverSignal(index: PhotoIndexV2) {
  const ratio = index.technicalMetadata.aspectRatio;
  if (!ratio) return 0;
  const posterRatio = 3 / 4;
  const squareRatio = 1;
  const distanceFromPoster = Math.abs(ratio - posterRatio);
  const distanceFromSquare = Math.abs(ratio - squareRatio);
  return clampScore(
    82 -
      Math.min(42, distanceFromPoster * 32) -
      Math.min(12, distanceFromSquare * 8),
  );
}

function resolutionSignal(index: PhotoIndexV2) {
  const megapixels = index.technicalMetadata.resolutionMegapixels;
  if (!megapixels) return 52;
  if (megapixels < 0.8) return 28 + megapixels * 18;
  if (megapixels < 2.4) return 48 + megapixels * 10;
  if (megapixels < 8) return 72 + Math.min(15, (megapixels - 2.4) * 2.4);
  return 88;
}

function orientationCoverSignal(index: PhotoIndexV2) {
  if (index.composition.orientation === "portrait") return 82;
  if (index.composition.orientation === "square") return 68;
  return 56;
}

function negativeSpaceSignal(index: PhotoIndexV2) {
  const position = index.designMetadata.typographySpacePosition;
  if (position === "top" || position === "bottom") return 82;
  if (position === "left" || position === "right") return 73;
  if (position === "center") return 58;
  return 34;
}

function scenePenaltyForFullBleed(index: PhotoIndexV2) {
  const scene = index.content.sceneType;
  const subject = index.designMetadata.primarySubjectType.toLowerCase();
  if (["document", "screenshot"].includes(scene)) return 36;
  if (/receipt|ticket|passport|menu|screen|document/.test(subject)) return 32;
  if (index.people.isSelfie) return 18;
  if (scene === "food" && /close|detail/.test(index.designMetadata.shotDistance)) {
    return 16;
  }
  return 0;
}

function contentSignal(index: PhotoIndexV2) {
  return index.technicalMetadata.contentSignal;
}

function coverScore(index: PhotoIndexV2) {
  const metadata = design(index);
  const score =
    metadata.travelAtmosphere * 0.15 +
    metadata.typographySpace * 0.16 +
    metadata.cropFlexibility * 0.12 +
    (100 - metadata.clutterLevel) * 0.11 +
    orientationCoverSignal(index) * 0.08 +
    aspectRatioCoverSignal(index) * 0.08 +
    resolutionSignal(index) * 0.06 +
    negativeSpaceSignal(index) * 0.08 +
    visualQuality(index) * 0.08 +
    contentSignal(index) * 0.04 +
    metadata.storyPotential * 0.04 +
    sceneCoverBonus(index) +
    shotCoverPenalty(index) -
    privacyPenalty(index) -
    scenePenaltyForFullBleed(index);

  return clampScore(score);
}

function heroScore(index: PhotoIndexV2) {
  const metadata = design(index);
  const emotionalBonus = includesAny(metadata.emotionalTone, [
    "dramatic",
    "warm",
    "funny",
    "epic",
    "adventure",
    "peaceful",
  ])
    ? 4
    : 0;
  const score =
    metadata.subjectStrength * 0.28 +
    metadata.storyPotential * 0.22 +
    visualQuality(index) * 0.16 +
    metadata.travelAtmosphere * 0.11 +
    (100 - metadata.clutterLevel) * 0.08 +
    metadata.cropFlexibility * 0.05 +
    resolutionSignal(index) * 0.04 +
    contentSignal(index) * 0.04 +
    index.visualQuality.lightingQuality * 0.06 +
    subjectHeroBonus(index) +
    shotHeroBonus(index) +
    emotionalBonus -
    Math.max(0, metadata.privacyRisk - 65) * 0.25;

  return clampScore(score);
}

function backgroundScore(index: PhotoIndexV2) {
  const metadata = design(index);
  return clampScore(
    metadata.typographySpace * 0.34 +
      negativeSpaceSignal(index) * 0.14 +
      metadata.cropFlexibility * 0.13 +
      (100 - metadata.clutterLevel) * 0.16 +
      aspectRatioCoverSignal(index) * 0.08 +
      index.visualQuality.lightingQuality * 0.1 +
      index.visualQuality.colorAppeal * 0.08 +
      metadata.travelAtmosphere * 0.1 -
      privacyPenalty(index) * 0.55,
  );
}

function collageScore(index: PhotoIndexV2) {
  const metadata = design(index);
  const peopleBonus = index.people.visiblePeopleCount > 0 ? 8 : 0;
  const detailBonus = includesAny(metadata.shotDistance, ["detail", "close", "macro"])
    ? 5
    : 0;
  return clampScore(
    metadata.subjectStrength * 0.25 +
      metadata.storyPotential * 0.2 +
      visualQuality(index) * 0.16 +
      (100 - metadata.clutterLevel) * 0.12 +
      metadata.cropFlexibility * 0.1 +
      metadata.travelAtmosphere * 0.15 +
      resolutionSignal(index) * 0.04 +
      peopleBonus +
      detailBonus -
      privacyPenalty(index) * 0.35,
  );
}

function thumbnailScore(index: PhotoIndexV2) {
  const metadata = design(index);
  return clampScore(
    metadata.subjectStrength * 0.28 +
      visualQuality(index) * 0.18 +
      index.visualQuality.contrast * 0.14 +
      index.visualQuality.colorAppeal * 0.12 +
      (100 - metadata.clutterLevel) * 0.14 +
      metadata.storyPotential * 0.12 -
      privacyPenalty(index) * 0.45,
  );
}

function suggestedLayouts(index: PhotoIndexV2, scores: { cover: number; background: number; collage: number }) {
  const metadata = design(index);
  const useCases = new Set(metadata.posterUseCases);
  const layouts: string[] = [];
  if (
    (useCases.has("full_bleed") && scores.cover >= 58) ||
    (scores.cover >= 72 && metadata.typographySpace >= 52 && metadata.cropFlexibility >= 52)
  ) {
    layouts.push("cinematic_full_bleed");
  }
  if (useCases.has("collage") || scores.collage >= scores.cover + 8 || index.people.isGroupPhoto) {
    layouts.push("collage_memory_board");
  }
  if (useCases.has("route") || index.content.sceneType === "route") {
    layouts.push("route_story_card");
  }
  if (useCases.has("hero_top") || scores.background >= 58) {
    layouts.push("hero_top_story_bottom");
  }
  if (useCases.has("magazine") || layouts.length === 0) {
    layouts.push("magazine_white_space");
  }
  return [...new Set(layouts)].slice(0, 4);
}

function avoidReason(index: PhotoIndexV2, score: number) {
  const metadata = design(index);
  if (metadata.posterUseCases.includes("not_recommended")) return "Model marked this photo as not recommended for poster use.";
  if (index.safety.isSensitive || metadata.publicShareRisk >= 70) {
    return "High privacy or public sharing risk.";
  }
  if (index.content.sceneType === "document" || index.content.sceneType === "screenshot") {
    return "Document or screenshot-like image is not suitable as a public cover.";
  }
  if (metadata.clutterLevel >= 78) return "Clutter is too high for a clean cover.";
  if (metadata.typographySpace < 28) return "Not enough clean typography space for a title.";
  if (metadata.cropFlexibility < 28) return "Poor crop flexibility for poster formats.";
  if (score < 40) return "Low travel atmosphere and visual poster suitability.";
  return undefined;
}

export function computePosterSuitability(
  index: PhotoIndexV2,
): PhotoIndexV2ComputedSuitability {
  const cover = coverScore(index);
  const hero = heroScore(index);
  const background = backgroundScore(index);
  const collage = collageScore(index);
  const thumbnail = thumbnailScore(index);
  const metadata = design(index);
  const supportsLargeTitle =
    metadata.typographySpace >= 58 &&
    metadata.clutterLevel <= 62 &&
    metadata.typographySpacePosition !== "none" &&
    metadata.publicShareRisk < 72;
  const layouts = suggestedLayouts(index, { cover, background, collage });
  const avoidAsCoverReason = avoidReason(index, cover);
  const baseCoverReason = [
    `travel ${metadata.travelAtmosphere}`,
    `typeSpace ${metadata.typographySpace}@${metadata.typographySpacePosition}`,
    `crop ${metadata.cropFlexibility}`,
    `clutter ${metadata.clutterLevel}`,
    `orientation ${index.composition.orientation}`,
    `aspect ${index.technicalMetadata.aspectRatio?.toFixed(2) ?? "?"}`,
    `mp ${index.technicalMetadata.resolutionMegapixels?.toFixed(1) ?? "?"}`,
    `visual ${Math.round(visualQuality(index))}`,
    `risk ${metadata.publicShareRisk}`,
  ].join("; ");
  const baseHeroReason = [
    `subjectStrength ${metadata.subjectStrength}`,
    `storyPotential ${metadata.storyPotential}`,
    `emotionalTone ${metadata.emotionalTone || "unknown"}`,
    `visualQuality ${Math.round(visualQuality(index))}`,
  ].join("; ");

  return {
    coverScore: cover,
    heroScore: hero,
    backgroundScore: background,
    collageScore: collage,
    thumbnailScore: thumbnail,
    supportsLargeTitle,
    suggestedLayouts: layouts,
    avoidAsCoverReason,
    reasonForCoverScore: avoidAsCoverReason
      ? `${baseCoverReason}; avoid: ${avoidAsCoverReason}`
      : baseCoverReason,
    reasonForHeroScore: baseHeroReason,
  };
}
