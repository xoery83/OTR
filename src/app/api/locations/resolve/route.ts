import type { NextRequest } from "next/server";
import {
  getSupabaseForRequest,
  resolveJourneyLocations,
} from "@/lib/place-service/server";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      journeyId?: string;
      force?: boolean;
      limit?: number;
    } | null;
    const journeyId = body?.journeyId?.trim();
    if (!journeyId) return jsonError("Missing journeyId.", 400);

    const supabase = getSupabaseForRequest(request);
    const summary = await resolveJourneyLocations(supabase, journeyId, {
      force: Boolean(body?.force),
      limit: body?.limit && body.limit > 0 ? Math.min(body.limit, 50) : 20,
    });

    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Location resolve failed.";
    return jsonError(message, 500);
  }
}
