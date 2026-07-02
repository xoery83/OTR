import type { SupabaseClient } from "@supabase/supabase-js";
import { generateChat } from "@/lib/ai/model-router";
import { renderPrompt } from "@/lib/ai/prompt-center";
import {
  addMemoryShotAssets,
  createMemoryShot,
  markMemoryShotReady,
  saveMemoryShotSnapshot,
} from "@/lib/memory-shots";
import type {
  AddMemoryShotAssetInput,
  MemoryShot,
} from "@/lib/memory-shots/types";

type WorkerSupabase = SupabaseClient;

const photoCandidateLimit = 500;

type GenerateDailyBestMomentsInput = {
  supabase: WorkerSupabase;
  journeyId: string;
  userId: string;
  aiJobId: string;
  date?: string | null;
  language?: string | null;
};

type TripRow = {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
};

type MemoryRow = {
  id: string;
  user_id: string | null;
  type: string;
  content: string | null;
  media_url: string | null;
  location_name: string | null;
  captured_at: string;
};

type MediaAssetRow = {
  id: string;
  memory_entry_id: string | null;
  storage_bucket: string | null;
  compressed_file_path: string | null;
  thumbnail_file_path: string | null;
  legacy_supabase_path: string | null;
  legacy_thumbnail_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  provider_thumbnail_url: string | null;
  thumbnail_drive_web_url: string | null;
  taken_at: string | null;
  scene_tags: string[] | null;
  ai_metadata: Record<string, unknown> | null;
  created_at: string;
};

type PlannerItemRow = {
  id: string;
  title: string;
  description?: string | null;
  event_type?: string | null;
  reservation_type?: string | null;
  location_name: string | null;
  planned_start?: string | null;
  starts_at?: string | null;
};

type JourneyMemberRow = {
  id: string;
  display_name: string;
  role: string;
  status: string;
};

type CollectedJourneyDayData = Awaited<ReturnType<typeof collectJourneyDayData>>;

type MemoryShotContent = {
  title: string;
  subtitle: string;
  sections: string[];
  htmlPreview: string;
  storyScript: {
    title: string;
    subtitle: string;
    storyBeats: string[];
    ending: string | null;
    selectedAssetIds: string[];
    heroImageUrl: string | null;
  };
  heroImageUrl: string | null;
  modelInfo: {
    provider: string | null;
    model: string | null;
    promptKey: string;
    promptVersion: string;
    parseFallbackUsed: boolean;
  };
};

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function dateKey(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function compactText(value: string | null | undefined, fallback = "") {
  return (value ?? fallback).replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function compactStoryBeat(value: string) {
  const text = compactText(value);
  return text.length > 155 ? `${text.slice(0, 152).trim()}...` : text;
}

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function photoDisplayUrl(photo: {
  id?: string;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  providerThumbnailUrl?: string | null;
  thumbnailDriveWebUrl?: string | null;
  signedStorageUrl?: string | null;
}) {
  return firstNonEmpty([
    photo.previewUrl,
    photo.thumbnailUrl,
    photo.providerThumbnailUrl,
    photo.thumbnailDriveWebUrl,
    photo.signedStorageUrl,
    photo.id ? `/api/media/assets/${photo.id}/preview` : null,
  ]);
}

function selectedHeroPhoto(
  snapshot: CollectedJourneyDayData,
  selectedAssetIds: string[],
) {
  const selected = snapshot.photos.find(
    (photo) => selectedAssetIds.includes(photo.id) && Boolean(photo.displayUrl),
  );
  return selected ?? snapshot.photos.find((photo) => Boolean(photo.displayUrl)) ?? null;
}

function fallbackSections(snapshot: CollectedJourneyDayData) {
  const place = snapshot.locations[0] ?? snapshot.trip.destination ?? snapshot.trip.name;
  const strongestMemory = snapshot.memories.find((memory) => memory.content)?.content;
  const strongestPlan = snapshot.plannerItems.find((item) => item.title)?.title;
  const sections = [
    strongestMemory
      ? `The day found its shape in ${place}, with ${strongestMemory.toLocaleLowerCase()}.`
      : null,
    strongestPlan
      ? `${strongestPlan} became the marker everyone would remember from this part of the journey.`
      : null,
    snapshot.photos.length > 0
      ? "A few saved frames carried the feeling better than a checklist ever could."
      : null,
    snapshot.people.length > 1
      ? `Shared by ${snapshot.people.slice(0, 3).map((person) => person.displayName).join(", ")}.`
      : null,
  ].filter((section): section is string => Boolean(section));

  return sections.length > 0
    ? sections
    : ["A quiet travel day became a small story worth keeping."];
}

function fallbackTitle(snapshot: CollectedJourneyDayData) {
  const place = snapshot.locations[0] ?? snapshot.trip.destination;
  if (place) return `A Day in ${place}`;
  return "A Day Worth Keeping";
}

function fallbackSubtitle(snapshot: CollectedJourneyDayData) {
  const place = snapshot.locations[0] ?? snapshot.trip.destination ?? snapshot.trip.name;
  return `${snapshot.date}${place ? ` · ${place}` : ""}`;
}

function parseGeneratedContent(content: string, snapshot: CollectedJourneyDayData) {
  try {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const parsed = JSON.parse(fenced ? fenced[1] : trimmed) as Record<string, unknown>;
    const storyBeats = [
      ...asStringArray(parsed.story_beats),
      ...asStringArray(parsed.storyBeats),
      ...asStringArray(parsed.sections),
    ].slice(0, 4);
    const selectedAssetIds = [
      ...asStringArray(parsed.selected_asset_ids),
      ...asStringArray(parsed.selectedAssetIds),
    ].slice(0, 6);
    const ending = compactText(String(parsed.ending ?? parsed.quote ?? ""), "");
    return {
      title: compactText(String(parsed.title ?? ""), fallbackTitle(snapshot)),
      subtitle: compactText(String(parsed.subtitle ?? ""), fallbackSubtitle(snapshot)),
      sections:
        storyBeats.length > 0
          ? storyBeats.map(compactStoryBeat)
          : fallbackSections(snapshot).map(compactStoryBeat),
      ending: ending || null,
      selectedAssetIds,
      raw: parsed,
      parseFallbackUsed: false,
    };
  } catch {
    return {
      title: fallbackTitle(snapshot),
      subtitle: fallbackSubtitle(snapshot),
      sections: fallbackSections(snapshot).map(compactStoryBeat),
      ending: null,
      selectedAssetIds: [],
      raw: { text: content },
      parseFallbackUsed: true,
    };
  }
}

function htmlPreview(input: {
  title: string;
  subtitle: string;
  sections: string[];
  ending: string | null;
  date: string;
  heroImageUrl: string | null;
}) {
  const sections = input.sections
    .map((section) => `<p class="story-beat">${escapeHtml(section)}</p>`)
    .join("");
  return [
    '<article class="otr-story-poster otr-story-daily-best-moments">',
    input.heroImageUrl
      ? `<figure class="story-hero"><img src="${escapeHtml(input.heroImageUrl)}" alt="Story hero image" /></figure>`
      : "",
    '<section class="story-copy">',
    `<p class="story-brand">OTR Journey Story</p>`,
    `<p class="story-date">${escapeHtml(input.date)}</p>`,
    `<h1>${escapeHtml(input.title)}</h1>`,
    input.subtitle ? `<p class="story-subtitle">${escapeHtml(input.subtitle)}</p>` : "",
    sections ? `<div class="story-beats">${sections}</div>` : "",
    input.ending ? `<p class="story-ending">${escapeHtml(input.ending)}</p>` : "",
    "</section>",
    "</article>",
  ].join("");
}

async function updateJob(
  supabase: WorkerSupabase,
  aiJobId: string,
  patch: Record<string, unknown>,
) {
  await supabase.from("ai_jobs").update(patch).eq("id", aiJobId);
}

async function failShot(
  supabase: WorkerSupabase,
  memoryShotId: string | null,
  message: string,
) {
  if (!memoryShotId) return;
  await supabase
    .from("memory_shots")
    .update({ status: "failed", error_message: message })
    .eq("id", memoryShotId);
}

async function loadTrip(supabase: WorkerSupabase, journeyId: string) {
  const { data, error } = await supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date")
    .eq("id", journeyId)
    .single();

  if (error || !data) throw error || new Error("Journey not found.");
  return data as TripRow;
}

async function inferDate(
  supabase: WorkerSupabase,
  trip: TripRow,
  explicitDate?: string | null,
) {
  if (explicitDate) return explicitDate;

  const { data: memory } = await supabase
    .from("memory_entries")
    .select("captured_at")
    .eq("trip_id", trip.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return dateKey((memory as { captured_at?: string } | null)?.captured_at) ??
    trip.start_date ??
    new Date().toISOString().slice(0, 10);
}

function photoStoragePath(photo: MediaAssetRow) {
  return firstNonEmpty([
    photo.thumbnail_file_path,
    photo.legacy_thumbnail_path,
    photo.compressed_file_path,
    photo.legacy_supabase_path,
  ]);
}

async function createSignedPhotoUrls(
  supabase: WorkerSupabase,
  photos: MediaAssetRow[],
) {
  const pathByPhotoId = new Map<string, string>();
  const bucketByPath = new Map<string, string>();

  photos.forEach((photo) => {
    if (
      photo.preview_url ||
      photo.thumbnail_url ||
      photo.provider_thumbnail_url ||
      photo.thumbnail_drive_web_url
    ) {
      return;
    }
    const path = photoStoragePath(photo);
    const bucket = photo.storage_bucket || "trip-media";
    if (!path) return;
    pathByPhotoId.set(photo.id, path);
    bucketByPath.set(path, bucket);
  });

  const urls: Record<string, string> = {};
  const pathsByBucket = [...bucketByPath.entries()].reduce<Record<string, string[]>>(
    (grouped, [path, bucket]) => {
      grouped[bucket] = [...(grouped[bucket] ?? []), path];
      return grouped;
    },
    {},
  );

  await Promise.all(
    Object.entries(pathsByBucket).map(async ([bucket, paths]) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(paths, 60 * 60);
      if (error) return;
      const signedByPath = new Map<string, string>();
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) {
          signedByPath.set(item.path, item.signedUrl);
        }
      }
      for (const [photoId, path] of pathByPhotoId.entries()) {
        const signedUrl = signedByPath.get(path);
        if (signedUrl) urls[photoId] = signedUrl;
      }
    }),
  );

  return urls;
}

async function collectJourneyDayData(
  supabase: WorkerSupabase,
  trip: TripRow,
  date: string,
) {
  const endDate = nextDate(date);
  const [
    memoriesResult,
    photosResult,
    eventsResult,
    reservationsResult,
    membersResult,
  ] = await Promise.all([
    supabase
      .from("memory_entries")
      .select("id, user_id, type, content, media_url, location_name, captured_at")
      .eq("trip_id", trip.id)
      .gte("captured_at", `${date}T00:00:00`)
      .lt("captured_at", `${endDate}T00:00:00`)
      .order("captured_at", { ascending: true })
      .limit(40),
    supabase
      .from("media_assets")
      .select(
        "id, memory_entry_id, storage_bucket, compressed_file_path, thumbnail_file_path, legacy_supabase_path, legacy_thumbnail_path, preview_url, thumbnail_url, provider_thumbnail_url, thumbnail_drive_web_url, taken_at, scene_tags, ai_metadata, created_at",
      )
      .eq("trip_id", trip.id)
      .eq("asset_type", "image")
      .order("created_at", { ascending: false })
      .limit(photoCandidateLimit),
    supabase
      .from("itinerary_events")
      .select("id, title, description, event_type, location_name, planned_start")
      .eq("trip_id", trip.id)
      .gte("planned_start", `${date}T00:00:00`)
      .lt("planned_start", `${endDate}T00:00:00`)
      .order("planned_start", { ascending: true })
      .limit(30),
    supabase
      .from("itinerary_reservations")
      .select("id, title, reservation_type, location_name, starts_at")
      .eq("trip_id", trip.id)
      .gte("starts_at", `${date}T00:00:00`)
      .lt("starts_at", `${endDate}T00:00:00`)
      .order("starts_at", { ascending: true })
      .limit(20),
    supabase
      .from("journey_members")
      .select("id, display_name, role, status")
      .eq("trip_id", trip.id)
      .limit(40),
  ]);

  const memories = ((memoriesResult.data ?? []) as MemoryRow[]).map((memory) => ({
    id: memory.id,
    type: memory.type,
    content: compactText(memory.content),
    locationName: memory.location_name,
    capturedAt: memory.captured_at,
  }));
  const photoRows = ((photosResult.data ?? []) as MediaAssetRow[]).filter(
    (photo) => {
      const photoDate = dateKey(photo.taken_at) ?? dateKey(photo.created_at);
      return photoDate === date;
    },
  );
  const signedPhotoUrls = await createSignedPhotoUrls(supabase, photoRows);
  const photos = photoRows.map((photo) => ({
    id: photo.id,
    memoryEntryId: photo.memory_entry_id,
    previewUrl: photo.preview_url,
    thumbnailUrl: photo.thumbnail_url,
    providerThumbnailUrl: photo.provider_thumbnail_url,
    thumbnailDriveWebUrl: photo.thumbnail_drive_web_url,
    signedStorageUrl: signedPhotoUrls[photo.id] ?? null,
    displayUrl: photoDisplayUrl({
      id: photo.id,
      previewUrl: photo.preview_url,
      thumbnailUrl: photo.thumbnail_url,
      providerThumbnailUrl: photo.provider_thumbnail_url,
      thumbnailDriveWebUrl: photo.thumbnail_drive_web_url,
      signedStorageUrl: signedPhotoUrls[photo.id] ?? null,
    }),
    takenAt: photo.taken_at,
    sceneTags: photo.scene_tags ?? [],
    summary:
      typeof photo.ai_metadata?.summary === "string"
        ? photo.ai_metadata.summary
        : null,
  }));
  const plannerItems = [
    ...((eventsResult.data ?? []) as PlannerItemRow[]).map((item) => ({
      id: item.id,
      type: item.event_type ?? "event",
      title: item.title,
      description: compactText(item.description),
      locationName: item.location_name,
      startsAt: item.planned_start ?? null,
    })),
    ...((reservationsResult.data ?? []) as PlannerItemRow[]).map((item) => ({
      id: item.id,
      type: item.reservation_type ?? "reservation",
      title: item.title,
      description: "",
      locationName: item.location_name,
      startsAt: item.starts_at ?? null,
    })),
  ];
  const people = ((membersResult.data ?? []) as JourneyMemberRow[]).map((member) => ({
    id: member.id,
    displayName: member.display_name,
    role: member.role,
    status: member.status,
  }));
  const locations = [
    ...memories.map((memory) => memory.locationName),
    ...plannerItems.map((item) => item.locationName),
  ].filter((value): value is string => Boolean(value));

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.start_date,
      endDate: trip.end_date,
    },
    date,
    memories,
    photos,
    plannerItems,
    people,
    locations: [...new Set(locations)].slice(0, 20),
  };
}

function buildMemoryShotContent(input: {
  title: string;
  subtitle: string;
  sections: string[];
  ending: string | null;
  selectedAssetIds: string[];
  heroImageUrl: string | null;
  htmlPreview: string;
  provider: string | null;
  model: string | null;
  promptKey: string;
  promptVersion: string;
  parseFallbackUsed: boolean;
}): MemoryShotContent {
  return {
    title: input.title,
    subtitle: input.subtitle,
    sections: input.sections,
    htmlPreview: input.htmlPreview,
    storyScript: {
      title: input.title,
      subtitle: input.subtitle,
      storyBeats: input.sections,
      ending: input.ending,
      selectedAssetIds: input.selectedAssetIds,
      heroImageUrl: input.heroImageUrl,
    },
    heroImageUrl: input.heroImageUrl,
    modelInfo: {
      provider: input.provider,
      model: input.model,
      promptKey: input.promptKey,
      promptVersion: input.promptVersion,
      parseFallbackUsed: input.parseFallbackUsed,
    },
  };
}

function assetsFromSnapshot(snapshot: CollectedJourneyDayData) {
  const assets: AddMemoryShotAssetInput[] = [
    ...snapshot.memories.map((memory, index) => ({
      assetType: "memory" as const,
      sourceId: memory.id,
      role: "source_memory",
      sortOrder: index,
    })),
    ...snapshot.photos.map((photo, index) => ({
      assetType: "photo" as const,
      sourceId: photo.id,
      role: "source_photo",
      sortOrder: index,
    })),
    ...snapshot.plannerItems.map((item, index) => ({
      assetType: "planner_item" as const,
      sourceId: item.id,
      role: "source_planner_item",
      sortOrder: index,
    })),
    ...snapshot.people.map((person, index) => ({
      assetType: "person" as const,
      sourceId: person.id,
      role: "source_person",
      sortOrder: index,
    })),
    ...snapshot.locations.map((location, index) => ({
      assetType: "location" as const,
      sourceId: location,
      role: "source_location",
      sortOrder: index,
    })),
  ];
  return assets.slice(0, 120);
}

export async function runDailyBestMomentsMemoryShotJob(
  input: GenerateDailyBestMomentsInput,
) {
  let memoryShot: MemoryShot | null = null;

  try {
    await updateJob(input.supabase, input.aiJobId, {
      status: "processing",
      started_at: new Date().toISOString(),
      current_step: "Creating Memory Shot",
    });

    const trip = await loadTrip(input.supabase, input.journeyId);
    const date = await inferDate(input.supabase, trip, input.date);
    memoryShot = await createMemoryShot(
      {
        journeyId: input.journeyId,
        templateKey: "daily_best_moments",
        title: "Daily Best Moments",
        language: input.language ?? "en",
        status: "generating",
        visibility: "journey_members",
        metadata: {
          aiJobId: input.aiJobId,
          date,
          templateKey: "memory_shot_daily_best_moments",
        },
      },
      { supabase: input.supabase, userId: input.userId },
    );

    await updateJob(input.supabase, input.aiJobId, {
      current_step: "Collecting Journey day data",
      payload: {
        date,
        memoryShotId: memoryShot.id,
        templateKey: "memory_shot_daily_best_moments",
      },
    });

    const snapshot = await collectJourneyDayData(input.supabase, trip, date);
    await saveMemoryShotSnapshot(
      memoryShot,
      {
        snapshot,
        sourceSummary: {
          memories: snapshot.memories.length,
          photos: snapshot.photos.length,
          plannerItems: snapshot.plannerItems.length,
          people: snapshot.people.length,
          locations: snapshot.locations.length,
        },
        metadata: {
          date,
          templateKey: "memory_shot_daily_best_moments",
        },
      },
      { supabase: input.supabase, userId: input.userId },
    );

    const promptLanguage = input.language ?? "en";
    const prompt = (await renderPrompt(
      "memory_shot_daily_best_moments",
      promptLanguage,
      { journey_data: snapshot },
      { supabase: input.supabase },
    )) ?? (promptLanguage === "en"
      ? null
      : await renderPrompt(
          "memory_shot_daily_best_moments",
          "en",
          { journey_data: snapshot },
          { supabase: input.supabase },
        ));
    if (!prompt) {
      throw new Error(
        `Prompt Center active prompt not found for memory_shot_daily_best_moments (${promptLanguage} or en).`,
      );
    }

    await updateJob(input.supabase, input.aiJobId, {
      current_step: "Generating Memory Shot content",
      prompt_key: prompt.prompt.template.key,
      prompt_version: prompt.prompt.version,
    });

    const generated = await generateChat({
      task: "memory_shot_daily_best_moments",
      responseFormat: "json",
      temperature: 0.2,
      maxTokens: 1100,
      messages: [
        {
          role: "system",
          content:
            "You generate compact JSON Story Scripts for OTR Journey Story posters. Use only provided Journey data. Do not write checklist summaries, ledger amounts, or sensitive spending details. Return JSON with title, subtitle, story_beats, ending, and selected_asset_ids.",
        },
        { role: "user", content: prompt.renderedPrompt },
      ],
    });
    const parsed = parseGeneratedContent(generated.content, snapshot);
    const heroPhoto = selectedHeroPhoto(snapshot, parsed.selectedAssetIds);
    const heroImageUrl = heroPhoto?.displayUrl ?? null;
    const preview = htmlPreview({
      title: parsed.title,
      subtitle: parsed.subtitle,
      sections: parsed.sections,
      ending: parsed.ending,
      date,
      heroImageUrl,
    });
    const content = buildMemoryShotContent({
      title: parsed.title,
      subtitle: parsed.subtitle,
      sections: parsed.sections,
      ending: parsed.ending,
      selectedAssetIds: parsed.selectedAssetIds,
      heroImageUrl,
      htmlPreview: preview,
      provider: generated.router.provider,
      model: generated.router.model,
      promptKey: prompt.prompt.template.key,
      promptVersion: prompt.prompt.version,
      parseFallbackUsed: parsed.parseFallbackUsed,
    });

    await addMemoryShotAssets(memoryShot, assetsFromSnapshot(snapshot), {
      supabase: input.supabase,
      userId: input.userId,
    });
    memoryShot = await markMemoryShotReady(
      memoryShot.id,
      {
        title: parsed.title,
        subtitle: parsed.subtitle,
        content,
        metadata: {
          aiJobId: input.aiJobId,
          date,
          promptKey: prompt.prompt.template.key,
          promptVersion: prompt.prompt.version,
          router: generated.router,
          rawModelOutput: parsed.raw,
        },
      },
      { supabase: input.supabase, userId: input.userId },
    );

    await updateJob(input.supabase, input.aiJobId, {
      status: "completed",
      provider: generated.router.provider,
      model: generated.router.model,
      input_tokens: generated.router.usage.inputTokens,
      output_tokens: generated.router.usage.outputTokens,
      cost_estimate: generated.router.usage.costEstimate,
      result: { memoryShotId: memoryShot.id },
      current_step: "Completed",
      finished_at: new Date().toISOString(),
    });

    return memoryShot;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not generate Memory Shot.";
    await failShot(input.supabase, memoryShot?.id ?? null, message);
    await updateJob(input.supabase, input.aiJobId, {
      status: "failed",
      error_message: message,
      current_step: "Failed",
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}
