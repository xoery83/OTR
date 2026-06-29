import type { NextRequest } from "next/server";
import {
  applyManualLocation,
  getSupabaseForRequest,
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
      locationText?: string;
      title?: string;
      latitude?: number;
      longitude?: number;
    } | null;

    if (!body?.journeyId || !body.itemType || !itemTypes.has(body.itemType)) {
      return jsonError("Missing location item identity.", 400);
    }
    if (!body.itemId || !body.locationText || !body.title) {
      return jsonError("Missing location item details.", 400);
    }
    if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
      return jsonError("Invalid coordinates.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const result = await applyManualLocation(supabase, {
      journeyId: body.journeyId,
      itemType: body.itemType,
      itemId: body.itemId,
      locationText: body.locationText,
      title: body.title,
      latitude: Number(body.latitude),
      longitude: Number(body.longitude),
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manual pin failed.";
    return jsonError(message, 500);
  }
}
