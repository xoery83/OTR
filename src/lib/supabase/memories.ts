import type { MemoryEntry } from "@/types";
import { enqueueMediaProcessingJobs } from "@/lib/background-jobs/client";
import { makeSafeFileName, type CompressedImage } from "@/lib/images";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";
import { createImageMediaAsset } from "./media-assets";

type MemoryRow = {
  id: string;
  trip_id: string;
  trip_day_id: string | null;
  itinerary_event_id: string | null;
  itinerary_reservation_id: string | null;
  user_id: string | null;
  type: MemoryEntry["type"];
  content: string | null;
  media_url: string | null;
  location_name: string | null;
  captured_at: string;
  created_at: string;
};

export type CreateMemoryBaseInput = {
  capturedAt: string;
  locationName: string;
  tripDayId?: string | null;
  itineraryEventId?: string | null;
  itineraryReservationId?: string | null;
};

export type UpdateMemoryInput = {
  memoryId: string;
  content?: string;
  locationName?: string | null;
  capturedAt?: string;
};

function mapMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    tripId: row.trip_id,
    tripDayId: row.trip_day_id,
    itineraryEventId: row.itinerary_event_id,
    itineraryReservationId: row.itinerary_reservation_id,
    userId: row.user_id ?? "",
    type: row.type,
    content: row.content ?? "",
    mediaUrl: row.media_url,
    mediaAssetId: null,
    locationName: row.location_name,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

export async function getTripMemories(tripId: string) {
  await ensureCreatorMembership(tripId);

  const { data, error } = await supabase
    .from("memory_entries")
    .select("*")
    .eq("trip_id", tripId)
    .order("captured_at", { ascending: false });

  if (error) {
    throw error;
  }

  return withContributorProfiles((data ?? []).map(mapMemory));
}

export async function getTripMemoriesForDate(tripId: string, date: string) {
  await ensureCreatorMembership(tripId);

  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  const { data, error } = await supabase
    .from("memory_entries")
    .select("*")
    .eq("trip_id", tripId)
    .gte("captured_at", start.toISOString())
    .lt("captured_at", end.toISOString())
    .order("captured_at", { ascending: true });

  if (error) {
    throw error;
  }

  return withContributorProfiles((data ?? []).map(mapMemory));
}

async function withContributorProfiles(memories: MemoryEntry[]) {
  const userIds = [...new Set(memories.map((memory) => memory.userId).filter(Boolean))];

  if (userIds.length === 0) {
    return memories;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);

  if (error) {
    return memories;
  }

  const profilesById = new Map(
    (data ?? []).map((profile) => [
      profile.id,
      {
        name: profile.display_name || "Traveler",
        avatarUrl: profile.avatar_url as string | null,
      },
    ]),
  );

  return memories.map((memory) => {
    const profile = profilesById.get(memory.userId);

    return {
      ...memory,
      contributorName: profile?.name ?? "Traveler",
      contributorAvatarUrl: profile?.avatarUrl ?? null,
    };
  });
}

async function ensureCreatorMembership(tripId: string) {
  const user = await getCurrentUser();

  if (!user) {
    return;
  }

  const { data: trip } = await supabase
    .from("trips")
    .select("created_by")
    .eq("id", tripId)
    .single();

  if (trip?.created_by !== user.id) {
    return;
  }

  await supabase.from("trip_members").upsert(
    {
      trip_id: tripId,
      user_id: user.id,
      role: "owner",
    },
    {
      onConflict: "trip_id,user_id",
      ignoreDuplicates: true,
    },
  );
}

export async function createTextMemory(
  tripId: string,
  content: string,
  input: CreateMemoryBaseInput,
) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to save a memory.");
  }

  const memoryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const capturedAt = new Date(input.capturedAt).toISOString();

  const { error } = await supabase
    .from("memory_entries")
    .insert({
      id: memoryId,
      trip_id: tripId,
      user_id: user.id,
      trip_day_id: input.tripDayId || null,
      itinerary_event_id: input.itineraryEventId || null,
      itinerary_reservation_id: input.itineraryReservationId || null,
      type: "text",
      content,
      location_name: input.locationName.trim() || null,
      captured_at: capturedAt,
    });

  if (error) {
    throw error;
  }

  return {
    id: memoryId,
    tripId,
    tripDayId: input.tripDayId || null,
    itineraryEventId: input.itineraryEventId || null,
    itineraryReservationId: input.itineraryReservationId || null,
    userId: user.id,
    type: "text",
    content,
    mediaUrl: null,
    mediaAssetId: null,
    locationName: input.locationName.trim() || null,
    capturedAt,
    createdAt: now,
    contributorName: user.user_metadata?.full_name || user.email || "Traveler",
    contributorAvatarUrl:
      user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
  } satisfies MemoryEntry;
}

export async function updateMemoryEntry(input: UpdateMemoryInput) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to update a memory.");
  }

  const patch: Partial<MemoryRow> = {};
  if (input.content !== undefined) patch.content = input.content.trim();
  if (input.locationName !== undefined) {
    patch.location_name = input.locationName?.trim() || null;
  }
  if (input.capturedAt !== undefined) {
    patch.captured_at = new Date(input.capturedAt).toISOString();
  }

  const { data, error } = await supabase
    .from("memory_entries")
    .update(patch)
    .eq("id", input.memoryId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapMemory(data as MemoryRow);
}

export async function deleteMemoryEntry(memoryId: string) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to delete a memory.");
  }

  const { data, error } = await supabase.rpc(
    "delete_memory_entry_for_current_user",
    { target_memory_id: memoryId },
  );

  if (error) {
    if (error.code === "PGRST202" || error.message.includes("function")) {
      await deleteMemoryEntryDirect(memoryId, user.id);
      return;
    }
    throw error;
  }

  if (!data) {
    throw new Error("Could not delete this memory.");
  }
}

async function deleteMemoryEntryDirect(memoryId: string, userId: string) {
  const { data, error } = await supabase
    .from("memory_entries")
    .delete()
    .eq("id", memoryId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error("Could not delete this memory. It may belong to another user.");
  }
}

export async function createPhotoMemory(
  tripId: string,
  compressedImage: CompressedImage,
  originalFileName: string,
  caption: string,
  input: CreateMemoryBaseInput,
  originalFile?: File | null,
) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to upload a photo.");
  }

  const now = new Date().toISOString();
  const capturedAt = new Date(input.capturedAt).toISOString();
  const timestamp = Date.now();
  const safeFileName = makeSafeFileName(originalFileName);
  const compressedFilePath = `${tripId}/${user.id}/compressed/${timestamp}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("trip-media")
    .upload(compressedFilePath, compressedImage.blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const memoryId = crypto.randomUUID();

  const { error: memoryError } = await supabase.from("memory_entries").insert({
    id: memoryId,
    trip_id: tripId,
    user_id: user.id,
    trip_day_id: input.tripDayId || null,
    itinerary_event_id: input.itineraryEventId || null,
    itinerary_reservation_id: input.itineraryReservationId || null,
    type: "photo",
    content: caption.trim() || null,
    media_url: compressedFilePath,
    location_name: input.locationName.trim() || null,
    captured_at: capturedAt,
  });

  if (memoryError) {
    throw new Error(`Memory row failed: ${memoryError.message}`);
  }

  const mediaAssetId = crypto.randomUUID();

  try {
    await createImageMediaAsset({
      id: mediaAssetId,
      tripId,
      userId: user.id,
      memoryEntryId: memoryId,
      compressedFilePath,
      compressedFileSize: compressedImage.blob.size,
      width: compressedImage.width,
      height: compressedImage.height,
    });
  } catch (assetError) {
    throw new Error(
      `Media asset row failed: ${
        assetError instanceof Error ? assetError.message : "Unknown error"
      }`,
    );
  }

  if (originalFile) {
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        throw new Error("No active session was found for original upload.");
      }

      const form = new FormData();
      form.append("tripId", tripId);
      form.append("memoryEntryId", memoryId);
      form.append("mediaAssetId", mediaAssetId);
      form.append("capturedDate", input.capturedAt.slice(0, 10));
      form.append("file", originalFile, originalFile.name);

      const response = await fetch("/api/google-drive/upload-photo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Original upload failed.");
      }
    } catch (originalUploadError) {
      throw new Error(
        `Compressed photo saved, but original Google Drive upload failed: ${
          originalUploadError instanceof Error
            ? originalUploadError.message
            : "Unknown error"
        }`,
      );
    }
  }

  await enqueueMediaProcessingJobs({
    tripId,
    mediaAssetId,
    title: caption.trim() || originalFileName || "Photo processing",
  }).catch(() => null);

  return {
    id: memoryId,
    tripId,
    tripDayId: input.tripDayId || null,
    itineraryEventId: input.itineraryEventId || null,
    itineraryReservationId: input.itineraryReservationId || null,
    userId: user.id,
    type: "photo",
    content: caption.trim(),
    mediaUrl: compressedFilePath,
    mediaAssetId,
    locationName: input.locationName.trim() || null,
    capturedAt,
    createdAt: now,
    contributorName: user.user_metadata?.full_name || user.email || "Traveler",
    contributorAvatarUrl:
      user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
  } satisfies MemoryEntry;
}

export async function getSignedMemoryImageUrls(memories: MemoryEntry[]) {
  const photoPaths = memories
    .filter((memory) => memory.type === "photo" && memory.mediaUrl)
    .map((memory) => memory.mediaUrl!);

  if (photoPaths.length === 0) {
    return {};
  }

  const { data, error } = await supabase.storage
    .from("trip-media")
    .createSignedUrls(photoPaths, 60 * 60);

  if (error) {
    throw error;
  }

  return (data ?? {}).reduce<Record<string, string>>((urls, item) => {
    if (item.path && item.signedUrl) {
      urls[item.path] = item.signedUrl;
    }

    return urls;
  }, {});
}
