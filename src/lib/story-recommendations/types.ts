import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryShotRecommendation } from "@/lib/memory-shots/types";

export type StoryRecommendationIntentKey =
  | "daily_best_moments"
  | "people_story"
  | "group_story"
  | "route_story"
  | "spending_story";

export type StoryRecommendationResourceSummary = {
  photosCount: number;
  memoriesCount: number;
  plannerItemsCount: number;
  peopleCount: number;
  locationsCount: number;
  expensesCount: number;
  routeAvailable: boolean;
  latestActivityAt: string | null;
  recentActivityScore: number;
};

export type StoryDayResourceSummary = StoryRecommendationResourceSummary & {
  date: string;
};

export type StoryDayCreatableIntent = {
  intentKey: StoryRecommendationIntentKey;
  title: string;
  templateKey: string | null;
  creatable: boolean;
  comingSoon: boolean;
};

export type StoryDayAssessment = {
  date: string;
  canCreate: boolean;
  score: number;
  reason: string;
  resourceSummary: StoryDayResourceSummary;
  supportedIntents: StoryDayCreatableIntent[];
};

export type StoryRecommendationParameters = {
  templateKey: string | null;
  date: string | null;
  language: string;
  contentTypes: string[];
};

export type StoryRecommendationScore = {
  score: number;
  reason: string;
  parameters: StoryRecommendationParameters;
};

export type StoryRecommendationIntent = {
  key: StoryRecommendationIntentKey;
  title: string;
  description: string;
  requiredResources: string[];
  parameterSchema: Record<string, unknown>;
  generateTemplateKey: string | null;
  score: (
    summary: StoryRecommendationResourceSummary,
    context: StoryRecommendationContext,
  ) => StoryRecommendationScore | null;
};

export type StoryRecommendationCandidate = {
  intent: StoryRecommendationIntent;
  recommendationKey: string;
  title: string;
  reason: string;
  score: number;
  payload: StoryRecommendationParameters;
  metadata: {
    intentKey: StoryRecommendationIntentKey;
    score: number;
    reason: string;
    parameters: StoryRecommendationParameters;
    resourceSummary: StoryRecommendationResourceSummary;
    generatedAt: string;
  };
};

export type StoryRecommendationRefreshResult = {
  recommendations: MemoryShotRecommendation[];
  resourceSummary: StoryRecommendationResourceSummary;
  generatedAt: string;
};

export type StoryRecommendationContext = {
  journeyId: string;
  language: string;
  today: string;
};

export type StoryRecommendationsOptions = {
  supabase: SupabaseClient;
};
