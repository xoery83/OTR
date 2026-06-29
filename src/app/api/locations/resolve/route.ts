import type { NextRequest } from "next/server";
import {
  getAuthenticatedUserIdForRequest,
  getPlaceServiceSupabaseForRequest,
  resolveSingleJourneyLocation,
  resolveJourneyLocations,
  type LocatableItemType,
} from "@/lib/place-service/server";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const itemTypes = new Set<LocatableItemType>([
  "itinerary_reservation",
  "itinerary_event",
  "memory",
  "ledger_entry",
  "media_asset",
]);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      journeyId?: string;
      itemType?: LocatableItemType;
      itemId?: string;
      force?: boolean;
      limit?: number;
    } | null;
    const journeyId = body?.journeyId?.trim();
    if (!journeyId) return jsonError("Missing journeyId.", 400);

    const ownerUserId = await getAuthenticatedUserIdForRequest(request);
    const supabase = await getPlaceServiceSupabaseForRequest(request, journeyId);
    if (body?.itemType && body.itemId) {
      if (!itemTypes.has(body.itemType)) {
        return jsonError("Invalid location item type.", 400);
      }
      const result = await resolveSingleJourneyLocation(supabase, journeyId, {
        itemType: body.itemType,
        itemId: body.itemId,
        force: body.force ?? true,
        ownerUserId,
      });
      return Response.json(result);
    }

    const summary = await resolveJourneyLocations(supabase, journeyId, {
      force: Boolean(body?.force),
      limit: body?.limit && body.limit > 0 ? Math.min(body.limit, 50) : 20,
      ownerUserId,
    });

    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Location resolve failed.";
    return jsonError(message, 500);
  }
}
