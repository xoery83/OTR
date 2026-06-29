import type { JourneyChatMessage } from "@/types";
import { compressImageFile, makeSafeFileName } from "@/lib/images";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";
import { createPhotoMemory } from "./memories";
import { requestVoiceTranscription } from "./media-assets";

type ChatMessageRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  journey_member_id: string | null;
  message_type: JourneyChatMessage["messageType"];
  text_content: string | null;
  media_asset_id: string | null;
  memory_entry_id: string | null;
  media_url: string | null;
  voice_duration_ms: number | null;
  transcript_text: string | null;
  transcript_status: JourneyChatMessage["transcriptStatus"];
  source_type: JourneyChatMessage["sourceType"];
  source_id: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type MemorySyncRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  type: "text" | "photo" | "voice" | "location";
  content: string | null;
  media_url: string | null;
  captured_at: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

type MediaRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  memory_entry_id: string | null;
  asset_type: "image" | "video" | "audio";
  storage_provider?: "supabase_legacy" | "google_drive" | "onedrive" | null;
  storage_bucket: string;
  original_file_path: string | null;
  compressed_file_path: string | null;
  thumbnail_file_path: string | null;
  provider_file_id?: string | null;
  provider_drive_id?: string | null;
  provider_web_url?: string | null;
  provider_thumbnail_url?: string | null;
  provider_original_reference?: string | null;
  original_file_size: number | null;
  compressed_file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  storage_tier: "standard" | "pro_original";
  is_original_preserved: boolean;
  retention_until: string | null;
  taken_at?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  camera_model?: string | null;
  orientation?: string | null;
  exif_json?: Record<string, unknown> | null;
  ai_status?: "pending" | "processing" | "indexed" | "failed" | "skipped" | null;
  ai_metadata?: Record<string, unknown> | null;
  ocr_text?: string | null;
  duplicate_score?: number | null;
  blur_score?: number | null;
  scene_tags?: string[] | null;
  indexed_at?: string | null;
  created_at: string;
};

type ChatBundle = {
  messages: JourneyChatMessage[];
  currentUserId: string | null;
  lastReadAt: string | null;
  firstUnreadMessageId: string | null;
  hasMoreBefore: boolean;
};

function mapMessage(row: ChatMessageRow): JourneyChatMessage {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    journeyMemberId: row.journey_member_id,
    messageType: row.message_type,
    textContent: row.text_content,
    mediaAssetId: row.media_asset_id,
    memoryEntryId: row.memory_entry_id,
    mediaUrl: row.media_url,
    voiceDurationMs: row.voice_duration_ms,
    transcriptText: row.transcript_text,
    transcriptStatus: row.transcript_status,
    sourceType: row.source_type,
    sourceId: row.source_id,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPhotoAsset(row: MediaRow, displayUrl?: string | null) {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id ?? "",
    memoryEntryId: row.memory_entry_id ?? "",
    assetType: row.asset_type,
    storageProvider: row.storage_provider ?? "supabase_legacy",
    storageBucket: row.storage_bucket,
    originalFilePath: row.original_file_path,
    compressedFilePath: row.compressed_file_path,
    thumbnailFilePath: row.thumbnail_file_path,
    providerFileId: row.provider_file_id ?? null,
    providerDriveId: row.provider_drive_id ?? null,
    providerWebUrl: row.provider_web_url ?? null,
    providerThumbnailUrl: row.provider_thumbnail_url ?? null,
    providerOriginalReference: row.provider_original_reference ?? null,
    originalFileSize: row.original_file_size,
    compressedFileSize: row.compressed_file_size,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    storageTier: row.storage_tier,
    isOriginalPreserved: row.is_original_preserved,
    retentionUntil: row.retention_until,
    takenAt: row.taken_at ?? null,
    gpsLatitude: row.gps_latitude ?? null,
    gpsLongitude: row.gps_longitude ?? null,
    cameraModel: row.camera_model ?? null,
    orientation: row.orientation ?? null,
    exifJson: row.exif_json ?? {},
    aiStatus: row.ai_status ?? "pending",
    aiMetadata: row.ai_metadata ?? {},
    ocrText: row.ocr_text ?? null,
    duplicateScore: row.duplicate_score ?? null,
    blurScore: row.blur_score ?? null,
    sceneTags: row.scene_tags ?? [],
    indexedAt: row.indexed_at ?? null,
    createdAt: row.created_at,
    memory: null,
    displayUrl: displayUrl ?? undefined,
  };
}

function messageTextFromMemory(memory: MemorySyncRow) {
  if (memory.type === "photo") return memory.content?.trim() || "图片";
  if (memory.type === "voice") return memory.content?.trim() || "语音";
  if (memory.type === "location") return memory.content?.trim() || "位置";
  return memory.content?.trim() || "";
}

function messageTypeFromMemory(memory: MemorySyncRow): JourneyChatMessage["messageType"] {
  if (memory.type === "photo") return "image";
  if (memory.type === "voice") return "voice";
  return "text";
}

async function getCurrentJourneyMemberId(tripId: string, userId: string) {
  const { data } = await supabase
    .from("journey_members")
    .select("id")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  return (data as { id?: string } | null)?.id ?? null;
}

async function enrichMessages(messages: JourneyChatMessage[]) {
  const userIds = [...new Set(messages.map((message) => message.userId).filter(Boolean))];
  const mediaAssetIds = [
    ...new Set(messages.map((message) => message.mediaAssetId).filter(Boolean)),
  ];

  const profilesByUserId = new Map<string, ProfileRow>();
  if (userIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", userIds);
    ((data ?? []) as ProfileRow[]).forEach((profile) => {
      profilesByUserId.set(profile.id, profile);
    });
  }

  const mediaById = new Map<string, MediaRow>();
  if (mediaAssetIds.length > 0) {
    const { data } = await supabase
      .from("media_assets")
      .select("*")
      .in("id", mediaAssetIds);
    ((data ?? []) as MediaRow[]).forEach((media) => {
      mediaById.set(media.id, media);
    });
  }

  const paths = [
    ...new Set(
      messages
        .map((message) => mediaById.get(message.mediaAssetId ?? "")?.compressed_file_path)
        .filter((path): path is string => Boolean(path)),
    ),
  ];
  const signedUrls = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage
      .from("trip-media")
      .createSignedUrls(paths, 60 * 60);
    (data ?? []).forEach((item) => {
      if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl);
    });
  }

  return messages.map((message) => {
    const profile = message.userId ? profilesByUserId.get(message.userId) : null;
    const media = message.mediaAssetId ? mediaById.get(message.mediaAssetId) : null;
    const mediaDisplayUrl = media?.compressed_file_path
      ? signedUrls.get(media.compressed_file_path) ?? null
      : null;

    return {
      ...message,
      senderName: profile?.display_name || "Traveler",
      senderAvatarUrl: profile?.avatar_url ?? null,
      mediaDisplayUrl,
      photoAsset:
        media && media.asset_type === "image" ? mapPhotoAsset(media, mediaDisplayUrl) : null,
    };
  });
}

export async function syncTimelineMemoriesToChat(tripId: string) {
  const { data: memories, error: memoryError } = await supabase
    .from("memory_entries")
    .select("id, trip_id, user_id, type, content, media_url, captured_at, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (memoryError) throw memoryError;
  const memoryRows = (memories ?? []) as MemorySyncRow[];
  if (memoryRows.length === 0) return;

  const memoryIds = memoryRows.map((memory) => memory.id);
  const { data: existing } = await supabase
    .from("journey_chat_messages")
    .select("memory_entry_id, source_id")
    .eq("trip_id", tripId)
    .or(`memory_entry_id.in.(${memoryIds.join(",")}),source_id.in.(${memoryIds.join(",")})`);

  const referencedIds = new Set<string>();
  ((existing ?? []) as { memory_entry_id: string | null; source_id: string | null }[]).forEach(
    (row) => {
      if (row.memory_entry_id) referencedIds.add(row.memory_entry_id);
      if (row.source_id) referencedIds.add(row.source_id);
    },
  );

  const mediaByMemoryId = new Map<string, string>();
  const photoMemoryIds = memoryRows
    .filter((memory) => memory.type === "photo" && !referencedIds.has(memory.id))
    .map((memory) => memory.id);
  if (photoMemoryIds.length > 0) {
    const { data: mediaRows } = await supabase
      .from("media_assets")
      .select("id, memory_entry_id")
      .in("memory_entry_id", photoMemoryIds);
    ((mediaRows ?? []) as { id: string; memory_entry_id: string | null }[]).forEach(
      (row) => {
        if (row.memory_entry_id) mediaByMemoryId.set(row.memory_entry_id, row.id);
      },
    );
  }

  const rows = memoryRows
    .filter((memory) => !referencedIds.has(memory.id))
    .filter((memory) => memory.type === "photo" || messageTextFromMemory(memory))
    .map((memory) => ({
      trip_id: tripId,
      user_id: memory.user_id,
      message_type: messageTypeFromMemory(memory),
      text_content: messageTextFromMemory(memory),
      media_asset_id: mediaByMemoryId.get(memory.id) ?? null,
      memory_entry_id: memory.id,
      media_url: memory.media_url,
      source_type: "timeline_memory",
      source_id: memory.id,
      created_at: memory.created_at,
      metadata: {
        capturedAt: memory.captured_at,
        syncedFrom: "memory_entries",
      },
    }));

  if (rows.length === 0) return;

  const { error } = await supabase
    .from("journey_chat_messages")
    .upsert(rows, { onConflict: "trip_id,source_type,source_id", ignoreDuplicates: true });

  if (error) throw error;
}

export async function getJourneyChatMessages(
  tripId: string,
  options?: {
    limit?: number;
    before?: string | null;
  },
): Promise<ChatBundle> {
  await syncTimelineMemoriesToChat(tripId);

  const { data: userData } = await supabase.auth.getUser();
  const currentUserId = userData.user?.id ?? null;
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 80);
  const readState = currentUserId
    ? await getJourneyChatReadState(tripId, currentUserId)
    : null;

  let query = supabase
    .from("journey_chat_messages")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options?.before) {
    query = query.lt("created_at", options.before);
  }

  const { data, error } = await query;

  if (error) throw error;
  const rows = (data ?? []) as ChatMessageRow[];
  const hasMoreBefore = rows.length > limit;
  const selectedRows = rows.slice(0, limit).reverse();
  const messages = await enrichMessages(selectedRows.map(mapMessage));
  const lastReadAt = readState?.last_read_at ?? null;
  const firstUnreadMessageId =
    !options?.before && lastReadAt && currentUserId
      ? await getFirstUnreadChatMessageId({
          tripId,
          userId: currentUserId,
          lastReadAt,
        })
      : null;

  return {
    messages,
    currentUserId,
    lastReadAt,
    firstUnreadMessageId,
    hasMoreBefore,
  };
}

async function getFirstUnreadChatMessageId(input: {
  tripId: string;
  userId: string;
  lastReadAt: string;
}) {
  const { data } = await supabase
    .from("journey_chat_messages")
    .select("id")
    .eq("trip_id", input.tripId)
    .is("deleted_at", null)
    .gt("created_at", input.lastReadAt)
    .neq("user_id", input.userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as { id?: string } | null)?.id ?? null;
}

export async function getOlderJourneyChatMessages(input: {
  tripId: string;
  before: string;
  limit?: number;
}) {
  return getJourneyChatMessages(input.tripId, {
    before: input.before,
    limit: input.limit ?? 30,
  });
}

async function getJourneyChatReadState(tripId: string, userId: string) {
  const { data } = await supabase
    .from("journey_chat_read_states")
    .select("last_read_at")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  return data as { last_read_at: string | null } | null;
}

export async function sendTextChatMessage(tripId: string, text: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to send a message.");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Message is empty.");

  const { data, error } = await supabase
    .from("journey_chat_messages")
    .insert({
      trip_id: tripId,
      user_id: user.id,
      journey_member_id: await getCurrentJourneyMemberId(tripId, user.id),
      message_type: "text",
      text_content: trimmed,
      source_type: "chat",
    })
    .select("*")
    .single();

  if (error) throw error;
  return (await enrichMessages([mapMessage(data as ChatMessageRow)]))[0];
}

export async function sendImageChatMessage(
  tripId: string,
  file: File,
  caption: string,
) {
  const compressedImage = await compressImageFile(file);
  const memory = await createPhotoMemory(
    tripId,
    compressedImage,
    file.name,
    caption,
    {
      capturedAt: new Date().toISOString(),
      locationName: "",
    },
    file,
  );
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to send a photo.");

  const { data, error } = await supabase
    .from("journey_chat_messages")
    .insert({
      trip_id: tripId,
      user_id: user.id,
      journey_member_id: await getCurrentJourneyMemberId(tripId, user.id),
      message_type: "image",
      text_content: caption.trim() || null,
      media_asset_id: memory.mediaAssetId,
      memory_entry_id: memory.id,
      media_url: memory.mediaUrl,
      source_type: "chat",
      metadata: {
        originalFileName: file.name,
      },
    })
    .select("*")
    .single();

  compressedImage.previewUrl && URL.revokeObjectURL(compressedImage.previewUrl);
  if (error) throw error;
  return (await enrichMessages([mapMessage(data as ChatMessageRow)]))[0];
}

export async function sendVoiceChatMessage(
  tripId: string,
  file: File,
  durationMs?: number | null,
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to send voice.");

  const timestamp = Date.now();
  const safeName = makeSafeFileName(file.name || "voice.webm");
  const path = `${tripId}/${user.id}/compressed/voice-${timestamp}-${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from("trip-media")
    .upload(path, file, {
      contentType: file.type || "audio/webm",
      upsert: false,
    });

  if (uploadError) throw new Error(`Voice upload failed: ${uploadError.message}`);

  const mediaAssetId = crypto.randomUUID();
  const { error: mediaError } = await supabase.from("media_assets").insert({
    id: mediaAssetId,
    trip_id: tripId,
    user_id: user.id,
    asset_type: "audio",
    storage_provider: "supabase_legacy",
    storage_bucket: "trip-media",
    compressed_file_path: path,
    compressed_file_size: file.size,
    mime_type: file.type || "audio/webm",
    storage_tier: "standard",
    is_original_preserved: false,
    ai_status: "pending",
    ai_metadata: {
      triggeredBy: "chat",
      originalFileName: file.name,
    },
  });

  if (mediaError) throw mediaError;

  await uploadVoiceToGoogleDrive({
    tripId,
    mediaAssetId,
    file,
  }).catch(() => null);

  let transcriptText: string | null = null;
  let transcriptStatus: JourneyChatMessage["transcriptStatus"] = "pending";
  try {
    const transcript = await requestVoiceTranscription({ tripId, audio: file });
    transcriptText = transcript.transcript;
    transcriptStatus = "completed";
  } catch {
    transcriptStatus = "failed";
  }

  const { data, error } = await supabase
    .from("journey_chat_messages")
    .insert({
      trip_id: tripId,
      user_id: user.id,
      journey_member_id: await getCurrentJourneyMemberId(tripId, user.id),
      message_type: "voice",
      text_content: transcriptText,
      media_asset_id: mediaAssetId,
      media_url: path,
      voice_duration_ms: durationMs ?? null,
      transcript_text: transcriptText,
      transcript_status: transcriptStatus,
      source_type: "chat",
    })
    .select("*")
    .single();

  if (error) throw error;
  return (await enrichMessages([mapMessage(data as ChatMessageRow)]))[0];
}

async function uploadVoiceToGoogleDrive(input: {
  tripId: string;
  mediaAssetId: string;
  file: File;
}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return;

  const form = new FormData();
  form.append("tripId", input.tripId);
  form.append("mediaAssetId", input.mediaAssetId);
  form.append("file", input.file, input.file.name || "voice.webm");

  const response = await fetch("/api/google-drive/upload-audio", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error || "Could not upload voice to Google Drive.");
  }
}

export async function revokeChatMessage(messageId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to revoke messages.");
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("journey_chat_messages")
    .update({
      deleted_at: now,
      deleted_by: user.id,
      text_content: null,
      transcript_text: null,
    })
    .eq("id", messageId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) throw error;
  return mapMessage(data as ChatMessageRow);
}

export async function markJourneyChatRead(tripId: string) {
  const user = await getCurrentUser();
  if (!user) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("journey_chat_read_states").upsert(
    {
      trip_id: tripId,
      user_id: user.id,
      last_read_at: now,
      updated_at: now,
    },
    { onConflict: "trip_id,user_id" },
  );
  if (error) throw error;
}

export async function hasUnreadJourneyChat(tripId: string) {
  await syncTimelineMemoriesToChat(tripId).catch(() => null);

  const user = await getCurrentUser();
  if (!user) return false;

  const { data: readState } = await supabase
    .from("journey_chat_read_states")
    .select("last_read_at")
    .eq("trip_id", tripId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!readState) {
    await markJourneyChatRead(tripId).catch(() => null);
    return false;
  }

  const lastReadAt =
    (readState as { last_read_at?: string | null } | null)?.last_read_at ??
    new Date(0).toISOString();

  const { count, error } = await supabase
    .from("journey_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId)
    .is("deleted_at", null)
    .gt("created_at", lastReadAt)
    .neq("user_id", user.id);

  if (error) return false;
  return (count ?? 0) > 0;
}
