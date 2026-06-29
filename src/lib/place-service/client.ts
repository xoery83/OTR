import { supabase } from "@/lib/supabase/client";

export type ResolveJourneyLocationsSummary = {
  total: number;
  attempted: number;
  resolved: number;
  failed: number;
  ambiguous: number;
  skipped: number;
  results?: Array<{
    status: "none" | "pending" | "resolving" | "resolved" | "ambiguous" | "failed" | "manual";
    itemType: string;
    itemId: string;
    title?: string;
    locationText?: string;
    error?: string | null;
  }>;
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function resolveJourneyLocationsClient(
  journeyId: string,
  options: { force?: boolean; limit?: number } = {},
) {
  const response = await fetch("/api/locations/resolve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      journeyId,
      force: Boolean(options.force),
      limit: options.limit ?? 20,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Location resolve failed.");
  }

  return (await response.json()) as ResolveJourneyLocationsSummary;
}

export async function resolveLocationItemClient(input: {
  journeyId: string;
  itemType: string;
  itemId: string;
  force?: boolean;
}) {
  const response = await fetch("/api/locations/resolve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      journeyId: input.journeyId,
      itemType: input.itemType,
      itemId: input.itemId,
      force: input.force ?? true,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Location resolve failed.");
  }

  return response.json() as Promise<{
    status: "none" | "pending" | "resolving" | "resolved" | "ambiguous" | "failed" | "manual";
    itemType: string;
    itemId: string;
    title?: string;
    locationText?: string;
    error?: string | null;
  }>;
}

export async function manualPinLocationClient(input: {
  journeyId: string;
  itemType: string;
  itemId: string;
  locationText: string;
  title: string;
  latitude: number;
  longitude: number;
}) {
  const response = await fetch("/api/locations/manual-pin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Manual pin failed.");
  }

  return response.json() as Promise<{
    placeId: string | null;
    coordinates: { latitude: number; longitude: number };
  }>;
}
