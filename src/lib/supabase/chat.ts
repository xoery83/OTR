import type { JourneyChatMessage } from "@/types";
import { compressImageFile, makeSafeFileName } from "@/lib/images";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";
import { createPhotoMemory, deleteMemoryEntry } from "./memories";
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

const CHAT_MESSAGE_SELECT =
  "id, trip_id, user_id, journey_member_id, message_type, text_content, media_asset_id, memory_entry_id, media_url, voice_duration_ms, transcript_text, transcript_status, source_type, source_id, deleted_at, deleted_by, metadata, created_at, updated_at";

const CHAT_REVOKE_WINDOW_MS = 30 * 60 * 1000;

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

type JourneyMemberRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
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
  original_drive_file_id?: string | null;
  original_drive_web_url?: string | null;
  thumbnail_drive_file_id?: string | null;
  thumbnail_drive_web_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  original_file_size: number | null;
  compressed_file_size: number | null;
  thumbnail_size?: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  thumbnail_width?: number | null;
  thumbnail_height?: number | null;
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

const CHAT_MEDIA_SELECT =
  "id, trip_id, user_id, memory_entry_id, asset_type, storage_provider, storage_bucket, original_file_path, compressed_file_path, thumbnail_file_path, provider_file_id, provider_drive_id, provider_web_url, provider_thumbnail_url, provider_original_reference, original_drive_file_id, original_drive_web_url, thumbnail_drive_file_id, thumbnail_drive_web_url, thumbnail_url, preview_url, original_file_size, compressed_file_size, thumbnail_size, mime_type, width, height, thumbnail_width, thumbnail_height, storage_tier, is_original_preserved, retention_until, taken_at, gps_latitude, gps_longitude, camera_model, orientation, exif_json, ai_status, ai_metadata, ocr_text, duplicate_score, blur_score, scene_tags, indexed_at, created_at";

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

function getMessageMemoryKey(message: JourneyChatMessage) {
  return message.memoryEntryId ?? message.sourceId ?? null;
}

function getMessageDedupeKeys(message: JourneyChatMessage) {
  return [
    getMessageMemoryKey(message) ? `memory:${getMessageMemoryKey(message)}` : null,
    message.mediaAssetId ? `asset:${message.mediaAssetId}` : null,
    message.mediaUrl ? `media-url:${message.mediaUrl}` : null,
  ].filter((key): key is string => Boolean(key));
}

function dedupeMessages(messages: JourneyChatMessage[]) {
  const keyedIndexes = new Map<string, number>();
  const deduped: JourneyChatMessage[] = [];

  for (const message of messages) {
    const keys = getMessageDedupeKeys(message);
    if (keys.length === 0) {
      deduped.push(message);
      continue;
    }

    const existingIndex = keys
      .map((key) => keyedIndexes.get(key))
      .find((index): index is number => index !== undefined);
    if (existingIndex === undefined) {
      const index = deduped.length;
      keys.forEach((key) => keyedIndexes.set(key, index));
      deduped.push(message);
      continue;
    }

    const existing = deduped[existingIndex];
    const shouldReplace =
      existing.sourceType === "timeline_memory" && message.sourceType !== "timeline_memory";
    if (shouldReplace) {
      deduped[existingIndex] = message;
      keys.forEach((key) => keyedIndexes.set(key, existingIndex));
    }
  }

  return deduped;
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
    originalDriveFileId: row.original_drive_file_id ?? null,
    originalDriveWebUrl: row.original_drive_web_url ?? null,
    thumbnailDriveFileId: row.thumbnail_drive_file_id ?? null,
    thumbnailDriveWebUrl: row.thumbnail_drive_web_url ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    previewUrl: row.preview_url ?? null,
    originalFileSize: row.original_file_size,
    compressedFileSize: row.compressed_file_size,
    thumbnailSize: row.thumbnail_size ?? null,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    thumbnailWidth: row.thumbnail_width ?? null,
    thumbnailHeight: row.thumbnail_height ?? null,
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

function directMediaDisplayUrl(media: MediaRow) {
  return (
    media.thumbnail_url ??
    (media.asset_type === "video" ? null : media.preview_url) ??
    media.provider_thumbnail_url ??
    media.thumbnail_drive_web_url ??
    null
  );
}

function messageTextFromMemory(memory: MemorySyncRow) {
  const content = cleanSyncedMemoryContent(memory.content);
  if (memory.type === "photo") return content || null;
  if (memory.type === "voice") return content || "语音";
  if (memory.type === "location") return content || "位置";
  return content;
}

function cleanSyncedMemoryContent(content: string | null) {
  return (content ?? "")
    .replace(/^__otr_reply_parent:[0-9a-f-]+__\s*/i, "")
    .trim();
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
  const tripIds = [...new Set(messages.map((message) => message.tripId).filter(Boolean))];
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

  const membersById = new Map<string, JourneyMemberRow>();
  const membersByTripAndUserId = new Map<string, JourneyMemberRow>();
  if (tripIds.length > 0) {
    const { data } = await supabase
      .from("journey_members")
      .select("id, trip_id, user_id, display_name, avatar_url")
      .in("trip_id", tripIds);
    ((data ?? []) as JourneyMemberRow[]).forEach((member) => {
      membersById.set(member.id, member);
      if (member.user_id) {
        membersByTripAndUserId.set(`${member.trip_id}:${member.user_id}`, member);
      }
    });
  }

  const mediaById = new Map<string, MediaRow>();
  if (mediaAssetIds.length > 0) {
    const { data } = await supabase
      .from("media_assets")
      .select(CHAT_MEDIA_SELECT)
      .in("id", mediaAssetIds);
    ((data ?? []) as MediaRow[]).forEach((media) => {
      mediaById.set(media.id, media);
    });
  }

  const paths = [
    ...new Set(
      messages
        .map((message) => {
          const media = mediaById.get(message.mediaAssetId ?? "");
          if (media && directMediaDisplayUrl(media)) return null;
          return media?.thumbnail_file_path ?? media?.compressed_file_path;
        })
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
    const journeyMember =
      (message.journeyMemberId ? membersById.get(message.journeyMemberId) : null) ??
      (message.userId
        ? membersByTripAndUserId.get(`${message.tripId}:${message.userId}`)
        : null);
    const media = message.mediaAssetId ? mediaById.get(message.mediaAssetId) : null;
    const mediaDisplayPath = media?.thumbnail_file_path ?? media?.compressed_file_path;
    const legacyMediaDisplayUrl = mediaDisplayPath
      ? signedUrls.get(mediaDisplayPath) ?? null
      : null;
    const mediaDisplayUrl =
      media && (media.asset_type === "image" || media.asset_type === "video")
        ? directMediaDisplayUrl(media) ??
          legacyMediaDisplayUrl ??
          `/api/media/assets/${media.id}/thumbnail`
        : legacyMediaDisplayUrl;

    return {
      ...message,
      senderName: journeyMember?.display_name || profile?.display_name || "Traveler",
      senderAvatarUrl: profile?.avatar_url || journeyMember?.avatar_url || null,
      mediaDisplayUrl,
      photoAsset:
        media && (media.asset_type === "image" || media.asset_type === "video")
          ? mapPhotoAsset(media, mediaDisplayUrl)
          : null,
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
    .select(CHAT_MESSAGE_SELECT)
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
  const messages = await enrichMessages(dedupeMessages(selectedRows.map(mapMessage)));
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

export async function sendTextChatMessage(
  tripId: string,
  text: string,
  clientUploadId?: string | null,
) {
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
      metadata: clientUploadId ? { clientUploadId } : {},
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
  clientUploadId?: string | null,
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
  const journeyMemberId = await getCurrentJourneyMemberId(tripId, user.id);

  try {
    const { data: existingRows } = await supabase
      .from("journey_chat_messages")
      .select("*")
      .eq("trip_id", tripId)
      .or(`memory_entry_id.eq.${memory.id},source_id.eq.${memory.id}`)
      .order("created_at", { ascending: false })
      .limit(1);

    const existing = (existingRows ?? [])[0] as ChatMessageRow | undefined;
    const payload = {
      user_id: user.id,
      journey_member_id: journeyMemberId,
      message_type: "image",
      text_content: caption.trim() || null,
      media_asset_id: memory.mediaAssetId,
      memory_entry_id: memory.id,
      media_url: memory.mediaUrl,
      source_type: "chat",
      source_id: null,
      metadata: {
        originalFileName: file.name,
        ...(clientUploadId ? { clientUploadId } : {}),
      },
    };

    const query = existing
      ? supabase
          .from("journey_chat_messages")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single()
      : supabase
          .from("journey_chat_messages")
          .insert({
            trip_id: tripId,
            ...payload,
          })
          .select("*")
          .single();

    const { data, error } = await query;
    if (error) throw error;
    const saved = mapMessage(data as ChatMessageRow);
    try {
      await supabase
        .from("journey_chat_messages")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq("trip_id", tripId)
        .eq("source_type", "timeline_memory")
        .neq("id", saved.id)
        .or(
          `memory_entry_id.eq.${memory.id},source_id.eq.${memory.id},media_asset_id.eq.${memory.mediaAssetId},media_url.eq.${memory.mediaUrl}`,
        );
    } catch {
      // Best effort cleanup; the saved chat message is still valid.
    }
    return (await enrichMessages([saved]))[0];
  } finally {
    compressedImage.previewUrl && URL.revokeObjectURL(compressedImage.previewUrl);
  }
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

  const { data, error } = await supabase
    .from("journey_chat_messages")
    .insert({
      trip_id: tripId,
      user_id: user.id,
      journey_member_id: await getCurrentJourneyMemberId(tripId, user.id),
      message_type: "voice",
      text_content: null,
      media_asset_id: mediaAssetId,
      media_url: path,
      voice_duration_ms: durationMs ?? null,
      transcript_text: null,
      transcript_status: "processing",
      source_type: "chat",
    })
    .select("*")
    .single();

  if (error) throw error;
  const message = mapMessage(data as ChatMessageRow);

  void finishVoiceChatMessage({
    tripId,
    messageId: message.id,
    mediaAssetId,
    file,
  });

  return (await enrichMessages([message]))[0];
}

async function finishVoiceChatMessage(input: {
  tripId: string;
  messageId: string;
  mediaAssetId: string;
  file: File;
}) {
  void uploadVoiceToGoogleDrive({
    tripId: input.tripId,
    mediaAssetId: input.mediaAssetId,
    file: input.file,
  }).catch(() => null);

  try {
    const transcript = await requestVoiceTranscription({
      tripId: input.tripId,
      audio: input.file,
    });
    await supabase
      .from("journey_chat_messages")
      .update({
        text_content: transcript.transcript,
        transcript_text: transcript.transcript,
        transcript_status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.messageId);
  } catch {
    await supabase
      .from("journey_chat_messages")
      .update({
        transcript_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.messageId);
  }
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

  const { data: revoked, error: rpcError } = await supabase.rpc(
    "revoke_journey_chat_message_for_current_user",
    { target_message_id: messageId },
  );

  if (!rpcError && revoked) {
    return mapMessage(revoked as ChatMessageRow);
  }

  if (
    rpcError &&
    rpcError.code !== "PGRST202" &&
    !rpcError.message.includes("function")
  ) {
    throw rpcError;
  }

  const { data: existing, error: loadError } = await supabase
    .from("journey_chat_messages")
    .select(CHAT_MESSAGE_SELECT)
    .eq("id", messageId)
    .eq("user_id", user.id)
    .single();

  if (loadError) throw loadError;
  const current = mapMessage(existing as ChatMessageRow);
  if (current.sourceType !== "chat") {
    throw new Error("Only messages sent from group chat can be revoked here.");
  }
  if (current.deletedAt) {
    throw new Error("Message has already been revoked.");
  }
  if (Date.now() - new Date(current.createdAt).getTime() > CHAT_REVOKE_WINDOW_MS) {
    throw new Error("Messages can only be revoked within 30 minutes.");
  }

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
  if (current.memoryEntryId) {
    await deleteMemoryEntry(current.memoryEntryId);
  }
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
