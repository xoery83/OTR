import type { Coordinates } from "@/lib/geo";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name?: string;
};

type GeocodeResponse = Partial<Coordinates> & Partial<NominatimResult>;

const cachePrefix = "otr:geocode:";

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function cacheKey(query: string) {
  return `${cachePrefix}${normalizeQuery(query)}`;
}

function readCachedCoordinates(query: string): Coordinates | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(cacheKey(query));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Coordinates;
    if (
      Number.isFinite(parsed.latitude) &&
      Number.isFinite(parsed.longitude)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function writeCachedCoordinates(query: string, coordinates: Coordinates) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(cacheKey(query), JSON.stringify(coordinates));
  } catch {
    // Local cache is optional. The map can still use the resolved coordinates.
  }
}

export async function geocodePlace(
  query: string,
  signal?: AbortSignal,
): Promise<Coordinates | null> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 4) return null;

  const cached = readCachedCoordinates(normalized);
  if (cached) return cached;

  const params = new URLSearchParams({ q: normalized });
  const endpoint = process.env.NEXT_PUBLIC_GEOCODING_BASE_URL ?? "/api/geocode";
  const response = await fetch(`${endpoint}?${params.toString()}`, { signal });
  if (!response.ok) return null;

  const result = (await response.json()) as GeocodeResponse | GeocodeResponse[];
  const first = Array.isArray(result) ? result[0] : result;
  if (!first) return null;

  const latitude = Number(first.latitude ?? first.lat);
  const longitude = Number(first.longitude ?? first.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const coordinates = { latitude, longitude };
  writeCachedCoordinates(normalized, coordinates);
  return coordinates;
}
