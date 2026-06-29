import type { NextRequest } from "next/server";

type GeocodeResult = {
  latitude: number;
  longitude: number;
};

type NominatimResult = {
  lat: string;
  lon: string;
};

type PhotonFeature = {
  geometry?: {
    coordinates?: [number, number];
  };
};

type PhotonResult = {
  features?: PhotonFeature[];
};

const userAgent =
  process.env.GEOCODING_USER_AGENT ??
  "OTR Journey geocoder (https://otr-iota.vercel.app/)";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function validCoordinates(latitude: number, longitude: number): GeocodeResult | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

async function geocodeWithNominatim(query: string, signal: AbortSignal) {
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
        "User-Agent": userAgent,
      },
      signal,
    },
  ).catch(() => null);
  if (!response?.ok) return null;

  const results = (await response.json().catch(() => [])) as NominatimResult[];
  const first = results[0];
  if (!first) return null;
  return validCoordinates(Number(first.lat), Number(first.lon));
}

async function geocodeWithPhoton(query: string, signal: AbortSignal) {
  const params = new URLSearchParams({ limit: "1", q: query });
  const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
    headers: { "Accept-Language": "en", "User-Agent": userAgent },
    signal,
  }).catch(() => null);
  if (!response?.ok) return null;

  const result = (await response.json().catch(() => null)) as PhotonResult | null;
  const coordinates = result?.features?.[0]?.geometry?.coordinates;
  if (!coordinates) return null;
  return validCoordinates(Number(coordinates[1]), Number(coordinates[0]));
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 3) {
    return jsonError("Missing geocode query.", 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const coordinates =
      (await geocodeWithNominatim(query, controller.signal)) ??
      (await geocodeWithPhoton(query, controller.signal));

    if (!coordinates) return jsonError("No coordinates found.", 404);
    return Response.json(coordinates);
  } finally {
    clearTimeout(timeout);
  }
}
