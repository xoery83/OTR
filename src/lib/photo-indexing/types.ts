export type PhotoIndexV2Orientation = "portrait" | "landscape" | "square";
export type PhotoIndexV2ShotType = "wide" | "medium" | "close_up" | "detail";
export type PhotoIndexV2Position =
  | "center"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "none";
export type PhotoIndexV2Depth = "flat" | "layered";
export type PhotoIndexV2Level = "low" | "medium" | "high";
export type PhotoIndexV2Energy = "low" | "medium" | "high";
export type PhotoIndexV2FaceVisibility = "clear" | "partial" | "none";
export type PhotoIndexV2TypographySpacePosition =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "center"
  | "none";
export type PhotoIndexV2PosterUseCase =
  | "full_bleed"
  | "hero_top"
  | "collage"
  | "magazine"
  | "route"
  | "thumbnail"
  | "not_recommended";

export type PhotoIndexV2DesignMetadata = {
  compositionType: string;
  shotDistance: string;
  primarySubjectType: string;
  subjectStrength: number;
  travelAtmosphere: number;
  typographySpace: number;
  typographySpacePosition: PhotoIndexV2TypographySpacePosition;
  clutterLevel: number;
  lightingMood: string;
  colorMood: string;
  emotionalTone: string;
  storyPotential: number;
  privacyRisk: number;
  publicShareRisk: number;
  cropFlexibility: number;
  posterUseCases: PhotoIndexV2PosterUseCase[];
  reasons: Record<string, string>;
};

export type PhotoIndexV2TechnicalMetadata = {
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  resolutionMegapixels: number | null;
  blurScore: number | null;
  contentSignal: number;
};

export type PhotoIndexV2ComputedSuitability = {
  coverScore: number;
  heroScore: number;
  backgroundScore: number;
  collageScore: number;
  thumbnailScore: number;
  supportsLargeTitle: boolean;
  suggestedLayouts: string[];
  avoidAsCoverReason?: string;
  reasonForCoverScore: string;
  reasonForHeroScore: string;
};

export type PhotoIndexV2 = {
  version: 2;
  content: {
    sceneType: string;
    objects: string[];
    locationHints: string[];
    activityHints: string[];
  };
  composition: {
    orientation: PhotoIndexV2Orientation;
    shotType: PhotoIndexV2ShotType;
    subjectPosition: PhotoIndexV2Position;
    negativeSpace: PhotoIndexV2Position;
    depth: PhotoIndexV2Depth;
    clutterLevel: PhotoIndexV2Level;
  };
  visualQuality: {
    sharpness: number;
    exposure: number;
    contrast: number;
    colorAppeal: number;
    lightingQuality: number;
    overallAesthetic: number;
  };
  posterSuitability: {
    coverScore: number;
    heroScore: number;
    backgroundScore: number;
    collageScore: number;
    thumbnailScore: number;
    supportsLargeTitle: boolean;
    suggestedLayouts: string[];
    avoidAsCoverReason?: string;
    computedCoverScore?: number;
    computedHeroScore?: number;
    computedBackgroundScore?: number;
    computedCollageScore?: number;
    computedThumbnailScore?: number;
    rawModelScores?: Record<string, number | null>;
    reasonForCoverScore?: string;
    reasonForHeroScore?: string;
  };
  designMetadata: PhotoIndexV2DesignMetadata;
  technicalMetadata: PhotoIndexV2TechnicalMetadata;
  mood: {
    primary: string;
    secondary: string[];
    energy: PhotoIndexV2Energy;
  };
  people: {
    visiblePeopleCount: number;
    isGroupPhoto: boolean;
    isSelfie: boolean;
    faceVisibility: PhotoIndexV2FaceVisibility;
  };
  safety: {
    isSensitive: boolean;
    sensitiveReasons: string[];
    allowPublicPoster: boolean;
  };
  caption: string;
  indexConfidence: number;
};

export type CoverSelectionRole = "hero" | "support" | "texture";

export type CoverSelectionPhoto = {
  id: string;
  takenAt?: string | null;
  createdAt?: string | null;
  width?: number | null;
  height?: number | null;
  blurScore?: number | null;
  sceneTags?: string[] | null;
  aiMetadata?: Record<string, unknown> | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  providerThumbnailUrl?: string | null;
  thumbnailDriveWebUrl?: string | null;
};

export type CoverSelectionOptions = {
  date?: string | null;
  storyIntentKey?: string | null;
  preferredLayoutKey?: string | null;
  peopleIds?: string[];
  requirePublicSafe?: boolean;
  maxResults?: number;
};

export type CoverCandidate = {
  mediaAssetId: string;
  score: number;
  role: CoverSelectionRole;
  reason: string;
  suggestedLayoutKey: string;
  cropHint: string;
  computedCoverScore: number;
  computedHeroScore: number;
  scoreGap: number;
  reasonForCoverScore: string;
  reasonForHeroScore: string;
  typographySpace: number;
  typographySpacePosition: PhotoIndexV2TypographySpacePosition;
  clutterLevel: number;
  cropFlexibility: number;
  publicShareRisk: number;
  photoIndexV2: PhotoIndexV2;
};
