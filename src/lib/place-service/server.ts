import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Coordinates } from "@/lib/geo";
import type { Trip } from "@/types";

export type LocationStatus =
  | "none"
  | "pending"
  | "resolving"
  | "resolved"
  | "ambiguous"
  | "failed"
  | "manual";

export type LocatableItemType =
  | "itinerary_reservation"
  | "itinerary_event"
  | "memory"
  | "ledger_entry"
  | "media_asset";

export type LocatableItem = {
  itemType: LocatableItemType;
  itemId: string;
  sourceItemType?: string | null;
  sourceItemId?: string | null;
  ownerUserId?: string | null;
  journeyId: string;
  title: string;
  locationText: string;
  locationStatus: LocationStatus;
  locationLat: number | null;
  locationLng: number | null;
  geocodedAt: string | null;
  geocodeError: string | null;
  geocodeAttempts: number;
  manualLocation: boolean;
  timestamp: string | null;
  mapType: string;
};

type PlaceRow = {
  id: string;
  normalized_name: string;
  display_name: string | null;
  formatted_address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  provider: string | null;
  provider_place_id: string | null;
  confidence: number | string | null;
  source: string | null;
  raw_query: string | null;
  raw_response: Record<string, unknown> | null;
};

type PlaceCandidate = {
  displayName: string;
  formattedAddress: string | null;
  coordinates: Coordinates;
  provider: string;
  providerPlaceId: string | null;
  confidence: number;
  source: string;
  rawQuery: string;
  rawResponse: unknown;
  country?: string | null;
  city?: string | null;
  region?: string | null;
};

type ResolveContext = {
  journeyId: string;
  destination: string;
  countryHint: string | null;
  cityHint: string | null;
};

export type ResolveLocationResult = {
  status: LocationStatus;
  itemType: LocatableItemType;
  itemId: string;
  title?: string;
  locationText?: string;
  coordinates: Coordinates | null;
  placeId: string | null;
  provider: string | null;
  providerPlaceId: string | null;
  displayName: string | null;
  formattedAddress: string | null;
  error: string | null;
};

type ResolveJourneySummary = {
  total: number;
  attempted: number;
  resolved: number;
  failed: number;
  ambiguous: number;
  skipped: number;
  results: ResolveLocationResult[];
};

const resolutionStatuses: LocationStatus[] = [
  "pending",
  "failed",
  "none",
  "ambiguous",
];

const staleFailureMs = 7 * 24 * 60 * 60 * 1000;

function envFlag(name: string, defaultValue: boolean) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value === "true" || value === "1";
}

export function getSupabaseForRequest(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }
  if (!authorization) {
    throw new Error("Missing authorization header.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getPlaceServiceSupabaseForRequest(
  request: Request,
  journeyId: string,
) {
  const userClient = getSupabaseForRequest(request);
  const { error } = await userClient
    .from("trips")
    .select("id")
    .eq("id", journeyId)
    .single();
  if (error) throw error;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return userClient;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getAuthenticatedUserIdForRequest(request: Request) {
  const userClient = getSupabaseForRequest(request);
  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;
  return data.user?.id ?? null;
}

function normalizeLocationText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s,'&.-]/gu, " ")
    .replace(/\s+/g, " ");
}

function compact(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") || null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function numberValue(value: unknown) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function validCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  const lat = numberValue(latitude);
  const lng = numberValue(longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

function inferCountryHint(destination: string) {
  const normalized = normalizeLocationText(destination);
  if (normalized.includes("france") || normalized.includes("法国")) return "France";
  if (normalized.includes("faroe") || normalized.includes("法罗")) return "Faroe Islands";
  if (normalized.includes("greenland") || normalized.includes("格陵兰")) return "Greenland";
  if (normalized.includes("iceland") || normalized.includes("冰岛")) return "Iceland";
  if (normalized.includes("new zealand") || normalized.includes("auckland")) {
    return "New Zealand";
  }
  if (normalized.includes("italy") || normalized.includes("courmayeur")) return "Italy";
  if (normalized.includes("switzerland") || normalized.includes("瑞士")) return "Switzerland";
  return null;
}

function inferCityHint(destination: string) {
  const normalized = normalizeLocationText(destination);
  if (normalized.includes("chamonix")) return "Chamonix";
  if (normalized.includes("bourg-saint-maurice")) return "Bourg-Saint-Maurice";
  if (normalized.includes("ilulissat")) return "Ilulissat";
  if (normalized.includes("reykjavik")) return "Reykjavik";
  if (normalized.includes("torshavn")) return "Torshavn";
  if (normalized.includes("auckland")) return "Auckland";
  return null;
}

function contextFromTrip(trip: Trip): ResolveContext {
  const destination = `${trip.name} ${trip.destination}`.trim();
  return {
    journeyId: trip.id,
    destination,
    countryHint: inferCountryHint(destination),
    cityHint: inferCityHint(destination),
  };
}

function buildQueries(locationText: string, context: ResolveContext) {
  const queries = new Set<string>();
  const trimmed = locationText.trim();
  queries.add(trimmed);
  if (context.cityHint && !normalizeLocationText(trimmed).includes(normalizeLocationText(context.cityHint))) {
    queries.add(`${trimmed}, ${context.cityHint}`);
  }
  if (context.countryHint && !normalizeLocationText(trimmed).includes(normalizeLocationText(context.countryHint))) {
    queries.add(`${trimmed}, ${context.countryHint}`);
  }
  if (context.destination) {
    queries.add(`${trimmed}, ${context.destination}`);
  }
  return [...queries].filter((query) => query.length >= 3);
}

function shouldRetry(item: LocatableItem, force: boolean) {
  if (force) return true;
  if (item.manualLocation) return false;
  if (item.locationLat !== null && item.locationLng !== null) return false;
  if (!resolutionStatuses.includes(item.locationStatus)) return false;
  if (item.locationStatus !== "failed") return true;
  if (!item.geocodedAt) return true;
  return Date.now() - new Date(item.geocodedAt).getTime() > staleFailureMs;
}

function sourceTypeForItem(itemType: LocatableItemType) {
  if (itemType === "memory") return "memory";
  if (itemType === "media_asset") return "media_asset";
  return itemType;
}

function sourceTypeForMapObject(item: LocatableItem) {
  return item.sourceItemType ?? sourceTypeForItem(item.itemType);
}

function sourceIdForMapObject(item: LocatableItem) {
  return item.sourceItemId ?? item.itemId;
}

function mapTypeForReservation(type: string | null) {
  if (type === "hotel") return "hotel";
  if (type === "restaurant") return "restaurant";
  if (type === "car") return "booking";
  if (type === "flight") return "airport";
  return "booking";
}

function mapTypeForEvent(type: string | null) {
  if (type === "meal") return "restaurant";
  if (type === "transport") return "route_point";
  if (type === "flight") return "airport";
  return "plan_item";
}

function isFlightItem(item: LocatableItem) {
  return item.mapType === "airport" || /\bflight\b|航班/i.test(item.title);
}

async function getJourney(supabase: SupabaseClient, journeyId: string) {
  const { data, error } = await supabase
    .from("trips")
    .select("id, name, destination, start_date, end_date, cover_image_url, created_at, created_by")
    .eq("id", journeyId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    name: data.name,
    destination: data.destination,
    startDate: data.start_date,
    endDate: data.end_date,
    coverImageUrl: data.cover_image_url,
    createdAt: data.created_at,
    createdBy: data.created_by,
  } satisfies Trip;
}

async function getPlaceFromCache(
  supabase: SupabaseClient,
  locationText: string,
  context: ResolveContext,
) {
  const normalized = normalizeLocationText(locationText);
  let query = supabase
    .from("places")
    .select("*")
    .eq("normalized_name", normalized)
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("confidence", { ascending: false })
    .limit(5);
  if (context.countryHint) query = query.or(`country.is.null,country.ilike.%${context.countryHint}%`);
  const { data, error } = await query;
  if (error) return null;
  const rows = (data ?? []) as PlaceRow[];
  const row = rows.find((place) => Number(place.confidence ?? 0) >= 0.8) ?? null;
  const coordinates = row ? validCoordinates(row.lat, row.lng) : null;
  if (!row || !coordinates) return null;
  return {
    placeId: row.id,
    candidate: {
      displayName: row.display_name ?? row.formatted_address ?? locationText,
      formattedAddress: row.formatted_address,
      coordinates,
      provider: row.provider ?? "cache",
      providerPlaceId: row.provider_place_id,
      confidence: Number(row.confidence ?? 0.8),
      source: row.source ?? "cache",
      rawQuery: row.raw_query ?? locationText,
      rawResponse: row.raw_response,
      country: row.country,
      city: row.city,
      region: row.region,
    } satisfies PlaceCandidate,
  };
}

async function savePlace(
  supabase: SupabaseClient,
  locationText: string,
  candidate: PlaceCandidate,
) {
  const normalized = normalizeLocationText(locationText);
  const existing = await getPlaceFromCache(supabase, locationText, {
    journeyId: "",
    destination: "",
    countryHint: candidate.country ?? null,
    cityHint: candidate.city ?? null,
  });
  if (existing?.placeId) return existing.placeId;

  const { data, error } = await supabase
    .from("places")
    .insert({
      normalized_name: normalized,
      display_name: candidate.displayName,
      formatted_address: candidate.formattedAddress,
      city: candidate.city ?? null,
      region: candidate.region ?? null,
      country: candidate.country ?? null,
      lat: candidate.coordinates.latitude,
      lng: candidate.coordinates.longitude,
      provider: candidate.provider,
      provider_place_id: candidate.providerPlaceId,
      confidence: candidate.confidence,
      source: candidate.source,
      raw_query: candidate.rawQuery,
      raw_response:
        candidate.rawResponse && typeof candidate.rawResponse === "object"
          ? candidate.rawResponse
          : { value: candidate.rawResponse },
      last_verified_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    const { data: fallback } = await supabase
      .from("places")
      .select("id")
      .eq("normalized_name", normalized)
      .limit(1)
      .maybeSingle();
    return fallback?.id ?? null;
  }
  return data.id as string;
}

async function geocodeGooglePlaces(query: string, signal: AbortSignal) {
  if (!envFlag("ENABLE_GOOGLE_PLACES", true)) return null;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ query, key });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`,
    { signal },
  ).catch(() => null);
  if (!response) return null;
  const json = await response.json().catch(() => null) as {
    status?: string;
    results?: Array<{
      name?: string;
      formatted_address?: string;
      place_id?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
    error_message?: string;
  } | null;
  if (!json || json.status !== "OK") return null;
  const first = json.results?.[0];
  const coordinates = validCoordinates(first?.geometry?.location?.lat, first?.geometry?.location?.lng);
  if (!first || !coordinates) return null;
  return {
    displayName: first.name ?? query,
    formattedAddress: first.formatted_address ?? null,
    coordinates,
    provider: "google_places",
    providerPlaceId: first.place_id ?? null,
    confidence: 0.9,
    source: "google_places_text_search",
    rawQuery: query,
    rawResponse: json,
  } satisfies PlaceCandidate;
}

async function geocodeGoogle(query: string, signal: AbortSignal) {
  if (!envFlag("ENABLE_GOOGLE_GEOCODING", true)) return null;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ address: query, key });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
    { signal },
  ).catch(() => null);
  if (!response) return null;
  const json = await response.json().catch(() => null) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      place_id?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
      address_components?: Array<{ long_name?: string; types?: string[] }>;
    }>;
    error_message?: string;
  } | null;
  if (!json || json.status !== "OK") return null;
  const first = json.results?.[0];
  const coordinates = validCoordinates(first?.geometry?.location?.lat, first?.geometry?.location?.lng);
  if (!first || !coordinates) return null;
  return {
    displayName: first.formatted_address ?? query,
    formattedAddress: first.formatted_address ?? null,
    coordinates,
    provider: "google_geocoding",
    providerPlaceId: first.place_id ?? null,
    confidence: 0.85,
    source: "google_geocoding",
    rawQuery: query,
    rawResponse: json,
  } satisfies PlaceCandidate;
}

async function geocodeMapbox(query: string, signal: AbortSignal) {
  if (!envFlag("ENABLE_MAPBOX_GEOCODING", true)) return null;
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return null;
  const params = new URLSearchParams({
    access_token: token,
    limit: "1",
    language: "en",
  });
  const response = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`,
    { signal },
  ).catch(() => null);
  if (!response?.ok) return null;
  const json = await response.json().catch(() => null) as {
    features?: Array<{
      id?: string;
      text?: string;
      place_name?: string;
      center?: [number, number];
      relevance?: number;
    }>;
  } | null;
  const first = json?.features?.[0];
  const coordinates = first?.center
    ? validCoordinates(first.center[1], first.center[0])
    : null;
  if (!first || !coordinates) return null;
  return {
    displayName: first.text ?? first.place_name ?? query,
    formattedAddress: first.place_name ?? null,
    coordinates,
    provider: "mapbox",
    providerPlaceId: first.id ?? null,
    confidence: Math.max(0.6, Math.min(0.82, first.relevance ?? 0.8)),
    source: "mapbox_geocoding",
    rawQuery: query,
    rawResponse: json,
  } satisfies PlaceCandidate;
}

async function geocodeNominatim(query: string, signal: AbortSignal) {
  if (!envFlag("ENABLE_NOMINATIM", true)) return null;
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    q: query,
  });
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: {
        "Accept-Language": "en",
        "User-Agent":
          process.env.GEOCODING_USER_AGENT ??
          "OTR Journey geocoder (https://otr-iota.vercel.app/)",
      },
      signal,
    },
  ).catch(() => null);
  if (!response?.ok) return null;
  const results = await response.json().catch(() => []) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
    place_id?: number | string;
  }>;
  const first = results[0];
  const coordinates = validCoordinates(first?.lat, first?.lon);
  if (!first || !coordinates) return null;
  return {
    displayName: first.display_name ?? query,
    formattedAddress: first.display_name ?? null,
    coordinates,
    provider: "nominatim",
    providerPlaceId: first.place_id ? String(first.place_id) : null,
    confidence: 0.75,
    source: "nominatim",
    rawQuery: query,
    rawResponse: first,
  } satisfies PlaceCandidate;
}

async function llmNormalizeQueries(locationText: string, context: ResolveContext, signal: AbortSignal) {
  if (!envFlag("ENABLE_LLM_LOCATION_NORMALIZATION", false)) return [];
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LOCATION_NORMALIZATION_MODEL ?? "gpt-4.1-mini",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Normalize travel place text into geocoder queries. Do not output coordinates. Return JSON with normalized_queries array.",
        },
        {
          role: "user",
          content: JSON.stringify({
            location_text: locationText,
            journey_destination: context.destination,
            country_hint: context.countryHint,
            city_hint: context.cityHint,
          }),
        },
      ],
    }),
    signal,
  }).catch(() => null);
  if (!response?.ok) return [];
  const json = await response.json().catch(() => null) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  try {
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return [];
    const parsed = JSON.parse(content) as { normalized_queries?: unknown };
    return Array.isArray(parsed.normalized_queries)
      ? parsed.normalized_queries.filter((query): query is string => typeof query === "string")
      : [];
  } catch {
    return [];
  }
}

async function geocodeQueries(queries: string[], signal: AbortSignal) {
  for (const query of queries) {
    const providers = [
      geocodeGooglePlaces,
      geocodeGoogle,
      geocodeMapbox,
      geocodeNominatim,
    ];
    for (const provider of providers) {
      const result = await provider(query, signal);
      if (result && result.confidence >= 0.75) return result;
    }
  }
  return null;
}

async function markItemResolving(supabase: SupabaseClient, item: LocatableItem) {
  await updateItemLocation(supabase, item, {
    location_status: "resolving",
    geocode_attempts: item.geocodeAttempts + 1,
  });
}

async function updateItemLocation(
  supabase: SupabaseClient,
  item: LocatableItem,
  patch: Record<string, unknown>,
) {
  const table = tableForItem(item.itemType);
  const { error } = await supabase.from(table).update(patch).eq("id", item.itemId);
  if (error) throw error;
}

function tableForItem(itemType: LocatableItemType) {
  if (itemType === "itinerary_reservation") return "itinerary_reservations";
  if (itemType === "itinerary_event") return "itinerary_events";
  if (itemType === "memory") return "memory_entries";
  if (itemType === "ledger_entry") return "ledger_entries";
  return "media_assets";
}

async function upsertMapObject(
  supabase: SupabaseClient,
  item: LocatableItem,
  candidate: PlaceCandidate,
  placeId: string | null,
) {
  const now = new Date().toISOString();
  const payload = {
    journey_id: item.journeyId,
    type: item.mapType,
    source_type: sourceTypeForMapObject(item),
    source_id: sourceIdForMapObject(item),
    title: item.title,
    description: candidate.formattedAddress,
    latitude: candidate.coordinates.latitude,
    longitude: candidate.coordinates.longitude,
    timestamp: item.timestamp,
    owner_user_id: item.ownerUserId ?? null,
    visibility: "journey",
    metadata: { provider: candidate.provider, confidence: candidate.confidence },
    location_text: item.locationText,
    location_status: "resolved",
    place_id: placeId,
    location_provider: candidate.provider,
    location_provider_place_id: candidate.providerPlaceId,
    geocoded_at: now,
    geocode_error: null,
  };
  const existing = await supabase
    .from("journey_map_objects")
    .select("id")
    .eq("journey_id", item.journeyId)
    .eq("source_type", sourceTypeForMapObject(item))
    .eq("source_id", sourceIdForMapObject(item))
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    const { error } = await supabase
      .from("journey_map_objects")
      .update(payload)
      .eq("id", existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("journey_map_objects").insert(payload);
    if (error) throw error;
  }
}

async function applyResolvedPlace(
  supabase: SupabaseClient,
  item: LocatableItem,
  candidate: PlaceCandidate,
  placeId: string | null,
) {
  const now = new Date().toISOString();
  await updateItemLocation(supabase, item, {
    location_text: item.locationText,
    location_lat: candidate.coordinates.latitude,
    location_lng: candidate.coordinates.longitude,
    location_status: "resolved",
    place_id: placeId,
    location_provider: candidate.provider,
    location_provider_place_id: candidate.providerPlaceId,
    geocoded_at: now,
    geocode_error: null,
    location_confidence: candidate.confidence,
    ...(item.itemType === "ledger_entry"
      ? {
          latitude: candidate.coordinates.latitude,
          longitude: candidate.coordinates.longitude,
          location_source: candidate.provider,
        }
      : {}),
  });
  await upsertMapObject(supabase, item, candidate, placeId);
}

async function markFailed(
  supabase: SupabaseClient,
  item: LocatableItem,
  status: "failed" | "ambiguous",
  error: string,
) {
  await updateItemLocation(supabase, item, {
    location_status: status,
    geocoded_at: new Date().toISOString(),
    geocode_error: error,
  });
}

export async function resolveLocationItem(
  supabase: SupabaseClient,
  item: LocatableItem,
  context: ResolveContext,
  options: { force?: boolean } = {},
): Promise<ResolveLocationResult> {
  if (isFlightItem(item)) {
    return {
      status: "none",
      itemType: item.itemType,
      itemId: item.itemId,
      coordinates: null,
      placeId: null,
      provider: null,
      providerPlaceId: null,
      displayName: null,
      formattedAddress: null,
      error: "flight_items_do_not_render_on_map",
    };
  }
  const existingCoordinates = validCoordinates(item.locationLat, item.locationLng);
  if (existingCoordinates) {
    const candidate: PlaceCandidate = {
      displayName: item.title,
      formattedAddress: item.locationText || null,
      coordinates: existingCoordinates,
      provider: item.manualLocation ? "manual" : "existing",
      providerPlaceId: null,
      confidence: item.manualLocation ? 0.95 : 0.9,
      source: item.manualLocation ? "manual" : "existing_coordinates",
      rawQuery: item.locationText || item.title,
      rawResponse: { existingCoordinates: true },
    };
    await applyResolvedPlace(supabase, item, candidate, null);
    return {
      status: item.manualLocation ? "manual" : "resolved",
      itemType: item.itemType,
      itemId: item.itemId,
      coordinates: existingCoordinates,
      placeId: null,
      provider: "existing",
      providerPlaceId: null,
      displayName: item.title,
      formattedAddress: item.locationText,
      error: null,
    };
  }

  if (!shouldRetry(item, Boolean(options.force))) {
    return {
      status: "none",
      itemType: item.itemType,
      itemId: item.itemId,
      coordinates: null,
      placeId: null,
      provider: null,
      providerPlaceId: null,
      displayName: null,
      formattedAddress: null,
      error: "skipped",
    };
  }

  await markItemResolving(supabase, item);
  const cached = await getPlaceFromCache(supabase, item.locationText, context);
  if (cached?.candidate) {
    await applyResolvedPlace(supabase, item, cached.candidate, cached.placeId);
    return {
      status: "resolved",
      itemType: item.itemType,
      itemId: item.itemId,
      coordinates: cached.candidate.coordinates,
      placeId: cached.placeId,
      provider: cached.candidate.provider,
      providerPlaceId: cached.candidate.providerPlaceId,
      displayName: cached.candidate.displayName,
      formattedAddress: cached.candidate.formattedAddress,
      error: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16000);
  try {
    const queries = buildQueries(item.locationText, context);
    let candidate = await geocodeQueries(queries, controller.signal);
    if (!candidate) {
      const enhancedQueries = await llmNormalizeQueries(
        item.locationText,
        context,
        controller.signal,
      );
      candidate = await geocodeQueries(enhancedQueries, controller.signal);
      if (candidate) candidate.confidence = Math.min(candidate.confidence, 0.8);
    }
    if (!candidate) {
      await markFailed(supabase, item, "failed", "ZERO_RESULTS");
      return {
        status: "failed",
        itemType: item.itemType,
        itemId: item.itemId,
        coordinates: null,
        placeId: null,
        provider: null,
        providerPlaceId: null,
        displayName: null,
        formattedAddress: null,
        error: "ZERO_RESULTS",
      };
    }
    if (candidate.confidence < 0.75) {
      await markFailed(supabase, item, "ambiguous", "LOW_CONFIDENCE");
      return {
        status: "ambiguous",
        itemType: item.itemType,
        itemId: item.itemId,
        coordinates: candidate.coordinates,
        placeId: null,
        provider: candidate.provider,
        providerPlaceId: candidate.providerPlaceId,
        displayName: candidate.displayName,
        formattedAddress: candidate.formattedAddress,
        error: "LOW_CONFIDENCE",
      };
    }
    const placeId = await savePlace(supabase, item.locationText, candidate);
    await applyResolvedPlace(supabase, item, candidate, placeId);
    return {
      status: "resolved",
      itemType: item.itemType,
      itemId: item.itemId,
      coordinates: candidate.coordinates,
      placeId,
      provider: candidate.provider,
      providerPlaceId: candidate.providerPlaceId,
      displayName: candidate.displayName,
      formattedAddress: candidate.formattedAddress,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    await markFailed(supabase, item, "failed", message);
    return {
      status: "failed",
      itemType: item.itemType,
      itemId: item.itemId,
      coordinates: null,
      placeId: null,
      provider: null,
      providerPlaceId: null,
      displayName: null,
      formattedAddress: null,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function mapReservationRow(row: Record<string, unknown>): LocatableItem {
  return {
    itemType: "itinerary_reservation",
    itemId: String(row.id),
    journeyId: String(row.trip_id),
    ownerUserId: row.created_by ? String(row.created_by) : null,
    title: String(row.title ?? "Reservation"),
    locationText: firstText(row.location_text, row.location_name),
    locationStatus: (row.location_status as LocationStatus | null) ?? "none",
    locationLat: numberValue(row.location_lat),
    locationLng: numberValue(row.location_lng),
    geocodedAt: row.geocoded_at ? String(row.geocoded_at) : null,
    geocodeError: row.geocode_error ? String(row.geocode_error) : null,
    geocodeAttempts: Number(row.geocode_attempts ?? 0),
    manualLocation: Boolean(row.manual_location),
    timestamp: row.starts_at ? String(row.starts_at) : null,
    mapType: mapTypeForReservation(row.reservation_type ? String(row.reservation_type) : null),
  };
}

function mapEventRow(row: Record<string, unknown>): LocatableItem {
  return {
    itemType: "itinerary_event",
    itemId: String(row.id),
    journeyId: String(row.trip_id),
    ownerUserId: row.created_by ? String(row.created_by) : null,
    title: String(row.title ?? "Plan"),
    locationText: firstText(row.location_text, row.location_name),
    locationStatus: (row.location_status as LocationStatus | null) ?? "none",
    locationLat: numberValue(row.location_lat),
    locationLng: numberValue(row.location_lng),
    geocodedAt: row.geocoded_at ? String(row.geocoded_at) : null,
    geocodeError: row.geocode_error ? String(row.geocode_error) : null,
    geocodeAttempts: Number(row.geocode_attempts ?? 0),
    manualLocation: Boolean(row.manual_location),
    timestamp: row.planned_start ? String(row.planned_start) : null,
    mapType: mapTypeForEvent(row.event_type ? String(row.event_type) : null),
  };
}

function mapMemoryRow(row: Record<string, unknown>): LocatableItem {
  return {
    itemType: "memory",
    itemId: String(row.id),
    journeyId: String(row.trip_id),
    ownerUserId: row.user_id ? String(row.user_id) : null,
    title: String(row.content ?? row.location_name ?? "Memory"),
    locationText: firstText(row.location_text, row.location_name),
    locationStatus: (row.location_status as LocationStatus | null) ?? "none",
    locationLat: numberValue(row.location_lat),
    locationLng: numberValue(row.location_lng),
    geocodedAt: row.geocoded_at ? String(row.geocoded_at) : null,
    geocodeError: row.geocode_error ? String(row.geocode_error) : null,
    geocodeAttempts: Number(row.geocode_attempts ?? 0),
    manualLocation: Boolean(row.manual_location),
    timestamp: row.captured_at ? String(row.captured_at) : null,
    mapType: "memory",
  };
}

function mapLedgerRow(row: Record<string, unknown>): LocatableItem {
  return {
    itemType: "ledger_entry",
    itemId: String(row.id),
    journeyId: String(row.journey_id),
    ownerUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    title: String(row.title ?? "Ledger entry"),
    locationText: firstText(row.location_text, row.address_text),
    locationStatus: (row.location_status as LocationStatus | null) ?? "none",
    locationLat: numberValue(row.location_lat ?? row.latitude),
    locationLng: numberValue(row.location_lng ?? row.longitude),
    geocodedAt: row.geocoded_at ? String(row.geocoded_at) : null,
    geocodeError: row.geocode_error ? String(row.geocode_error) : null,
    geocodeAttempts: Number(row.geocode_attempts ?? 0),
    manualLocation: Boolean(row.manual_location),
    timestamp: row.expense_date ? String(row.expense_date) : null,
    mapType: "poi",
  };
}

function mapMediaAssetRow(row: Record<string, unknown>): LocatableItem {
  const memoryEntryId = row.memory_entry_id ? String(row.memory_entry_id) : null;
  return {
    itemType: "media_asset",
    itemId: String(row.id),
    sourceItemType: memoryEntryId ? "memory" : "media_asset",
    sourceItemId: memoryEntryId ?? String(row.id),
    journeyId: String(row.trip_id),
    ownerUserId: row.user_id ? String(row.user_id) : null,
    title: "Photo",
    locationText: firstText(row.location_text),
    locationStatus: (row.location_status as LocationStatus | null) ?? "none",
    locationLat: numberValue(row.location_lat ?? row.gps_latitude),
    locationLng: numberValue(row.location_lng ?? row.gps_longitude),
    geocodedAt: row.geocoded_at ? String(row.geocoded_at) : null,
    geocodeError: row.geocode_error ? String(row.geocode_error) : null,
    geocodeAttempts: Number(row.geocode_attempts ?? 0),
    manualLocation: Boolean(row.manual_location),
    timestamp: row.taken_at ? String(row.taken_at) : row.created_at ? String(row.created_at) : null,
    mapType: "memory",
  };
}

async function fetchLocatableItems(supabase: SupabaseClient, journeyId: string) {
  const [
    reservations,
    events,
    memories,
    ledgers,
    mediaAssets,
  ] = await Promise.all([
    supabase
      .from("itinerary_reservations")
      .select("*")
      .eq("trip_id", journeyId)
      .or("location_text.not.is.null,location_name.not.is.null"),
    supabase
      .from("itinerary_events")
      .select("*")
      .eq("trip_id", journeyId)
      .or("location_text.not.is.null,location_name.not.is.null"),
    supabase
      .from("memory_entries")
      .select("*")
      .eq("trip_id", journeyId)
      .or("location_text.not.is.null,location_name.not.is.null"),
    supabase
      .from("ledger_entries")
      .select("*")
      .eq("journey_id", journeyId)
      .or("location_text.not.is.null,address_text.not.is.null"),
    supabase
      .from("media_assets")
      .select("*")
      .eq("trip_id", journeyId)
      .or("location_text.not.is.null,gps_latitude.not.is.null"),
  ]);

  for (const result of [reservations, events, memories, ledgers, mediaAssets]) {
    if (result.error) throw result.error;
  }

  return [
    ...((reservations.data ?? []) as Record<string, unknown>[]).map(mapReservationRow),
    ...((events.data ?? []) as Record<string, unknown>[]).map(mapEventRow),
    ...((memories.data ?? []) as Record<string, unknown>[]).map(mapMemoryRow),
    ...((ledgers.data ?? []) as Record<string, unknown>[]).map(mapLedgerRow),
    ...((mediaAssets.data ?? []) as Record<string, unknown>[]).map(mapMediaAssetRow),
  ].filter((item) => item.locationText.trim() || validCoordinates(item.locationLat, item.locationLng));
}

async function fetchLocatableItem(
  supabase: SupabaseClient,
  journeyId: string,
  itemType: LocatableItemType,
  itemId: string,
) {
  if (itemType === "itinerary_reservation") {
    const { data, error } = await supabase
      .from("itinerary_reservations")
      .select("*")
      .eq("trip_id", journeyId)
      .eq("id", itemId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapReservationRow(data as Record<string, unknown>) : null;
  }

  if (itemType === "itinerary_event") {
    const { data, error } = await supabase
      .from("itinerary_events")
      .select("*")
      .eq("trip_id", journeyId)
      .eq("id", itemId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapEventRow(data as Record<string, unknown>) : null;
  }

  if (itemType === "memory") {
    const { data, error } = await supabase
      .from("memory_entries")
      .select("*")
      .eq("trip_id", journeyId)
      .eq("id", itemId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapMemoryRow(data as Record<string, unknown>) : null;
  }

  if (itemType === "ledger_entry") {
    const { data, error } = await supabase
      .from("ledger_entries")
      .select("*")
      .eq("journey_id", journeyId)
      .eq("id", itemId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapLedgerRow(data as Record<string, unknown>) : null;
  }

  const { data, error } = await supabase
    .from("media_assets")
    .select("*")
    .eq("trip_id", journeyId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapMediaAssetRow(data as Record<string, unknown>) : null;
}

export async function resolveSingleJourneyLocation(
  supabase: SupabaseClient,
  journeyId: string,
  input: {
    itemType: LocatableItemType;
    itemId: string;
    force?: boolean;
    ownerUserId?: string | null;
  },
) {
  const trip = await getJourney(supabase, journeyId);
  const context = contextFromTrip(trip);
  const item = await fetchLocatableItem(
    supabase,
    journeyId,
    input.itemType,
    input.itemId,
  );
  if (!item) throw new Error("Location item not found.");

  const result = await resolveLocationItem(
    supabase,
    { ...item, ownerUserId: item.ownerUserId ?? input.ownerUserId ?? null },
    context,
    { force: input.force ?? true },
  );
  return {
    ...result,
    title: item.title,
    locationText: item.locationText,
  };
}

export async function resolveJourneyLocations(
  supabase: SupabaseClient,
  journeyId: string,
  options: { force?: boolean; limit?: number; ownerUserId?: string | null } = {},
): Promise<ResolveJourneySummary> {
  const trip = await getJourney(supabase, journeyId);
  const context = contextFromTrip(trip);
  const items = (await fetchLocatableItems(supabase, journeyId)).map((item) => ({
    ...item,
    ownerUserId: item.ownerUserId ?? options.ownerUserId ?? null,
  }));
  const candidates = items.filter((item) => {
    if (shouldRetry(item, Boolean(options.force))) return true;
    return Boolean(options.force && validCoordinates(item.locationLat, item.locationLng));
  });
  const limit = options.limit ?? 20;
  const selected = candidates.slice(0, limit);
  const summary: ResolveJourneySummary = {
    total: candidates.length,
    attempted: 0,
    resolved: 0,
    failed: 0,
    ambiguous: 0,
    skipped: items.length - candidates.length,
    results: [],
  };

  for (const item of selected) {
    const result = await resolveLocationItem(supabase, item, context, options);
    summary.attempted += result.error === "skipped" ? 0 : 1;
    if (result.status === "resolved" || result.status === "manual") summary.resolved += 1;
    if (result.status === "failed") summary.failed += 1;
    if (result.status === "ambiguous") summary.ambiguous += 1;
    summary.results.push({
      ...result,
      title: item.title,
      locationText: item.locationText,
    });
  }

  return summary;
}

export async function applyManualLocation(
  supabase: SupabaseClient,
  input: {
    journeyId: string;
    itemType: LocatableItemType;
    itemId: string;
    locationText: string;
    title: string;
    latitude: number;
    longitude: number;
    ownerUserId?: string | null;
  },
) {
  const coordinates = validCoordinates(input.latitude, input.longitude);
  if (!coordinates) throw new Error("Invalid coordinates.");
  const item: LocatableItem = {
    itemType: input.itemType,
    itemId: input.itemId,
    ownerUserId: input.ownerUserId ?? null,
    journeyId: input.journeyId,
    title: input.title,
    locationText: input.locationText,
    locationStatus: "manual",
    locationLat: coordinates.latitude,
    locationLng: coordinates.longitude,
    geocodedAt: new Date().toISOString(),
    geocodeError: null,
    geocodeAttempts: 0,
    manualLocation: true,
    timestamp: null,
    mapType: "poi",
  };
  const candidate: PlaceCandidate = {
    displayName: input.title,
    formattedAddress: input.locationText,
    coordinates,
    provider: "manual",
    providerPlaceId: null,
    confidence: 0.95,
    source: "manual",
    rawQuery: input.locationText,
    rawResponse: { manual: true },
  };
  const placeId = await savePlace(supabase, input.locationText, candidate);
  await updateItemLocation(supabase, item, {
    location_lat: coordinates.latitude,
    location_lng: coordinates.longitude,
    location_status: "manual",
    place_id: placeId,
    location_provider: "manual",
    location_provider_place_id: null,
    geocoded_at: new Date().toISOString(),
    geocode_error: null,
    manual_location: true,
  });
  await upsertMapObject(supabase, item, candidate, placeId);
  return { placeId, coordinates };
}
