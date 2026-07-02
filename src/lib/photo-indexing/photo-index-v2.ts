import type {
  PhotoIndexV2,
  PhotoIndexV2DesignMetadata,
  PhotoIndexV2Depth,
  PhotoIndexV2Energy,
  PhotoIndexV2FaceVisibility,
  PhotoIndexV2Level,
  PhotoIndexV2Orientation,
  PhotoIndexV2Position,
  PhotoIndexV2PosterUseCase,
  PhotoIndexV2ShotType,
  PhotoIndexV2TypographySpacePosition,
} from "./types";
import { computePosterSuitability } from "./design-scoring";

type BasicPhotoMetadata = {
  id?: string | null;
  width?: number | null;
  height?: number | null;
  blurScore?: number | null;
  sceneTags?: string[] | null;
  summary?: string | null;
  objects?: string[] | null;
  locationHints?: string[] | null;
  activities?: string[] | null;
  confidence?: number | null;
};

const sceneTypes = new Set([
  "landscape",
  "city",
  "cityscape",
  "food",
  "people",
  "hotel",
  "transport",
  "document",
  "screenshot",
  "route",
  "nature",
  "architecture",
  "water",
  "museum",
  "shopping",
  "unknown",
]);

const shotTypes = new Set<PhotoIndexV2ShotType>([
  "wide",
  "medium",
  "close_up",
  "detail",
]);
const positions = new Set<PhotoIndexV2Position>([
  "center",
  "left",
  "right",
  "top",
  "bottom",
  "none",
]);
const depths = new Set<PhotoIndexV2Depth>(["flat", "layered"]);
const levels = new Set<PhotoIndexV2Level>(["low", "medium", "high"]);
const energies = new Set<PhotoIndexV2Energy>(["low", "medium", "high"]);
const faceVisibility = new Set<PhotoIndexV2FaceVisibility>([
  "clear",
  "partial",
  "none",
]);
const typographyPositions = new Set<PhotoIndexV2TypographySpacePosition>([
  "top",
  "bottom",
  "left",
  "right",
  "center",
  "none",
]);
const posterUseCases = new Set<PhotoIndexV2PosterUseCase>([
  "full_bleed",
  "hero_top",
  "collage",
  "magazine",
  "route",
  "thumbnail",
  "not_recommended",
]);

export const photoIndexV2Prompt = [
  "Analyze this travel photo for OTR Photo Indexing V2.",
  "Return strict JSON only. Do not identify people by name.",
  "Do not output final coverScore, heroScore, backgroundScore, collageScore, thumbnailScore, supportsLargeTitle, or suggestedLayouts. OTR computes all final poster scores locally.",
  "Focus on explainable design metadata: composition, subject, typography space, crop flexibility, travel atmosphere, story potential, visual risk, and public sharing risk.",
  "Assess whether there is enough clean space for a large title and where that space is.",
  "Classify travel scenery carefully. Mountains, canyons, waterfalls, lakes, rivers, ocean, beaches, sky, open roads, and scenic vistas should usually be landscape or nature, not hotel/transport/people unless those are the dominant subject.",
  "Use negativeSpace and typographySpacePosition aggressively: sky usually means top space, water/ground usually means bottom space, an off-center subject usually leaves space on the opposite side, and full-frame close-ups usually have none.",
  "Flag sensitive/private content such as passport, receipt, license_plate, child, private_address, medical, screenshot, documents, or visible payment details.",
  "Use the full 0-100 range for designMetadata numeric attributes. Avoid clustering around round values like 62, 72, or 82.",
  "Use this exact JSON shape: {\"photoIndexV2\":{\"version\":2,\"content\":{\"sceneType\":\"landscape|nature|cityscape|city|food|people|hotel|transport|document|screenshot|unknown\",\"objects\":[],\"locationHints\":[],\"activityHints\":[]},\"composition\":{\"orientation\":\"portrait|landscape|square\",\"shotType\":\"wide|medium|close_up|detail\",\"subjectPosition\":\"center|left|right|top|bottom|none\",\"negativeSpace\":\"top|bottom|left|right|center|none\",\"depth\":\"flat|layered\",\"clutterLevel\":\"low|medium|high\"},\"visualQuality\":{\"sharpness\":0,\"exposure\":0,\"contrast\":0,\"colorAppeal\":0,\"lightingQuality\":0,\"overallAesthetic\":0},\"designMetadata\":{\"compositionType\":\"wide scenic|portrait group|food close-up|document|...\",\"shotDistance\":\"wide|medium|close_up|detail\",\"primarySubjectType\":\"landscape|people|food|object|document|none\",\"subjectStrength\":0,\"travelAtmosphere\":0,\"typographySpace\":0,\"typographySpacePosition\":\"top|bottom|left|right|center|none\",\"clutterLevel\":0,\"lightingMood\":\"golden|soft|harsh|dark|flat|mixed\",\"colorMood\":\"warm|cool|muted|vivid|neutral\",\"emotionalTone\":\"epic|warm|peaceful|funny|dramatic|documentary|quiet|family|adventure\",\"storyPotential\":0,\"privacyRisk\":0,\"publicShareRisk\":0,\"cropFlexibility\":0,\"posterUseCases\":[\"full_bleed|hero_top|collage|magazine|route|thumbnail|not_recommended\"],\"reasons\":{\"subjectStrength\":\"\",\"travelAtmosphere\":\"\",\"typographySpace\":\"\",\"clutterLevel\":\"\",\"storyPotential\":\"\",\"privacyRisk\":\"\",\"cropFlexibility\":\"\"}},\"mood\":{\"primary\":\"peaceful\",\"secondary\":[],\"energy\":\"low|medium|high\"},\"people\":{\"visiblePeopleCount\":0,\"isGroupPhoto\":false,\"isSelfie\":false,\"faceVisibility\":\"clear|partial|none\"},\"safety\":{\"isSensitive\":false,\"sensitiveReasons\":[],\"allowPublicPoster\":true},\"caption\":\"\",\"indexConfidence\":0}}",
].join(" ");

function clampScore(value: unknown, fallback = 50) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function clampConfidence(value: unknown, fallback = 0.55) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(1, numberValue > 1 ? numberValue / 100 : numberValue));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(
  value: unknown,
  values: Set<T>,
  fallback: T,
) {
  return typeof value === "string" && values.has(value as T)
    ? (value as T)
    : fallback;
}

function recordValue(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function inferOrientation(width?: number | null, height?: number | null) {
  if (!width || !height) return "square" satisfies PhotoIndexV2Orientation;
  if (Math.abs(width - height) / Math.max(width, height) < 0.08) {
    return "square" satisfies PhotoIndexV2Orientation;
  }
  return height > width ? "portrait" : "landscape";
}

function inferSceneType(tags: string[], objects: string[]) {
  const haystack = [...tags, ...objects].join(" ").toLowerCase();
  const scores = {
    document: scoreText(haystack, /receipt|ticket|passport|document|screen|screenshot|menu|bill|invoice|boarding pass/g),
    landscape: scoreText(haystack, /mountain|waterfall|lake|river|sea|beach|sky|landscape|nature|canyon|valley|glacier|forest|cliff|sunset|sunrise|vista|scenic/g),
    cityscape: scoreText(haystack, /skyline|cityscape|harbor|harbour|downtown|city view/g),
    city: scoreText(haystack, /city|street|building|architecture|town|village/g),
    people: scoreText(haystack, /person|people|group|selfie|face|portrait/g),
    transport: scoreText(haystack, /car|bus|train|plane|airport|transport|road|vehicle|flight/g),
    food: scoreText(haystack, /food|restaurant|dish|meal|drink|coffee|dessert/g),
    hotel: scoreText(haystack, /hotel|room|bed|lobby|suite|accommodation/g),
  };
  if (scores.document >= 2) return "document";
  if (scores.landscape >= 1 && scores.landscape >= Math.max(scores.hotel, scores.transport, scores.people)) {
    return "landscape";
  }
  if (scores.cityscape >= 1) return "cityscape";
  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] ?? "unknown";
}

function scoreText(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].length;
}

function stringHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function continuousNoise(seed: string, max = 6) {
  if (!seed) return 0;
  return (stringHash(seed) % 1000) / 1000 * max;
}

function aspectRatio(width?: number | null, height?: number | null) {
  if (!width || !height) return null;
  return width / height;
}

function resolutionMegapixels(width?: number | null, height?: number | null) {
  if (!width || !height) return null;
  return (width * height) / 1_000_000;
}

function contentSignal(tags: string[], objects: string[], caption: string, fallback: BasicPhotoMetadata) {
  const text = [...tags, ...objects, caption, fallback.id ?? ""].join(" ").toLowerCase();
  const scenic = scoreText(text, /mountain|waterfall|lake|river|sky|sunset|sunrise|beach|glacier|canyon|valley|scenic|landscape|view|nature/g);
  const personal = scoreText(text, /friend|group|family|people|smile|selfie|portrait/g);
  const privateish = scoreText(text, /receipt|passport|ticket|screen|document|bill|invoice/g);
  const base = 48 + Math.min(24, scenic * 7) + Math.min(12, personal * 4) - Math.min(34, privateish * 11);
  return clampScore(base + continuousNoise(text, 9), 50);
}

function inferNegativeSpace(input: {
  provided: PhotoIndexV2Position;
  sceneType: string;
  orientation: PhotoIndexV2Orientation;
  shotType: PhotoIndexV2ShotType;
  subjectPosition: PhotoIndexV2Position;
  tags: string[];
  objects: string[];
}) {
  if (input.provided !== "none") return input.provided;
  const text = [...input.tags, ...input.objects].join(" ").toLowerCase();
  if (input.shotType === "close_up" || input.shotType === "detail") return "none";
  if (/sky|cloud|sunrise|sunset|mountain|cliff|waterfall/.test(text)) return "top";
  if (/water|lake|river|sea|beach|road|ground|snow|sand/.test(text)) return "bottom";
  if (input.subjectPosition === "left") return "right";
  if (input.subjectPosition === "right") return "left";
  if (input.orientation === "landscape" && ["landscape", "nature", "cityscape"].includes(input.sceneType)) return "top";
  return "none";
}

function inferSafety(tags: string[], objects: string[], caption: string) {
  const haystack = [...tags, ...objects, caption].join(" ").toLowerCase();
  const reasons = [
    ["passport", /passport/],
    ["receipt", /receipt|bill|invoice|payment|card/],
    ["license_plate", /license plate|number plate/],
    ["private_address", /address|home address/],
    ["medical", /medical|prescription|hospital/],
    ["screenshot", /screenshot|screen capture/],
    ["document", /document|ticket|boarding pass|id card/],
  ]
    .filter(([, pattern]) => (pattern as RegExp).test(haystack))
    .map(([reason]) => reason as string);
  return reasons;
}

function rawScoreRecord(value: unknown) {
  const record = recordValue(value);
  return {
    coverScore: Number.isFinite(Number(record.coverScore))
      ? clampScore(record.coverScore)
      : null,
    heroScore: Number.isFinite(Number(record.heroScore))
      ? clampScore(record.heroScore)
      : null,
    backgroundScore: Number.isFinite(Number(record.backgroundScore))
      ? clampScore(record.backgroundScore)
      : null,
    collageScore: Number.isFinite(Number(record.collageScore))
      ? clampScore(record.collageScore)
      : null,
    thumbnailScore: Number.isFinite(Number(record.thumbnailScore))
      ? clampScore(record.thumbnailScore)
      : null,
  };
}

function designReasons(value: unknown, fallback: Record<string, string>) {
  const record = recordValue(value);
  return {
    ...fallback,
    ...Object.fromEntries(
      Object.entries(record)
        .map(([key, entry]) => [key, stringValue(entry)])
        .filter(([, entry]) => entry.length > 0),
    ),
  };
}

function designNumber(value: unknown, fallback: number) {
  return clampScore(value, fallback);
}

function inferDesignMetadata(input: {
  root: Record<string, unknown>;
  sceneType: string;
  orientation: PhotoIndexV2Orientation;
  shotType: PhotoIndexV2ShotType;
  negativeSpace: PhotoIndexV2Position;
  clutterLevel: PhotoIndexV2Level;
  visualQuality: Record<string, unknown>;
  sensitiveReasons: string[];
  tags: string[];
  objects: string[];
  caption: string;
  people: Record<string, unknown>;
}): PhotoIndexV2DesignMetadata {
  const designMetadata = recordValue(input.root.designMetadata);
  const scene = input.sceneType;
  const isDocument = scene === "document" || scene === "screenshot";
  const isLandscape = [
    "landscape",
    "city",
    "cityscape",
    "nature",
    "water",
    "architecture",
  ].includes(scene);
  const visiblePeopleCount = Math.max(
    0,
    Math.round(Number(input.people.visiblePeopleCount) || 0),
  );
  const isGroup = booleanValue(input.people.isGroupPhoto, visiblePeopleCount > 1);
  const content = contentSignal(input.tags, input.objects, input.caption, {});
  const noiseSeed = [
    scene,
    input.orientation,
    input.shotType,
    input.negativeSpace,
    input.tags.join("|"),
    input.objects.join("|"),
    input.caption,
  ].join("|");
  const variance = continuousNoise(noiseSeed, 11) - 5.5;
  const subjectStrengthFallback = isLandscape
    ? 72
    : isGroup
      ? 76
      : isDocument
        ? 42
        : scene === "food"
          ? 64
          : 54;
  const travelFallback = isLandscape || scene === "city"
    ? 82
    : scene === "transport" || scene === "route"
      ? 72
      : scene === "hotel" || scene === "food"
        ? 52
        : isDocument
          ? 18
          : 48;
  const typographyFallback =
    input.negativeSpace !== "none"
      ? 62 + continuousNoise(`${noiseSeed}:space`, 18)
      : input.orientation === "portrait" && isLandscape
        ? 48 + continuousNoise(`${noiseSeed}:portrait-space`, 15)
        : 28 + continuousNoise(`${noiseSeed}:none-space`, 18);
  const clutterFallback =
    input.clutterLevel === "low" ? 24 : input.clutterLevel === "high" ? 78 : 52;
  const privacyFallback = input.sensitiveReasons.length > 0 ? 84 : isDocument ? 68 : 12;
  const storyFallback =
    isLandscape || scene === "people" || scene === "transport"
      ? 72
      : scene === "food" || scene === "hotel"
        ? 48
        : isDocument
          ? 22
          : 50;
  const cropFallback =
    input.orientation === "portrait"
      ? 72 + continuousNoise(`${noiseSeed}:portrait-crop`, 12)
      : input.orientation === "landscape"
        ? 48 + continuousNoise(`${noiseSeed}:landscape-crop`, 15)
        : 58 + continuousNoise(`${noiseSeed}:square-crop`, 10);
  const useCases = stringArray(designMetadata.posterUseCases)
    .map((value) => value as PhotoIndexV2PosterUseCase)
    .filter((value) => posterUseCases.has(value));
  const fallbackUseCases: PhotoIndexV2PosterUseCase[] = isDocument
    ? ["not_recommended", "thumbnail"]
    : isGroup
      ? ["collage", "hero_top", "thumbnail"]
      : isLandscape
        ? ["full_bleed", "hero_top", "thumbnail"]
        : scene === "route"
          ? ["route", "hero_top"]
          : ["magazine", "hero_top", "thumbnail"];
  const typographySpace = designNumber(
    designMetadata.typographySpace,
    typographyFallback + variance * 0.5,
  );
  const subjectStrength = designNumber(
    designMetadata.subjectStrength,
    subjectStrengthFallback + variance + (content - 50) * 0.08,
  );
  const travelAtmosphere = designNumber(
    designMetadata.travelAtmosphere,
    travelFallback + variance + (content - 50) * 0.16,
  );
  const clutter = designNumber(designMetadata.clutterLevel, clutterFallback);
  const storyPotential = designNumber(designMetadata.storyPotential, storyFallback + variance + (content - 50) * 0.12);
  const cropFlexibility = designNumber(designMetadata.cropFlexibility, cropFallback);
  const privacyRisk = designNumber(designMetadata.privacyRisk, privacyFallback);
  const publicShareRisk = designNumber(
    designMetadata.publicShareRisk,
    Math.max(privacyRisk, input.sensitiveReasons.length > 0 ? 76 : 16),
  );

  return {
    compositionType: stringValue(
      designMetadata.compositionType,
      `${input.orientation} ${scene}`,
    ),
    shotDistance: stringValue(designMetadata.shotDistance, input.shotType),
    primarySubjectType: stringValue(
      designMetadata.primarySubjectType,
      isGroup ? "people" : scene,
    ),
    subjectStrength,
    travelAtmosphere,
    typographySpace,
    typographySpacePosition: enumValue(
      designMetadata.typographySpacePosition,
      typographyPositions,
      input.negativeSpace === "none" ? "none" : input.negativeSpace,
    ),
    clutterLevel: clutter,
    lightingMood: stringValue(designMetadata.lightingMood, "mixed"),
    colorMood: stringValue(designMetadata.colorMood, "neutral"),
    emotionalTone: stringValue(
      designMetadata.emotionalTone,
      isLandscape ? "adventure" : isGroup ? "family" : "documentary",
    ),
    storyPotential,
    privacyRisk,
    publicShareRisk,
    cropFlexibility,
    posterUseCases: useCases.length > 0 ? useCases : fallbackUseCases,
    reasons: designReasons(designMetadata.reasons, {
      subjectStrength: `Inferred from ${scene} scene and visible subject.`,
      travelAtmosphere: `Inferred from scene type ${scene}.`,
      typographySpace: `Inferred from negativeSpace ${input.negativeSpace}.`,
      clutterLevel: `Mapped from V1 clutter level ${input.clutterLevel}.`,
      storyPotential: `Inferred from scene type ${scene} and caption.`,
      privacyRisk:
        input.sensitiveReasons.length > 0
          ? `Sensitive signals: ${input.sensitiveReasons.join(", ")}.`
          : "No obvious sensitive signals.",
      cropFlexibility: `Inferred from orientation ${input.orientation}.`,
      contentSignal: `Local content signal ${content}.`,
    }),
  };
}

export function normalizePhotoIndexV2(
  value: unknown,
  fallback: BasicPhotoMetadata = {},
): PhotoIndexV2 {
  const root = recordValue(value);
  const content = recordValue(root.content);
  const composition = recordValue(root.composition);
  const visualQuality = recordValue(root.visualQuality);
  const posterSuitability = recordValue(root.posterSuitability);
  const mood = recordValue(root.mood);
  const people = recordValue(root.people);
  const safety = recordValue(root.safety);
  const tags = fallback.sceneTags ?? [];
  const objects = stringArray(content.objects).length > 0
    ? stringArray(content.objects)
    : stringArray(fallback.objects);
  const activityHints = stringArray(content.activityHints).length > 0
    ? stringArray(content.activityHints)
    : stringArray(fallback.activities);
  const locationHints = stringArray(content.locationHints).length > 0
    ? stringArray(content.locationHints)
    : stringArray(fallback.locationHints);
  const sceneType = stringValue(content.sceneType, inferSceneType(tags, objects));
  const sensitiveReasons = stringArray(safety.sensitiveReasons);
  const inferredSensitiveReasons =
    sensitiveReasons.length > 0
      ? sensitiveReasons
      : inferSafety(tags, objects, stringValue(root.caption, fallback.summary ?? ""));
  const orientation = enumValue(
    composition.orientation,
    new Set<PhotoIndexV2Orientation>(["portrait", "landscape", "square"]),
    inferOrientation(fallback.width, fallback.height),
  );
  const isSensitive =
    booleanValue(safety.isSensitive, inferredSensitiveReasons.length > 0);
  const coverFallback =
    sceneType === "landscape" || sceneType === "city" || sceneType === "nature"
      ? 72
      : sceneType === "people"
        ? 62
        : sceneType === "document" || sceneType === "screenshot"
          ? 18
          : 48;
  const normalizedOrientation = orientation;
  const normalizedShotType = enumValue(composition.shotType, shotTypes, "medium");
  const normalizedSubjectPosition = enumValue(composition.subjectPosition, positions, "center");
  const normalizedNegativeSpace = inferNegativeSpace({
    provided: enumValue(composition.negativeSpace, positions, "none"),
    sceneType,
    orientation: normalizedOrientation,
    shotType: normalizedShotType,
    subjectPosition: normalizedSubjectPosition,
    tags,
    objects,
  });
  const normalizedClutterLevel = enumValue(composition.clutterLevel, levels, "medium");
  const normalizedVisualQuality = {
    sharpness: clampScore(visualQuality.sharpness, 70),
    exposure: clampScore(visualQuality.exposure, 70),
    contrast: clampScore(visualQuality.contrast, 65),
    colorAppeal: clampScore(visualQuality.colorAppeal, 65),
    lightingQuality: clampScore(visualQuality.lightingQuality, 65),
    overallAesthetic: clampScore(visualQuality.overallAesthetic, coverFallback),
  };
  const rawModelScores = rawScoreRecord({
    ...posterSuitability,
    ...recordValue(posterSuitability.rawModelScores),
  });

  const normalized: PhotoIndexV2 = {
    version: 2,
    content: {
      sceneType: sceneTypes.has(sceneType) ? sceneType : "unknown",
      objects,
      locationHints,
      activityHints,
    },
    composition: {
      orientation: normalizedOrientation,
      shotType: normalizedShotType,
      subjectPosition: normalizedSubjectPosition,
      negativeSpace: normalizedNegativeSpace,
      depth: enumValue(composition.depth, depths, "layered"),
      clutterLevel: normalizedClutterLevel,
    },
    visualQuality: normalizedVisualQuality,
    posterSuitability: {
      coverScore: coverFallback,
      heroScore: coverFallback,
      backgroundScore:
        normalizedOrientation === "portrait"
          ? coverFallback
          : Math.max(35, coverFallback - 8),
      collageScore: sceneType === "people" ? 72 : 52,
      thumbnailScore: coverFallback,
      supportsLargeTitle:
        ["top", "bottom", "left", "right", "center"].includes(normalizedNegativeSpace) &&
        sceneType !== "document",
      suggestedLayouts: suggestedLayoutsForScene(sceneType, normalizedOrientation),
      rawModelScores,
    },
    designMetadata: inferDesignMetadata({
      root,
      sceneType,
      orientation: normalizedOrientation,
      shotType: normalizedShotType,
      negativeSpace: normalizedNegativeSpace,
      clutterLevel: normalizedClutterLevel,
      visualQuality: normalizedVisualQuality,
      sensitiveReasons: inferredSensitiveReasons,
      tags,
      objects,
      caption: stringValue(root.caption, fallback.summary ?? ""),
      people,
    }),
    technicalMetadata: {
      width: fallback.width ?? null,
      height: fallback.height ?? null,
      aspectRatio: aspectRatio(fallback.width, fallback.height),
      resolutionMegapixels: resolutionMegapixels(fallback.width, fallback.height),
      blurScore: fallback.blurScore ?? null,
      contentSignal: contentSignal(
        tags,
        objects,
        stringValue(root.caption, fallback.summary ?? ""),
        fallback,
      ),
    },
    mood: {
      primary: stringValue(mood.primary, "documentary"),
      secondary: stringArray(mood.secondary).slice(0, 8),
      energy: enumValue(mood.energy, energies, "medium"),
    },
    people: {
      visiblePeopleCount: Math.max(0, Math.round(Number(people.visiblePeopleCount) || 0)),
      isGroupPhoto: booleanValue(people.isGroupPhoto),
      isSelfie: booleanValue(people.isSelfie),
      faceVisibility: enumValue(people.faceVisibility, faceVisibility, "none"),
    },
    safety: {
      isSensitive,
      sensitiveReasons: inferredSensitiveReasons,
      allowPublicPoster: booleanValue(safety.allowPublicPoster, !isSensitive),
    },
    caption: stringValue(root.caption, fallback.summary ?? ""),
    indexConfidence: clampConfidence(root.indexConfidence, fallback.confidence ?? 0.55),
  };
  const computed = computePosterSuitability(normalized);
  normalized.posterSuitability = {
    ...computed,
    computedCoverScore: computed.coverScore,
    computedHeroScore: computed.heroScore,
    computedBackgroundScore: computed.backgroundScore,
    computedCollageScore: computed.collageScore,
    computedThumbnailScore: computed.thumbnailScore,
    rawModelScores,
  };
  return normalized;
}

function suggestedLayoutsForScene(sceneType: string, orientation: PhotoIndexV2Orientation) {
  if (sceneType === "landscape" && orientation === "portrait") {
    return ["cinematic_full_bleed", "hero_top_story_bottom"];
  }
  if (sceneType === "landscape" || sceneType === "city" || sceneType === "cityscape") {
    return ["hero_top_story_bottom", "cinematic_full_bleed"];
  }
  if (sceneType === "people") {
    return ["collage_memory_board", "hero_top_story_bottom"];
  }
  return ["magazine_white_space", "hero_top_story_bottom"];
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed) as Record<string, unknown>;
}

export function extractPhotoIndexV2FromRawResponse(
  rawResponse: unknown,
  fallback: BasicPhotoMetadata,
) {
  try {
    const raw = recordValue(rawResponse);
    const direct = raw.photoIndexV2 ?? raw.photo_index_v2;
    if (direct) return normalizePhotoIndexV2(direct, fallback);
    const choices = raw.choices;
    if (Array.isArray(choices)) {
      const first = recordValue(choices[0]);
      const message = recordValue(first.message);
      const content = stringValue(message.content);
      if (content) {
        const parsed = parseJsonObject(content);
        return normalizePhotoIndexV2(
          parsed.photoIndexV2 ?? parsed.photo_index_v2 ?? parsed,
          fallback,
        );
      }
    }
  } catch {
    // Fall through to basic V2. Indexing must never fail because V2 parsing did.
  }
  return buildBasicPhotoIndexV2(fallback);
}

export function buildBasicPhotoIndexV2(
  metadata: BasicPhotoMetadata = {},
): PhotoIndexV2 {
  return normalizePhotoIndexV2({}, metadata);
}
