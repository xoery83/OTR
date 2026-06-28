import type {
  ItineraryItemRatingSummary,
  ItineraryRatingItemType,
} from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";

type RatingRow = {
  item_type: ItineraryRatingItemType;
  item_id: string;
  user_id: string;
  rating: number | string;
};

function ratingKey(itemType: ItineraryRatingItemType, itemId: string) {
  return `${itemType}:${itemId}`;
}

function numericRating(value: number | string) {
  const rating = Number(value);
  return Number.isFinite(rating) ? rating : 0;
}

function isMissingRatingsTableError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.message?.includes("itinerary_item_ratings")
  );
}

export function itineraryRatingKey(
  itemType: ItineraryRatingItemType,
  itemId: string,
) {
  return ratingKey(itemType, itemId);
}

export async function getItineraryRatingSummaries(tripId: string) {
  const user = await getCurrentUser().catch(() => null);
  const { data, error } = await supabase
    .from("itinerary_item_ratings")
    .select("item_type, item_id, user_id, rating")
    .eq("trip_id", tripId);

  if (error) {
    if (isMissingRatingsTableError(error)) {
      return new Map<string, ItineraryItemRatingSummary>();
    }
    throw error;
  }

  const grouped = new Map<
    string,
    {
      itemType: ItineraryRatingItemType;
      itemId: string;
      total: number;
      count: number;
      myRating: number | null;
    }
  >();

  ((data ?? []) as RatingRow[]).forEach((row) => {
    const key = ratingKey(row.item_type, row.item_id);
    const rating = numericRating(row.rating);
    const current =
      grouped.get(key) ??
      {
        itemType: row.item_type,
        itemId: row.item_id,
        total: 0,
        count: 0,
        myRating: null,
      };
    current.total += rating;
    current.count += 1;
    if (user?.id === row.user_id) {
      current.myRating = rating;
    }
    grouped.set(key, current);
  });

  return new Map(
    [...grouped.entries()].map(([key, item]) => [
      key,
      {
        itemType: item.itemType,
        itemId: item.itemId,
        averageRating: item.count > 0 ? item.total / item.count : null,
        ratingCount: item.count,
        myRating: item.myRating,
      } satisfies ItineraryItemRatingSummary,
    ]),
  );
}

export async function getMyItineraryRatingCount() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return 0;

  const { count, error } = await supabase
    .from("itinerary_item_ratings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (error) {
    if (isMissingRatingsTableError(error)) return 0;
    throw error;
  }

  return count ?? 0;
}

export async function upsertItineraryItemRating({
  tripId,
  itemType,
  itemId,
  rating,
}: {
  tripId: string;
  itemType: ItineraryRatingItemType;
  itemId: string;
  rating: number;
}) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be logged in to rate this item.");
  }

  const normalizedRating = Math.max(0, Math.min(5, Number(rating)));
  const { error } = await supabase.from("itinerary_item_ratings").upsert(
    {
      trip_id: tripId,
      item_type: itemType,
      item_id: itemId,
      user_id: user.id,
      rating: Number(normalizedRating.toFixed(1)),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "item_type,item_id,user_id" },
  );

  if (error) {
    if (isMissingRatingsTableError(error)) {
      throw new Error(
        "评分表已经创建后，需要刷新 Supabase API schema cache。请运行：NOTIFY pgrst, 'reload schema';",
      );
    }
    throw error;
  }
}
