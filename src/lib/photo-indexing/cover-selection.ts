import { buildBasicPhotoIndexV2, normalizePhotoIndexV2 } from "./photo-index-v2";
import type {
  CoverCandidate,
  CoverSelectionOptions,
  CoverSelectionPhoto,
  CoverSelectionRole,
  PhotoIndexV2,
} from "./types";

const defaultMaxResults = 3;

function dateKey(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function metadataRecord(photo: CoverSelectionPhoto) {
  return photo.aiMetadata && typeof photo.aiMetadata === "object"
    ? photo.aiMetadata
    : {};
}

export function photoIndexV2ForSelection(photo: CoverSelectionPhoto) {
  const metadata = metadataRecord(photo);
  const existing = metadata.photoIndexV2 ?? metadata.photo_index_v2;
  const fallback = {
    width: photo.width,
    height: photo.height,
    blurScore: photo.blurScore,
    sceneTags: photo.sceneTags ?? [],
    summary: typeof metadata.summary === "string" ? metadata.summary : null,
    objects: Array.isArray(metadata.objects) ? metadata.objects.map(String) : [],
    locationHints: Array.isArray(metadata.locationHints)
      ? metadata.locationHints.map(String)
      : [],
    activities: Array.isArray(metadata.activities)
      ? metadata.activities.map(String)
      : [],
    confidence: typeof metadata.confidence === "number" ? metadata.confidence : null,
    id: photo.id,
  };
  return existing ? normalizePhotoIndexV2(existing, fallback) : buildBasicPhotoIndexV2(fallback);
}

function hashJitter(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 401) / 100;
}

function roleForIndex(index: PhotoIndexV2): CoverSelectionRole {
  if (index.posterSuitability.backgroundScore >= index.posterSuitability.coverScore + 10) {
    return "texture";
  }
  if (index.posterSuitability.collageScore >= index.posterSuitability.coverScore + 12) {
    return "support";
  }
  return "hero";
}

function cropHintForIndex(index: PhotoIndexV2) {
  if (index.composition.subjectPosition === "left") return "keep-left";
  if (index.composition.subjectPosition === "right") return "keep-right";
  if (index.composition.subjectPosition === "top") return "keep-top";
  if (index.composition.subjectPosition === "bottom") return "keep-bottom";
  return index.composition.orientation === "portrait"
    ? "portrait-center"
    : "center-crop";
}

function preferredLayout(index: PhotoIndexV2, options: CoverSelectionOptions) {
  if (
    options.preferredLayoutKey &&
    index.posterSuitability.suggestedLayouts.includes(options.preferredLayoutKey)
  ) {
    return options.preferredLayoutKey;
  }
  return index.posterSuitability.suggestedLayouts[0] ?? "cinematic_full_bleed";
}

function storyIntentBonus(index: PhotoIndexV2, intentKey: string | null | undefined) {
  if (!intentKey) return 0;
  if (intentKey.includes("people") || intentKey.includes("group")) {
    return index.people.isGroupPhoto ? 12 : index.people.visiblePeopleCount > 0 ? 7 : -8;
  }
  if (intentKey.includes("route")) {
    return index.content.activityHints.some((hint) =>
      /drive|walk|hike|route|road|trail|flight|train/i.test(hint),
    )
      ? 10
      : 0;
  }
  if (intentKey.includes("spending")) {
    return index.content.sceneType === "document" ? -20 : 0;
  }
  return 0;
}

function selectionScore(
  photo: CoverSelectionPhoto,
  index: PhotoIndexV2,
  options: CoverSelectionOptions,
) {
  let score =
    index.posterSuitability.coverScore * 0.72 +
    index.posterSuitability.heroScore * 0.1 +
    index.designMetadata.typographySpace * 0.07 +
    index.designMetadata.cropFlexibility * 0.06 +
    (100 - index.designMetadata.publicShareRisk) * 0.05;

  const isDateMatch =
    options.date &&
    (dateKey(photo.takenAt) === options.date || dateKey(photo.createdAt) === options.date);
  score += isDateMatch ? 5 : 0;
  score += storyIntentBonus(index, options.storyIntentKey);

  if (
    options.preferredLayoutKey &&
    !index.posterSuitability.suggestedLayouts.includes(options.preferredLayoutKey)
  ) {
    score -= 8;
  }
  if (options.requirePublicSafe && !index.safety.allowPublicPoster) score -= 120;
  score += hashJitter(photo.id);

  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}

function reasonForCandidate(index: PhotoIndexV2, score: number) {
  const parts = [
    `${index.content.sceneType} photo`,
    `cover ${index.posterSuitability.coverScore}`,
    `hero ${index.posterSuitability.heroScore}`,
    `gap ${index.posterSuitability.coverScore - index.posterSuitability.heroScore}`,
    `aesthetic ${index.visualQuality.overallAesthetic}`,
    `type ${index.designMetadata.compositionType}`,
    `typography ${index.designMetadata.typographySpace}`,
    `clutter ${index.designMetadata.clutterLevel}`,
  ];
  if (index.posterSuitability.supportsLargeTitle) parts.push("has title space");
  if (index.safety.isSensitive) {
    parts.push(`sensitive: ${index.safety.sensitiveReasons.join(", ") || "unknown"}`);
  }
  if (index.posterSuitability.avoidAsCoverReason) {
    parts.push(`avoid: ${index.posterSuitability.avoidAsCoverReason}`);
  }
  parts.push(`final ${score}`);
  return parts.join("; ");
}

export function selectCoverCandidates(
  photos: CoverSelectionPhoto[],
  options: CoverSelectionOptions = {},
): CoverCandidate[] {
  const maxResults = Math.max(1, options.maxResults ?? defaultMaxResults);
  return photos
    .map((photo) => {
      const photoIndexV2 = photoIndexV2ForSelection(photo);
      const score = selectionScore(photo, photoIndexV2, options);
      return {
        mediaAssetId: photo.id,
        score,
        role: roleForIndex(photoIndexV2),
        reason: reasonForCandidate(photoIndexV2, score),
        suggestedLayoutKey: preferredLayout(photoIndexV2, options),
        cropHint: cropHintForIndex(photoIndexV2),
        computedCoverScore: photoIndexV2.posterSuitability.coverScore,
        computedHeroScore: photoIndexV2.posterSuitability.heroScore,
        scoreGap:
          photoIndexV2.posterSuitability.coverScore -
          photoIndexV2.posterSuitability.heroScore,
        reasonForCoverScore:
          photoIndexV2.posterSuitability.reasonForCoverScore ?? "",
        reasonForHeroScore:
          photoIndexV2.posterSuitability.reasonForHeroScore ?? "",
        typographySpace: photoIndexV2.designMetadata.typographySpace,
        typographySpacePosition:
          photoIndexV2.designMetadata.typographySpacePosition,
        clutterLevel: photoIndexV2.designMetadata.clutterLevel,
        cropFlexibility: photoIndexV2.designMetadata.cropFlexibility,
        publicShareRisk: photoIndexV2.designMetadata.publicShareRisk,
        photoIndexV2,
      } satisfies CoverCandidate;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults);
}

export type {
  CoverCandidate,
  CoverSelectionOptions,
  CoverSelectionPhoto,
  PhotoIndexV2,
} from "./types";
