import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryShotRecommendation } from "@/lib/memory-shots/types";
import { storyRecommendationIntents } from "./intents";
import type {
  StoryDayAssessment,
  StoryDayResourceSummary,
  StoryRecommendationCandidate,
  StoryRecommendationContext,
  StoryRecommendationRefreshResult,
  StoryRecommendationResourceSummary,
  StoryRecommendationsOptions,
} from "./types";

type RecommendationRow = {
  id: string;
  journey_id: string;
  user_id: string | null;
  template_id: string | null;
  recommendation_key: string;
  title: string;
  reason: string | null;
  score: number;
  status: MemoryShotRecommendation["status"];
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type LocationRow = {
  location_name?: string | null;
  address_text?: string | null;
};

type DatedPhotoRow = {
  id: string;
  taken_at?: string | null;
  created_at: string;
};

type QueryError = {
  message?: string;
};

type CountQueryResult = {
  count: number | null;
  error: QueryError | null;
};

type SingleQueryResult = {
  data: Record<string, unknown> | null;
  error: QueryError | null;
};

const engineName = "story_recommendation_engine_v1";

function mapRecommendation(row: RecommendationRow): MemoryShotRecommendation {
  return {
    id: row.id,
    journeyId: row.journey_id,
    userId: row.user_id,
    templateId: row.template_id,
    recommendationKey: row.recommendation_key,
    title: row.title,
    reason: row.reason,
    score: row.score,
    status: row.status,
    payload: row.payload ?? {},
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function countRows(query: PromiseLike<CountQueryResult>) {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function latestTimestamp(
  column: string,
  query: PromiseLike<SingleQueryResult>,
) {
  const { data, error } = await query;
  if (error) throw error;
  const value = data?.[column];
  return typeof value === "string" ? value : null;
}

function normalizeLocation(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() || null;
}

async function countLocations(supabase: SupabaseClient, journeyId: string) {
  const [memories, events, reservations, expenses] = await Promise.all([
    supabase
      .from("memory_entries")
      .select("location_name")
      .eq("trip_id", journeyId)
      .not("location_name", "is", null)
      .limit(200),
    supabase
      .from("itinerary_events")
      .select("location_name")
      .eq("trip_id", journeyId)
      .not("location_name", "is", null)
      .limit(200),
    supabase
      .from("itinerary_reservations")
      .select("location_name")
      .eq("trip_id", journeyId)
      .not("location_name", "is", null)
      .limit(200),
    supabase
      .from("ledger_entries")
      .select("address_text")
      .eq("journey_id", journeyId)
      .not("address_text", "is", null)
      .limit(200),
  ]);

  for (const result of [memories, events, reservations, expenses]) {
    if (result.error) throw result.error;
  }

  const locations = new Set<string>();
  [
    ...(((memories.data ?? []) as LocationRow[]).map((row) => row.location_name)),
    ...(((events.data ?? []) as LocationRow[]).map((row) => row.location_name)),
    ...(((reservations.data ?? []) as LocationRow[]).map((row) => row.location_name)),
    ...(((expenses.data ?? []) as LocationRow[]).map((row) => row.address_text)),
  ].forEach((value) => {
    const location = normalizeLocation(value);
    if (location) locations.add(location);
  });

  return locations.size;
}

function recentActivityScore(latestActivityAt: string | null, now = new Date()) {
  if (!latestActivityAt) return 0;
  const latest = new Date(latestActivityAt).getTime();
  if (!Number.isFinite(latest)) return 0;

  const days = Math.max(0, (now.getTime() - latest) / (24 * 60 * 60 * 1000));
  if (days <= 2) return 1;
  if (days <= 7) return 0.8;
  if (days <= 14) return 0.6;
  if (days <= 30) return 0.35;
  return 0.15;
}

function maxTimestamp(values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function dateKey(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function countScore(count: number, target: number) {
  if (target <= 0) return 0;
  return clampScore(count / target);
}

export async function summarizeJourneyResources(
  journeyId: string,
  options: StoryRecommendationsOptions,
): Promise<StoryRecommendationResourceSummary> {
  const { supabase } = options;
  const [
    photosCount,
    memoriesCount,
    eventsCount,
    reservationsCount,
    peopleCount,
    expensesCount,
    locationsCount,
    latestMemoryAt,
    latestPhotoAt,
    latestEventAt,
    latestReservationAt,
    latestExpenseAt,
  ] = await Promise.all([
    countRows(
      supabase
        .from("media_assets")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", journeyId)
        .eq("asset_type", "image"),
    ),
    countRows(
      supabase
        .from("memory_entries")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", journeyId),
    ),
    countRows(
      supabase
        .from("itinerary_events")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", journeyId),
    ),
    countRows(
      supabase
        .from("itinerary_reservations")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", journeyId),
    ),
    countRows(
      supabase
        .from("journey_members")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", journeyId)
        .neq("role", "guest"),
    ),
    countRows(
      supabase
        .from("ledger_entries")
        .select("id", { count: "exact", head: true })
        .eq("journey_id", journeyId),
    ),
    countLocations(supabase, journeyId),
    latestTimestamp(
      "captured_at",
      supabase
        .from("memory_entries")
        .select("captured_at")
        .eq("trip_id", journeyId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    latestTimestamp(
      "created_at",
      supabase
        .from("media_assets")
        .select("created_at")
        .eq("trip_id", journeyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    latestTimestamp(
      "updated_at",
      supabase
        .from("itinerary_events")
        .select("updated_at")
        .eq("trip_id", journeyId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    latestTimestamp(
      "updated_at",
      supabase
        .from("itinerary_reservations")
        .select("updated_at")
        .eq("trip_id", journeyId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    latestTimestamp(
      "created_at",
      supabase
        .from("ledger_entries")
        .select("created_at")
        .eq("journey_id", journeyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);
  const latestActivityAt = maxTimestamp([
    latestMemoryAt,
    latestPhotoAt,
    latestEventAt,
    latestReservationAt,
    latestExpenseAt,
  ]);

  return {
    photosCount,
    memoriesCount,
    plannerItemsCount: eventsCount + reservationsCount,
    peopleCount,
    locationsCount,
    expensesCount,
    routeAvailable: locationsCount >= 2 || eventsCount + reservationsCount >= 2,
    latestActivityAt,
    recentActivityScore: recentActivityScore(latestActivityAt),
  };
}

async function countDayLocations(input: {
  supabase: SupabaseClient;
  journeyId: string;
  date: string;
  endDate: string;
}) {
  const [memories, events, reservations, expenses] = await Promise.all([
    input.supabase
      .from("memory_entries")
      .select("location_name")
      .eq("trip_id", input.journeyId)
      .gte("captured_at", `${input.date}T00:00:00`)
      .lt("captured_at", `${input.endDate}T00:00:00`)
      .not("location_name", "is", null)
      .limit(100),
    input.supabase
      .from("itinerary_events")
      .select("location_name")
      .eq("trip_id", input.journeyId)
      .gte("planned_start", `${input.date}T00:00:00`)
      .lt("planned_start", `${input.endDate}T00:00:00`)
      .not("location_name", "is", null)
      .limit(100),
    input.supabase
      .from("itinerary_reservations")
      .select("location_name")
      .eq("trip_id", input.journeyId)
      .gte("starts_at", `${input.date}T00:00:00`)
      .lt("starts_at", `${input.endDate}T00:00:00`)
      .not("location_name", "is", null)
      .limit(100),
    input.supabase
      .from("ledger_entries")
      .select("address_text")
      .eq("journey_id", input.journeyId)
      .eq("expense_date", input.date)
      .not("address_text", "is", null)
      .limit(100),
  ]);

  for (const result of [memories, events, reservations, expenses]) {
    if (result.error) throw result.error;
  }

  const locations = new Set<string>();
  [
    ...(((memories.data ?? []) as LocationRow[]).map((row) => row.location_name)),
    ...(((events.data ?? []) as LocationRow[]).map((row) => row.location_name)),
    ...(((reservations.data ?? []) as LocationRow[]).map((row) => row.location_name)),
    ...(((expenses.data ?? []) as LocationRow[]).map((row) => row.address_text)),
  ].forEach((value) => {
    const location = normalizeLocation(value);
    if (location) locations.add(location);
  });

  return locations.size;
}

async function countDayPhotos(input: {
  supabase: SupabaseClient;
  journeyId: string;
  date: string;
}) {
  const { data, error } = await input.supabase
    .from("media_assets")
    .select("id, taken_at, created_at")
    .eq("trip_id", input.journeyId)
    .eq("asset_type", "image")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  return ((data ?? []) as DatedPhotoRow[]).filter((photo) => {
    const photoDate = dateKey(photo.taken_at) ?? dateKey(photo.created_at);
    return photoDate === input.date;
  }).length;
}

function dayAssessmentReason(input: {
  canCreate: boolean;
  summary: StoryDayResourceSummary;
  language: string;
}) {
  const isZh = input.language === "zh-CN";
  const summary = input.summary;
  if (!input.canCreate) {
    return isZh
      ? "这一天素材还比较少，可以先补充照片、记忆或行程后再创作。"
      : "This day does not have enough material yet. Add photos, memories, or itinerary items first.";
  }

  const parts = [
    summary.photosCount > 0
      ? isZh
        ? `${summary.photosCount} 张照片`
        : `${summary.photosCount} photos`
      : null,
    summary.memoriesCount > 0
      ? isZh
        ? `${summary.memoriesCount} 条记忆`
        : `${summary.memoriesCount} memories`
      : null,
    summary.plannerItemsCount > 0
      ? isZh
        ? `${summary.plannerItemsCount} 个行程`
        : `${summary.plannerItemsCount} itinerary items`
      : null,
    summary.locationsCount > 0
      ? isZh
        ? `${summary.locationsCount} 个地点`
        : `${summary.locationsCount} places`
      : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    return isZh
      ? "这一天有基础素材，可以生成一篇轻量故事。"
      : "This day has enough basic material for a lightweight story.";
  }

  return isZh
    ? `这一天有${parts.join("、")}，适合生成一篇当天故事。`
    : `This day has ${parts.join(", ")}, enough for a day story.`;
}

export async function assessJourneyStoryDay(input: {
  journeyId: string;
  date: string;
  language?: string;
  options: StoryRecommendationsOptions;
}): Promise<StoryDayAssessment> {
  const language = input.language ?? "zh-CN";
  const endDate = nextDate(input.date);
  const { supabase } = input.options;
  const [
    photosCount,
    memoriesCount,
    eventsCount,
    reservationsCount,
    peopleCount,
    expensesCount,
    locationsCount,
    latestMemoryAt,
    latestEventAt,
    latestReservationAt,
    latestExpenseAt,
  ] = await Promise.all([
    countDayPhotos({
      supabase,
      journeyId: input.journeyId,
      date: input.date,
    }),
    countRows(
      supabase
        .from("memory_entries")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", input.journeyId)
        .gte("captured_at", `${input.date}T00:00:00`)
        .lt("captured_at", `${endDate}T00:00:00`),
    ),
    countRows(
      supabase
        .from("itinerary_events")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", input.journeyId)
        .gte("planned_start", `${input.date}T00:00:00`)
        .lt("planned_start", `${endDate}T00:00:00`),
    ),
    countRows(
      supabase
        .from("itinerary_reservations")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", input.journeyId)
        .gte("starts_at", `${input.date}T00:00:00`)
        .lt("starts_at", `${endDate}T00:00:00`),
    ),
    countRows(
      supabase
        .from("journey_members")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", input.journeyId)
        .neq("role", "guest"),
    ),
    countRows(
      supabase
        .from("ledger_entries")
        .select("id", { count: "exact", head: true })
        .eq("journey_id", input.journeyId)
        .eq("expense_date", input.date),
    ),
    countDayLocations({
      supabase,
      journeyId: input.journeyId,
      date: input.date,
      endDate,
    }),
    latestTimestamp(
      "captured_at",
      supabase
        .from("memory_entries")
        .select("captured_at")
        .eq("trip_id", input.journeyId)
        .gte("captured_at", `${input.date}T00:00:00`)
        .lt("captured_at", `${endDate}T00:00:00`)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    latestTimestamp(
      "updated_at",
      supabase
        .from("itinerary_events")
        .select("updated_at")
        .eq("trip_id", input.journeyId)
        .gte("planned_start", `${input.date}T00:00:00`)
        .lt("planned_start", `${endDate}T00:00:00`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    latestTimestamp(
      "updated_at",
      supabase
        .from("itinerary_reservations")
        .select("updated_at")
        .eq("trip_id", input.journeyId)
        .gte("starts_at", `${input.date}T00:00:00`)
        .lt("starts_at", `${endDate}T00:00:00`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
    latestTimestamp(
      "created_at",
      supabase
        .from("ledger_entries")
        .select("created_at")
        .eq("journey_id", input.journeyId)
        .eq("expense_date", input.date)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ),
  ]);
  const latestActivityAt = maxTimestamp([
    latestMemoryAt,
    latestEventAt,
    latestReservationAt,
    latestExpenseAt,
  ]);
  const plannerItemsCount = eventsCount + reservationsCount;
  const summary: StoryDayResourceSummary = {
    date: input.date,
    photosCount,
    memoriesCount,
    plannerItemsCount,
    peopleCount,
    locationsCount,
    expensesCount,
    routeAvailable: locationsCount >= 2 || plannerItemsCount >= 2,
    latestActivityAt,
    recentActivityScore: latestActivityAt ? 1 : 0,
  };
  const score = clampScore(
    countScore(photosCount, 5) * 0.34 +
      countScore(memoriesCount, 4) * 0.28 +
      countScore(plannerItemsCount, 3) * 0.2 +
      countScore(expensesCount, 2) * 0.06 +
      countScore(locationsCount, 2) * 0.08 +
      (latestActivityAt ? 0.04 : 0),
  );
  const hasAnyMaterial =
    photosCount + memoriesCount + plannerItemsCount + expensesCount > 0;
  const canCreate = hasAnyMaterial && score >= 0.12;

  return {
    date: input.date,
    canCreate,
    score,
    reason: dayAssessmentReason({ canCreate, summary, language }),
    resourceSummary: summary,
    supportedIntents: [
      {
        intentKey: "daily_best_moments",
        title: language === "zh-CN" ? "今日最佳瞬间" : "Daily Best Moments",
        templateKey: "memory_shot_daily_best_moments",
        creatable: canCreate,
        comingSoon: false,
      },
    ],
  };
}

function recommendationKey(input: {
  intentKey: string;
  journeyId: string;
  date: string | null;
}) {
  return [
    input.intentKey,
    input.journeyId,
    input.date ?? "anytime",
  ].join(":");
}

export function scoreStoryRecommendationCandidates(input: {
  journeyId: string;
  language: string;
  resourceSummary: StoryRecommendationResourceSummary;
  generatedAt?: string;
}): StoryRecommendationCandidate[] {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const context: StoryRecommendationContext = {
    journeyId: input.journeyId,
    language: input.language,
    today: generatedAt.slice(0, 10),
  };

  return storyRecommendationIntents
    .map((intent) => {
      const scored = intent.score(input.resourceSummary, context);
      if (!scored) return null;
      return {
        intent,
        recommendationKey: recommendationKey({
          intentKey: intent.key,
          journeyId: input.journeyId,
          date: scored.parameters.date,
        }),
        title: intent.title,
        reason: scored.reason,
        score: scored.score,
        payload: scored.parameters,
        metadata: {
          intentKey: intent.key,
          score: scored.score,
          reason: scored.reason,
          parameters: scored.parameters,
          resourceSummary: input.resourceSummary,
          generatedAt,
        },
      };
    })
    .filter((candidate): candidate is StoryRecommendationCandidate =>
      Boolean(candidate),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

async function templateIdsByKey(supabase: SupabaseClient, keys: string[]) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("memory_shot_templates")
    .select("id, key")
    .in("key", uniqueKeys);
  if (error) throw error;

  return new Map(
    ((data ?? []) as Array<{ id: string; key: string }>).map((row) => [
      row.key,
      row.id,
    ]),
  );
}

export async function refreshStoryRecommendations(input: {
  journeyId: string;
  language?: string;
  limit?: number;
  options: StoryRecommendationsOptions;
}): Promise<StoryRecommendationRefreshResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 5));
  const generatedAt = new Date().toISOString();
  const resourceSummary = await summarizeJourneyResources(
    input.journeyId,
    input.options,
  );
  const candidates = scoreStoryRecommendationCandidates({
    journeyId: input.journeyId,
    language: input.language ?? "zh-CN",
    resourceSummary,
    generatedAt,
  }).slice(0, limit);
  const templateIds = await templateIdsByKey(
    input.options.supabase,
    candidates
      .map((candidate) => candidate.payload.templateKey)
      .filter((key): key is string => Boolean(key)),
  );

  const { error: expireError } = await input.options.supabase
    .from("memory_shot_recommendations")
    .update({
      status: "expired",
      metadata: {
        expiredBy: engineName,
        expiredAt: generatedAt,
      },
    })
    .eq("journey_id", input.journeyId)
    .eq("status", "active");
  if (expireError) throw expireError;

  if (candidates.length === 0) {
    return { recommendations: [], resourceSummary, generatedAt };
  }

  const { data, error } = await input.options.supabase
    .from("memory_shot_recommendations")
    .insert(
      candidates.map((candidate) => ({
        journey_id: input.journeyId,
        user_id: null,
        template_id: candidate.payload.templateKey
          ? templateIds.get(candidate.payload.templateKey) ?? null
          : null,
        recommendation_key: candidate.recommendationKey,
        title: candidate.title,
        reason: candidate.reason,
        score: candidate.score,
        status: "active",
        payload: candidate.payload,
        metadata: {
          ...candidate.metadata,
          engine: engineName,
          refreshMode: "manual_owner_admin",
        },
      })),
    )
    .select("*")
    .order("score", { ascending: false });

  if (error) throw error;

  return {
    recommendations: ((data ?? []) as RecommendationRow[]).map(mapRecommendation),
    resourceSummary,
    generatedAt,
  };
}

export async function listStoryRecommendations(input: {
  journeyId: string;
  limit?: number;
  options: StoryRecommendationsOptions;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 5, 20));
  const { data, error } = await input.options.supabase
    .from("memory_shot_recommendations")
    .select("*")
    .eq("journey_id", input.journeyId)
    .eq("status", "active")
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as RecommendationRow[]).map(mapRecommendation);
}

export type {
  StoryRecommendationCandidate,
  StoryRecommendationIntent,
  StoryRecommendationIntentKey,
  StoryRecommendationRefreshResult,
  StoryRecommendationResourceSummary,
} from "./types";
