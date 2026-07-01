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
  preview_url: string | null;
  thumbnail_url: string | null;
  provider_thumbnail_url: string | null;
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

function fallbackSections(snapshot: CollectedJourneyDayData) {
  const sections = [
    snapshot.memories.length > 0
      ? `Captured ${snapshot.memories.length} journey moments.`
      : null,
    snapshot.photos.length > 0
      ? `Collected ${snapshot.photos.length} photos from the day.`
      : null,
    snapshot.plannerItems.length > 0
      ? `Planned ${snapshot.plannerItems.length} itinerary items.`
      : null,
    snapshot.locations.length > 0
      ? `Moved through ${snapshot.locations.slice(0, 3).join(", ")}.`
      : null,
  ].filter((section): section is string => Boolean(section));

  return sections.length > 0
    ? sections
    : ["A quiet travel day was saved for this Journey."];
}

function parseGeneratedContent(content: string, snapshot: CollectedJourneyDayData) {
  try {
    const trimmed = content.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const parsed = JSON.parse(fenced ? fenced[1] : trimmed) as Record<string, unknown>;
    const sections = asStringArray(parsed.sections).slice(0, 6);
    return {
      title: compactText(String(parsed.title ?? ""), "Daily Best Moments"),
      subtitle: compactText(String(parsed.subtitle ?? ""), ""),
      sections: sections.length > 0 ? sections : fallbackSections(snapshot),
      raw: parsed,
      parseFallbackUsed: false,
    };
  } catch {
    return {
      title: "Daily Best Moments",
      subtitle: "Generated from your Journey moments.",
      sections: fallbackSections(snapshot),
      raw: { text: content },
      parseFallbackUsed: true,
    };
  }
}

function htmlPreview(input: {
  title: string;
  subtitle: string;
  sections: string[];
  date: string;
}) {
  const sections = input.sections
    .map((section) => `<li>${escapeHtml(section)}</li>`)
    .join("");
  return [
    '<article class="memory-shot memory-shot-daily-best-moments">',
    `<p class="memory-shot-date">${escapeHtml(input.date)}</p>`,
    `<h1>${escapeHtml(input.title)}</h1>`,
    input.subtitle ? `<p>${escapeHtml(input.subtitle)}</p>` : "",
    sections ? `<ul>${sections}</ul>` : "",
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
        "id, memory_entry_id, preview_url, thumbnail_url, provider_thumbnail_url, taken_at, scene_tags, ai_metadata, created_at",
      )
      .eq("trip_id", trip.id)
      .eq("asset_type", "image")
      .order("created_at", { ascending: false })
      .limit(24),
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
  const photos = ((photosResult.data ?? []) as MediaAssetRow[]).map((photo) => ({
    id: photo.id,
    memoryEntryId: photo.memory_entry_id,
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
      maxTokens: 900,
      messages: [
        {
          role: "system",
          content:
            "You generate compact JSON for OTR Memory Shots. Use only provided Journey data. Return JSON with title, subtitle, and sections as an array of strings.",
        },
        { role: "user", content: prompt.renderedPrompt },
      ],
    });
    const parsed = parseGeneratedContent(generated.content, snapshot);
    const preview = htmlPreview({
      title: parsed.title,
      subtitle: parsed.subtitle,
      sections: parsed.sections,
      date,
    });
    const content = buildMemoryShotContent({
      title: parsed.title,
      subtitle: parsed.subtitle,
      sections: parsed.sections,
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
