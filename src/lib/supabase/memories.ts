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
  parent_memory_id?: string | null;
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

type MemoryLikeRow = {
  memory_entry_id: string;
  user_id: string;
  like_count: number | null;
};

type MemoryFavoriteRow = {
  memory_entry_id: string;
  user_id: string;
};

export type MemoryEngagement = {
  likeCount: number;
  favoriteCount: number;
  myLikeCount: number;
  isFavorited: boolean;
};

export type CreateMemoryBaseInput = {
  capturedAt: string;
  locationName: string;
  tripDayId?: string | null;
  parentMemoryId?: string | null;
  itineraryEventId?: string | null;
  itineraryReservationId?: string | null;
};

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
  phase: "uploading" | "server_processing" | "completed";
};

const emptyMemoryEngagement = {
  likeCount: 0,
  favoriteCount: 0,
  myLikeCount: 0,
  isFavorited: false,
} satisfies MemoryEngagement;

export type UpdateMemoryInput = {
  memoryId: string;
  content?: string;
  locationName?: string | null;
  capturedAt?: string;
};

export type TripMemorySummary = {
  total: number;
  photos: number;
  text: number;
  contributors: number;
  latest: MemoryEntry | null;
};

export type TripMemoryPage = {
  memories: MemoryEntry[];
  nextCursor: string | null;
};

const replyMarkerPrefix = "__otr_reply_parent:";
const memorySelect =
  "id, trip_id, trip_day_id, itinerary_event_id, itinerary_reservation_id, user_id, type, content, media_url, location_name, captured_at, created_at";
export const GOOGLE_DRIVE_PHOTO_STORAGE_REQUIRED_MESSAGE =
  "为了避免照片占用 OTR 云存储，请先连接 Google Drive。连接后照片会保存到你自己的 Google Drive，并可正常使用 Timeline、Gallery、人脸识别等功能。";

function encodeMemoryContent(content: string, parentMemoryId?: string | null) {
  const trimmed = content.trim();
  if (!parentMemoryId) return trimmed;
  return `${replyMarkerPrefix}${parentMemoryId}__\n${trimmed}`;
}

function decodeMemoryContent(content: string | null, parentMemoryId?: string | null) {
  const raw = content ?? "";
  const match = raw.match(/^__otr_reply_parent:([0-9a-f-]+)__\n?/i);
  if (!match) {
    return { content: raw, parentMemoryId: parentMemoryId ?? null };
  }

  return {
    content: raw.slice(match[0].length),
    parentMemoryId: parentMemoryId ?? match[1],
  };
}

function isSystemCaptureUploadMemoryContent(content: string | null) {
  const raw = content?.trim() ?? "";
  return /^Capture (?:2\.0 media upload|photo upload):/i.test(raw);
}

function onlyVisibleMemoryRows(rows: MemoryRow[]) {
  return rows.filter((row) => !isSystemCaptureUploadMemoryContent(row.content));
}

function isMissingParentMemoryColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: string; code?: string };
  return (
    record.code === "PGRST204" ||
    /parent_memory_id|schema cache|column/i.test(record.message ?? "")
  );
}

function mapMemory(row: MemoryRow): MemoryEntry {
  const decoded = decodeMemoryContent(row.content, row.parent_memory_id);

  return {
    id: row.id,
    tripId: row.trip_id,
    tripDayId: row.trip_day_id,
    parentMemoryId: decoded.parentMemoryId,
    itineraryEventId: row.itinerary_event_id,
    itineraryReservationId: row.itinerary_reservation_id,
    userId: row.user_id ?? "",
    type: row.type,
    content: decoded.content,
    mediaUrl: row.media_url,
    mediaAssetId: null,
    locationName: row.location_name,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

export async function getTripMemories(
  tripId: string,
  options?: { limit?: number; userId?: string },
) {
  await ensureCreatorMembership(tripId);

  let query = supabase
    .from("memory_entries")
    .select(memorySelect)
    .eq("trip_id", tripId)
    .order("captured_at", { ascending: false });

  if (options?.userId) {
    query = query.eq("user_id", options.userId);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return withMemoryEngagement(
    await withContributorProfiles(onlyVisibleMemoryRows((data ?? []) as MemoryRow[]).map(mapMemory)),
  );
}

export async function getTripMemoriesPage(
  tripId: string,
  options?: { limit?: number; beforeCapturedAt?: string | null },
): Promise<TripMemoryPage> {
  await ensureCreatorMembership(tripId);

  const limit = Math.max(1, Math.min(options?.limit ?? 60, 100));
  let query = supabase
    .from("memory_entries")
    .select(memorySelect)
    .eq("trip_id", tripId)
    .order("captured_at", { ascending: false })
    .limit(limit + 1);

  if (options?.beforeCapturedAt) {
    query = query.lt("captured_at", options.beforeCapturedAt);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = onlyVisibleMemoryRows((data ?? []) as MemoryRow[]);
  const pageRows = rows.slice(0, limit);
  const memories = await withMemoryEngagement(
    await withContributorProfiles(pageRows.map(mapMemory)),
  );

  return {
    memories,
    nextCursor:
      rows.length > limit ? pageRows[pageRows.length - 1]?.captured_at ?? null : null,
  };
}

export async function getTripMemorySummary(
  tripId: string,
  options?: { userId?: string },
): Promise<TripMemorySummary> {
  await ensureCreatorMembership(tripId);

  let query = supabase
    .from("memory_entries")
    .select(memorySelect)
    .eq("trip_id", tripId)
    .order("captured_at", { ascending: false });
  if (options?.userId) query = query.eq("user_id", options.userId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = onlyVisibleMemoryRows((data ?? []) as MemoryRow[]);
  const memories = rows.map(mapMemory);
  const [latestWithProfile] = await withContributorProfiles(memories.slice(0, 1));

  return {
    total: memories.length,
    photos: memories.filter((memory) => memory.type === "photo").length,
    text: memories.filter((memory) => memory.type === "text").length,
    contributors: new Set(memories.map((memory) => memory.userId).filter(Boolean)).size,
    latest: latestWithProfile ?? null,
  };
}

export async function getTripMemoriesForDate(tripId: string, date: string) {
  await ensureCreatorMembership(tripId);

  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  const { data, error } = await supabase
    .from("memory_entries")
    .select(memorySelect)
    .eq("trip_id", tripId)
    .gte("captured_at", start.toISOString())
    .lt("captured_at", end.toISOString())
    .order("captured_at", { ascending: true });

  if (error) {
    throw error;
  }

  return withMemoryEngagement(
    await withContributorProfiles(
      onlyVisibleMemoryRows((data ?? []) as MemoryRow[]).map(mapMemory),
    ),
  );
}

async function withMemoryEngagement(memories: MemoryEntry[]) {
  const memoryIds = memories.map((memory) => memory.id);
  if (memoryIds.length === 0) return memories;

  const user = await getCurrentUser();

  const [likesResult, favoritesResult] = await Promise.all([
    supabase
      .from("memory_likes")
      .select("memory_entry_id, user_id, like_count")
      .in("memory_entry_id", memoryIds),
    supabase
      .from("memory_favorites")
      .select("memory_entry_id, user_id")
      .in("memory_entry_id", memoryIds),
  ]);

  if (likesResult.error || favoritesResult.error) {
    return memories.map((memory) => ({
      ...memory,
      ...emptyMemoryEngagement,
    }));
  }

  const likesByMemory = new Map<string, { total: number; mine: number }>();
  ((likesResult.data ?? []) as MemoryLikeRow[]).forEach((like) => {
    const current = likesByMemory.get(like.memory_entry_id) ?? {
      total: 0,
      mine: 0,
    };
    const count = like.like_count ?? 0;
    current.total += count;
    if (user && like.user_id === user.id) current.mine = count;
    likesByMemory.set(like.memory_entry_id, current);
  });

  const favoritesByMemory = new Map<string, { total: number; mine: boolean }>();
  ((favoritesResult.data ?? []) as MemoryFavoriteRow[]).forEach((favorite) => {
    const current = favoritesByMemory.get(favorite.memory_entry_id) ?? {
      total: 0,
      mine: false,
    };
    current.total += 1;
    if (user && favorite.user_id === user.id) current.mine = true;
    favoritesByMemory.set(favorite.memory_entry_id, current);
  });

  return memories.map((memory) => {
    const likes = likesByMemory.get(memory.id);
    const favorites = favoritesByMemory.get(memory.id);

    return {
      ...memory,
      likeCount: likes?.total ?? 0,
      myLikeCount: likes?.mine ?? 0,
      favoriteCount: favorites?.total ?? 0,
      isFavorited: favorites?.mine ?? false,
    };
  });
}

export async function getMemoryEngagement(memoryId: string) {
  const [memory] = await withMemoryEngagement([{ id: memoryId } as MemoryEntry]);
  return {
    likeCount: memory.likeCount ?? 0,
    favoriteCount: memory.favoriteCount ?? 0,
    myLikeCount: memory.myLikeCount ?? 0,
    isFavorited: memory.isFavorited ?? false,
  } satisfies MemoryEngagement;
}

export async function incrementMemoryLike(memoryId: string) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to like a memory.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("memory_likes")
    .select("like_count")
    .eq("memory_entry_id", memoryId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) throw existingError;

  const nextLikeCount = Math.min(
    ((existing as { like_count?: number } | null)?.like_count ?? 0) + 1,
    5,
  );

  const { error } = await supabase.from("memory_likes").upsert(
    {
      memory_entry_id: memoryId,
      user_id: user.id,
      like_count: nextLikeCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "memory_entry_id,user_id" },
  );

  if (error) throw error;

  return getMemoryEngagement(memoryId);
}

export async function toggleMemoryFavorite(memoryId: string, shouldFavorite: boolean) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to favorite a memory.");
  }

  if (shouldFavorite) {
    const { error } = await supabase.from("memory_favorites").upsert(
      {
        memory_entry_id: memoryId,
        user_id: user.id,
      },
      { onConflict: "memory_entry_id,user_id" },
    );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("memory_favorites")
      .delete()
      .eq("memory_entry_id", memoryId)
      .eq("user_id", user.id);
    if (error) throw error;
  }

  return getMemoryEngagement(memoryId);
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
  const encodedContent = encodeMemoryContent(content, input.parentMemoryId);
  const locationText = input.locationName.trim() || null;

  const row = {
    id: memoryId,
    trip_id: tripId,
    user_id: user.id,
    trip_day_id: input.tripDayId || null,
    parent_memory_id: input.parentMemoryId || null,
    itinerary_event_id: input.itineraryEventId || null,
    itinerary_reservation_id: input.itineraryReservationId || null,
    type: "text",
    content: encodedContent,
    location_name: locationText,
    location_text: locationText,
    location_status: locationText ? "pending" : "none",
    captured_at: capturedAt,
  };

  const { error } = await supabase.from("memory_entries").insert(row);

  if (error) {
    if (!isMissingParentMemoryColumn(error)) {
      throw error;
    }

    const fallbackRow = { ...row };
    delete (fallbackRow as Partial<typeof row>).parent_memory_id;
    const { error: fallbackError } = await supabase
      .from("memory_entries")
      .insert(fallbackRow);
    if (fallbackError) throw fallbackError;
  }

  return {
    id: memoryId,
    tripId,
    tripDayId: input.tripDayId || null,
    parentMemoryId: input.parentMemoryId || null,
    itineraryEventId: input.itineraryEventId || null,
    itineraryReservationId: input.itineraryReservationId || null,
    userId: user.id,
    type: "text",
    content: content.trim(),
    mediaUrl: null,
    mediaAssetId: null,
    locationName: input.locationName.trim() || null,
    capturedAt,
    createdAt: now,
    contributorName: user.user_metadata?.full_name || user.email || "Traveler",
    contributorAvatarUrl:
      user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    likeCount: 0,
    favoriteCount: 0,
    myLikeCount: 0,
    isFavorited: false,
  } satisfies MemoryEntry;
}

export async function updateMemoryEntry(input: UpdateMemoryInput) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to update a memory.");
  }

  const patch: Record<string, string | boolean | null> = {};
  if (input.content !== undefined) patch.content = input.content.trim();
  if (input.locationName !== undefined) {
    const locationText = input.locationName?.trim() || null;
    patch.location_name = locationText;
    patch.location_text = locationText;
    patch.location_status = locationText ? "pending" : "none";
    patch.location_lat = null;
    patch.location_lng = null;
    patch.place_id = null;
    patch.location_provider = null;
    patch.location_provider_place_id = null;
    patch.geocoded_at = null;
    patch.geocode_error = null;
    patch.manual_location = false;
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
  options?: {
    onUploadProgress?: (progress: UploadProgress) => void;
  },
) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You must be logged in to upload a photo.");
  }

  const { data: connection, error: connectionError } = await supabase
    .from("journey_storage_connections")
    .select("id")
    .eq("trip_id", tripId)
    .eq("provider", "google_drive")
    .eq("status", "connected")
    .maybeSingle();

  if (connectionError) {
    throw connectionError;
  }

  if (!connection) {
    throw new Error(GOOGLE_DRIVE_PHOTO_STORAGE_REQUIRED_MESSAGE);
  }

  const now = new Date().toISOString();
  const capturedAt = new Date(input.capturedAt).toISOString();
  const memoryId = crypto.randomUUID();
  const mediaAssetId = crypto.randomUUID();
  const mediaKey = `drive:${mediaAssetId}`;
  const encodedCaption = encodeMemoryContent(caption, input.parentMemoryId);
  const locationText = input.locationName.trim() || null;

  const memoryRow = {
    id: memoryId,
    trip_id: tripId,
    user_id: user.id,
    trip_day_id: input.tripDayId || null,
    parent_memory_id: input.parentMemoryId || null,
    itinerary_event_id: input.itineraryEventId || null,
    itinerary_reservation_id: input.itineraryReservationId || null,
    type: "photo",
    content: encodedCaption || null,
    media_url: mediaKey,
    location_name: locationText,
    location_text: locationText,
    location_status: locationText ? "pending" : "none",
    captured_at: capturedAt,
  };

  const { error: memoryError } = await supabase
    .from("memory_entries")
    .insert(memoryRow);

  if (memoryError) {
    if (!isMissingParentMemoryColumn(memoryError)) {
      throw new Error(`Memory row failed: ${memoryError.message}`);
    }

    const fallbackRow = { ...memoryRow };
    delete (fallbackRow as Partial<typeof memoryRow>).parent_memory_id;
    const { error: fallbackError } = await supabase
      .from("memory_entries")
      .insert(fallbackRow);
    if (fallbackError) {
      throw new Error(`Memory row failed: ${fallbackError.message}`);
    }
  }

  try {
    await createImageMediaAsset({
      id: mediaAssetId,
      tripId,
      userId: user.id,
      memoryEntryId: memoryId,
      storageProvider: "google_drive",
      storageBucket: "google-drive",
      compressedFilePath: null,
      compressedFileSize: null,
      thumbnailFilePath: null,
      width: compressedImage.width,
      height: compressedImage.height,
      thumbnailWidth: compressedImage.thumbnailWidth,
      thumbnailHeight: compressedImage.thumbnailHeight,
      thumbnailSize: compressedImage.thumbnailBlob.size,
      originalFileSize: originalFile?.size ?? compressedImage.blob.size,
      mimeType: originalFile?.type || "image/jpeg",
      processingStatus: "processing",
      takenAt: capturedAt,
      aiMetadata: {
        originalFileName,
        dayId: input.tripDayId ?? null,
      },
    });
  } catch (assetError) {
    throw new Error(
      `Media asset row failed: ${
        assetError instanceof Error ? assetError.message : "Unknown error"
      }`,
    );
  }

  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      throw new Error("No active session was found for photo upload.");
    }

    const uploadFile =
      originalFile ??
      new File([compressedImage.blob], makeSafeFileName(originalFileName), {
        type: "image/jpeg",
      });
    const form = new FormData();
    form.append("tripId", tripId);
    form.append("memoryEntryId", memoryId);
    form.append("mediaAssetId", mediaAssetId);
    form.append("capturedDate", input.capturedAt.slice(0, 10));
    form.append("file", uploadFile, uploadFile.name);

    await uploadPhotoFormToDrive(form, accessToken, options?.onUploadProgress);
  } catch (driveUploadError) {
    await supabase
      .from("media_assets")
      .update({ processing_status: "failed" })
      .eq("id", mediaAssetId);
    throw new Error(
      `Google Drive photo upload failed: ${
        driveUploadError instanceof Error ? driveUploadError.message : "Unknown error"
      }`,
    );
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
    parentMemoryId: input.parentMemoryId || null,
    itineraryEventId: input.itineraryEventId || null,
    itineraryReservationId: input.itineraryReservationId || null,
    userId: user.id,
    type: "photo",
    content: caption.trim(),
    mediaUrl: mediaKey,
    mediaAssetId,
    locationName: input.locationName.trim() || null,
    capturedAt,
    createdAt: now,
    contributorName: user.user_metadata?.full_name || user.email || "Traveler",
    contributorAvatarUrl:
      user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    likeCount: 0,
    favoriteCount: 0,
    myLikeCount: 0,
    isFavorited: false,
  } satisfies MemoryEntry;
}

function uploadPhotoFormToDrive(
  form: FormData,
  accessToken: string,
  onUploadProgress?: (progress: UploadProgress) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("POST", "/api/google-drive/upload-photo");
    request.setRequestHeader("Authorization", `Bearer ${accessToken}`);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onUploadProgress) return;
      onUploadProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
        phase: event.loaded >= event.total ? "server_processing" : "uploading",
      });
    };

    request.onload = () => {
      let payload: { error?: string } = {};
      try {
        payload = JSON.parse(request.responseText || "{}") as { error?: string };
      } catch {
        reject(new Error("Could not read Google Drive photo upload response."));
        return;
      }

      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.error || "Google Drive photo upload failed."));
        return;
      }

      onUploadProgress?.({ loaded: 1, total: 1, percent: 100, phase: "completed" });
      resolve();
    };

    request.onerror = () => reject(new Error("Google Drive photo upload failed."));
    request.onabort = () => reject(new Error("Google Drive photo upload was cancelled."));
    request.send(form);
  });
}

export async function getSignedMemoryImageUrls(memories: MemoryEntry[]) {
  const photoMemories = memories.filter(
    (memory) => memory.type === "photo" && memory.mediaUrl,
  );
  const memoryIds = photoMemories.map((memory) => memory.id).filter(Boolean);
  const displayPathByMemoryPath = new Map<string, string>();

  if (photoMemories.length === 0) {
    return {};
  }

  if (memoryIds.length > 0) {
    const { data } = await supabase
      .from("media_assets")
      .select(
        "id, memory_entry_id, compressed_file_path, thumbnail_file_path, thumbnail_url, preview_url, thumbnail_drive_web_url, provider_thumbnail_url",
      )
      .in("memory_entry_id", memoryIds);

    ((data ?? []) as {
      id: string;
      memory_entry_id: string | null;
      compressed_file_path: string | null;
      thumbnail_file_path: string | null;
      thumbnail_url: string | null;
      preview_url: string | null;
      thumbnail_drive_web_url: string | null;
      provider_thumbnail_url: string | null;
    }[]).forEach((asset) => {
      if (!asset.memory_entry_id) return;
      const memory = photoMemories.find((item) => item.id === asset.memory_entry_id);
      const memoryPath = memory?.mediaUrl;
      if (!memoryPath) return;

      const directDisplayUrl =
        asset.thumbnail_url ??
        asset.preview_url ??
        asset.provider_thumbnail_url ??
        asset.thumbnail_drive_web_url;

      const legacyPath = asset.thumbnail_file_path ?? asset.compressed_file_path;
      if (directDisplayUrl) {
        displayPathByMemoryPath.set(memoryPath, directDisplayUrl);
      } else if (legacyPath) {
        displayPathByMemoryPath.set(memoryPath, legacyPath);
      } else {
        displayPathByMemoryPath.set(
          memoryPath,
          `/api/media/assets/${asset.id}/thumbnail`,
        );
      }
    });
  }

  const pathPairs = photoMemories.flatMap((memory) => {
    const memoryPath = memory.mediaUrl;
    if (!memoryPath) return [];
    return [
      {
        memoryPath,
        displayPath: displayPathByMemoryPath.get(memoryPath) ?? memoryPath,
      },
    ];
  });
  const directPairs = pathPairs.filter((pair) =>
    /^(?:https?:\/\/|\/)/.test(pair.displayPath),
  );
  const legacyPairs = pathPairs.filter(
    (pair) => !/^(?:https?:\/\/|\/)/.test(pair.displayPath),
  );
  const displayPaths = [...new Set(legacyPairs.map((pair) => pair.displayPath))];

  const directUrls = directPairs.reduce<Record<string, string>>((urls, pair) => {
    urls[pair.memoryPath] = pair.displayPath;
    return urls;
  }, {});

  if (displayPaths.length === 0) {
    return directUrls;
  }

  const { data, error } = await supabase.storage
    .from("trip-media")
    .createSignedUrls(displayPaths, 60 * 60);

  if (error) {
    throw error;
  }

  const signedByDisplayPath = (data ?? []).reduce<Record<string, string>>((urls, item) => {
    if (item.path && item.signedUrl) {
      urls[item.path] = item.signedUrl;
    }

    return urls;
  }, {});

  return legacyPairs.reduce<Record<string, string>>((urls, pair) => {
    const signedUrl = signedByDisplayPath[pair.displayPath];
    if (signedUrl) urls[pair.memoryPath] = signedUrl;
    return urls;
  }, directUrls);
}
