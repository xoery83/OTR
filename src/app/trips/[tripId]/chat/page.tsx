"use client";

import { useParams } from "next/navigation";
import type { PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { getErrorMessage } from "@/lib/errors";
import { getPhotoFacesForAssets } from "@/lib/supabase/media-assets";
import {
  getJourneyChatMessages,
  getOlderJourneyChatMessages,
  markJourneyChatRead,
  revokeChatMessage,
  sendImageChatMessage,
  sendTextChatMessage,
  sendVoiceChatMessage,
} from "@/lib/supabase/chat";
import { supabase } from "@/lib/supabase/client";
import { getTrip } from "@/lib/supabase/trips";
import type { JourneyChatMessage, PhotoFace, Trip } from "@/types";

const commonEmojis = [
  "😀",
  "😂",
  "🤣",
  "🥰",
  "😍",
  "😎",
  "🤔",
  "😭",
  "😴",
  "😅",
  "😡",
  "😜",
  "🙏",
  "👍",
  "👌",
  "👏",
  "🎉",
  "🔥",
  "❤️",
  "✌️",
  "😷",
  "😮",
  "🙄",
  "😬",
  "😢",
  "🙂",
  "😇",
  "🤐",
  "☕",
  "🍜",
  "🍻",
  "✈️",
  "🚗",
  "🏔️",
  "🌧️",
  "📍",
  "💸",
  "✅",
  "⭐",
  "📷",
];

const emojiTabs = ["⌕", "☺", "♡", "✌", "😎", "🐰"];

type LocalChatPendingStatus = "uploading" | "failed";

function getLocalPendingStatus(message: JourneyChatMessage) {
  const value = message.metadata?.pendingStatus;
  return value === "uploading" || value === "failed" ? value : null;
}

function getClientUploadId(message: JourneyChatMessage) {
  const value = message.metadata?.clientUploadId;
  return typeof value === "string" && value ? value : null;
}

function isLocalPendingMessage(message: JourneyChatMessage) {
  return getLocalPendingStatus(message) !== null;
}

function getMessageDedupeKeys(message: JourneyChatMessage) {
  return [
    getClientUploadId(message) ? `upload:${getClientUploadId(message)}` : null,
    message.memoryEntryId ? `memory:${message.memoryEntryId}` : null,
    message.sourceId ? `memory:${message.sourceId}` : null,
    message.mediaAssetId ? `asset:${message.mediaAssetId}` : null,
    message.mediaUrl ? `media-url:${message.mediaUrl}` : null,
    message.photoAsset?.compressedFilePath
      ? `media-path:${message.photoAsset.compressedFilePath}`
      : null,
  ].filter((key): key is string => Boolean(key));
}

function shouldPreferMessage(
  existing: JourneyChatMessage,
  incoming: JourneyChatMessage,
) {
  if (isLocalPendingMessage(existing) && !isLocalPendingMessage(incoming)) return true;
  if (existing.sourceType === "timeline_memory" && incoming.sourceType !== "timeline_memory") {
    return true;
  }
  return false;
}

function dedupeChatMessages(messages: JourneyChatMessage[]) {
  const keyIndexes = new Map<string, number>();
  const deduped: JourneyChatMessage[] = [];

  for (const message of messages) {
    const keys = getMessageDedupeKeys(message);
    const existingIndex = keys
      .map((key) => keyIndexes.get(key))
      .find((index): index is number => index !== undefined);

    if (existingIndex === undefined) {
      const index = deduped.length;
      deduped.push(message);
      keys.forEach((key) => keyIndexes.set(key, index));
      continue;
    }

    if (shouldPreferMessage(deduped[existingIndex], message)) {
      deduped[existingIndex] = message;
      keys.forEach((key) => keyIndexes.set(key, existingIndex));
    }
  }

  return deduped.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function mergeLoadedMessages(
  current: JourneyChatMessage[],
  loaded: JourneyChatMessage[],
) {
  const loadedUploadIds = new Set(
    loaded.map(getClientUploadId).filter((value): value is string => Boolean(value)),
  );
  const pendingToKeep = current.filter((message) => {
    if (!isLocalPendingMessage(message)) return false;
    const clientUploadId = getClientUploadId(message);
    return !clientUploadId || !loadedUploadIds.has(clientUploadId);
  });

  return dedupeChatMessages([...loaded, ...pendingToKeep]);
}

function isSafariBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/(Chrome|CriOS|FxiOS|Edg|OPR)/i.test(ua);
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString("zh-CN", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function shouldShowTime(previous: JourneyChatMessage | null, current: JourneyChatMessage) {
  if (!previous) return true;
  return new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() > 300_000;
}

function Avatar({ message, mine }: { message: JourneyChatMessage; mine: boolean }) {
  const initial = (message.senderName || "T").trim().slice(0, 1).toUpperCase();
  if (message.senderAvatarUrl) {
    return (
      <img
        src={message.senderAvatarUrl}
        alt={message.senderName || "Traveler"}
        className="h-9 w-9 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black ${
        mine ? "bg-emerald-700 text-white" : "bg-white/80 text-stone-700"
      }`}
    >
      {initial}
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  onOpenImage,
  onRevoke,
  onMediaLoad,
}: {
  message: JourneyChatMessage;
  mine: boolean;
  onOpenImage: (message: JourneyChatMessage) => void;
  onRevoke: (message: JourneyChatMessage) => void;
  onMediaLoad: () => void;
}) {
  const fromTimeline = message.sourceType === "timeline_memory";
  const pendingStatus = getLocalPendingStatus(message);

  if (message.deletedAt) {
    return (
      <div className="mx-auto rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-stone-500 shadow-sm">
        {mine ? "你撤回了一条消息" : `${message.senderName || "成员"} 撤回了一条消息`}
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <Avatar message={message} mine={mine} />
      <div className={`flex max-w-[74%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {!mine ? (
          <div className="mb-1 px-1 text-xs font-bold text-white drop-shadow">
            {message.senderName || "Traveler"}
          </div>
        ) : null}
        <div
          className={`relative rounded-2xl px-3 py-2 text-[15px] font-semibold leading-relaxed shadow-sm ${
            mine
              ? "rounded-tr-sm bg-[#95ec69] text-stone-950"
              : "rounded-tl-sm bg-white text-stone-950"
          }`}
        >
          {fromTimeline ? (
            <div className="mb-1 text-[11px] font-black text-emerald-700">
              来自动态
            </div>
          ) : null}

          {message.messageType === "image" && message.mediaDisplayUrl ? (
            <button
              type="button"
              onClick={() => onOpenImage(message)}
              className="block overflow-hidden rounded-xl bg-stone-100"
              aria-label="打开图片"
            >
              <img
                src={message.mediaDisplayUrl}
                alt={message.textContent || "聊天图片"}
                onLoad={onMediaLoad}
                className="max-h-56 w-48 object-cover"
              />
            </button>
          ) : null}
          {message.messageType === "image" && pendingStatus ? (
            <div className="mt-2 text-xs font-black text-stone-500">
              {pendingStatus === "failed" ? "图片发送失败" : "图片上传中..."}
            </div>
          ) : null}

          {message.messageType === "voice" ? (
            <div className="min-w-44">
              <div className="flex items-center gap-2">
                <span className="text-lg">◉</span>
                <div className="h-5 flex-1 rounded-full bg-current/10">
                  <div className="mt-2 h-1 w-2/3 rounded-full bg-current/40" />
                </div>
                <span className="text-xs font-black">
                  {message.voiceDurationMs
                    ? `${Math.max(1, Math.round(message.voiceDurationMs / 1000))}″`
                    : "语音"}
                </span>
              </div>
              {message.mediaDisplayUrl && pendingStatus !== "uploading" ? (
                <audio src={message.mediaDisplayUrl} controls className="mt-2 h-8 w-full" />
              ) : null}
              {message.transcriptText ? (
                <div className="mt-2 border-t border-black/10 pt-2 text-sm font-medium text-stone-700">
                  {message.transcriptText}
                </div>
              ) : (
                <div className="mt-2 text-xs font-bold text-stone-500">
                  {pendingStatus === "uploading"
                    ? "发送中，上传完成后可播放"
                    : pendingStatus === "failed"
                      ? "发送失败"
                      : message.transcriptStatus === "failed"
                        ? "转文字失败"
                        : "正在转文字"}
                </div>
              )}
            </div>
          ) : null}

          {message.textContent && message.messageType !== "voice" ? (
            <div className={message.messageType === "image" ? "mt-2" : ""}>
              {message.textContent}
            </div>
          ) : null}

          {message.messageType === "text" && pendingStatus ? (
            <div className="mt-1 text-[11px] font-black text-stone-500">
              {pendingStatus === "failed" ? "发送失败" : "发送中..."}
            </div>
          ) : null}

          {mine && !pendingStatus ? (
            <button
              type="button"
              onClick={() => onRevoke(message)}
              className="mt-1 block text-right text-[11px] font-black text-stone-500"
            >
              撤回
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ImageViewer({
  message,
  faces,
  onClose,
}: {
  message: JourneyChatMessage | null;
  faces: PhotoFace[];
  onClose: () => void;
}) {
  if (!message?.mediaDisplayUrl) return null;

  return (
    <PhotoLightbox
      imageUrl={message.mediaDisplayUrl}
      title={message.textContent || "图片"}
      subtitle={`${message.senderName || "Traveler"} · ${formatMessageTime(message.createdAt)}`}
      photo={message.photoAsset}
      faces={faces}
      variant="minimal"
      onClose={onClose}
    />
  );
}

function ChatContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const hasPrimedSafariMicrophoneRef = useRef(false);
  const hasMarkedReadRef = useRef(false);
  const initialAutoScrollUntilRef = useRef(0);
  const dismissedUnreadMessageIdRef = useRef<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [messages, setMessages] = useState<JourneyChatMessage[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null);
  const [showUnreadJump, setShowUnreadJump] = useState(false);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [text, setText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [uploadingImageCount, setUploadingImageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [isPrimingMicrophone, setIsPrimingMicrophone] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isSwitchingToKeyboard, setIsSwitchingToKeyboard] = useState(false);
  const [isTextFocused, setIsTextFocused] = useState(false);
  const [activeImage, setActiveImage] = useState<JourneyChatMessage | null>(null);
  const [activeImageFaces, setActiveImageFaces] = useState<PhotoFace[]>([]);

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      const list = listRef.current;
      bottomRef.current?.scrollIntoView({ block: "end" });
      if (list) list.scrollTop = list.scrollHeight;
    });
  }, []);

  const scheduleBottomLock = useCallback(() => {
    scrollToBottom();
    window.setTimeout(scrollToBottom, 80);
    window.setTimeout(scrollToBottom, 260);
    window.setTimeout(scrollToBottom, 700);
  }, [scrollToBottom]);

  const load = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    const [tripData, bundle] = await Promise.all([
      getTrip(tripId),
      getJourneyChatMessages(tripId),
    ]);
    setTrip(tripData);
    setMessages((current) => mergeLoadedMessages(current, bundle.messages));
    setCurrentUserId(bundle.currentUserId);
    setFirstUnreadMessageId(
      bundle.firstUnreadMessageId &&
        bundle.firstUnreadMessageId !== dismissedUnreadMessageIdRef.current
        ? bundle.firstUnreadMessageId
        : null,
    );
    setHasMoreBefore(bundle.hasMoreBefore);
    if (mode === "initial") {
      initialAutoScrollUntilRef.current = Date.now() + 1800;
    }
    if (!hasMarkedReadRef.current) {
      hasMarkedReadRef.current = true;
      await markJourneyChatRead(tripId).catch(() => null);
    }
    window.dispatchEvent(new CustomEvent("otr:chat-changed"));
    if (mode === "initial" || isNearBottom()) {
      scheduleBottomLock();
    }
  }, [scheduleBottomLock, tripId]);

  function isNearBottom() {
    const list = listRef.current;
    if (!list) return true;
    return list.scrollHeight - list.scrollTop - list.clientHeight < 180;
  }

  const updateUnreadJumpVisibility = useCallback(() => {
    if (
      !firstUnreadMessageId ||
      dismissedUnreadMessageIdRef.current === firstUnreadMessageId
    ) {
      setShowUnreadJump(false);
      return;
    }

    const list = listRef.current;
    if (!list) {
      setShowUnreadJump(false);
      return;
    }

    const unreadElement = document.getElementById(`chat-message-${firstUnreadMessageId}`);
    if (!unreadElement) {
      setShowUnreadJump(hasMoreBefore);
      return;
    }

    const listRect = list.getBoundingClientRect();
    const unreadRect = unreadElement.getBoundingClientRect();
    setShowUnreadJump(unreadRect.bottom < listRect.top + 16);
  }, [firstUnreadMessageId, hasMoreBefore]);

  const loadOlderMessages = useCallback(async () => {
    const first = messages[0];
    if (!first || !hasMoreBefore || isLoadingOlder) return;
    const list = listRef.current;
    const previousHeight = list?.scrollHeight ?? 0;
    setIsLoadingOlder(true);
    try {
      const bundle = await getOlderJourneyChatMessages({
        tripId,
        before: first.createdAt,
      });
      setMessages((current) => {
        const existingIds = new Set(current.map((message) => message.id));
        return [
          ...bundle.messages.filter((message) => !existingIds.has(message.id)),
          ...current,
        ];
      });
      setHasMoreBefore(bundle.hasMoreBefore);
      window.requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - previousHeight;
      });
    } catch (olderError) {
      setError(getErrorMessage(olderError, "加载更早消息失败。"));
    } finally {
      setIsLoadingOlder(false);
    }
  }, [hasMoreBefore, isLoadingOlder, messages, tripId]);

  const loadOlderMessagesUntil = useCallback(
    async (targetMessageId: string) => {
      let workingMessages = messages;
      let workingHasMore = hasMoreBefore;

      while (
        workingHasMore &&
        !workingMessages.some((message) => message.id === targetMessageId)
      ) {
        const first = workingMessages[0];
        if (!first) break;
        const bundle = await getOlderJourneyChatMessages({
          tripId,
          before: first.createdAt,
        });
        const existingIds = new Set(workingMessages.map((message) => message.id));
        workingMessages = [
          ...bundle.messages.filter((message) => !existingIds.has(message.id)),
          ...workingMessages,
        ];
        workingHasMore = bundle.hasMoreBefore;
      }

      setMessages(workingMessages);
      setHasMoreBefore(workingHasMore);
      return workingMessages.some((message) => message.id === targetMessageId);
    },
    [hasMoreBefore, messages, tripId],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsLoading(true);
      setError(null);
      try {
        await load("initial");
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError, "群聊加载失败。"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrap();
    const interval = window.setInterval(() => void load("refresh").catch(() => null), 20_000);
    const channel = supabase
      .channel(`journey-chat-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "journey_chat_messages",
          filter: `trip_id=eq.${tripId}`,
        },
        () => {
          void load("refresh").catch(() => null);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [load, tripId]);

  useEffect(() => {
    void markJourneyChatRead(tripId).catch(() => null);
    window.dispatchEvent(new CustomEvent("otr:chat-changed"));
  }, [messages.length, tripId]);

  useEffect(() => {
    if (!isLoading && messages.length > 0 && initialAutoScrollUntilRef.current > Date.now()) {
      scheduleBottomLock();
    }
  }, [isLoading, messages.length, scheduleBottomLock]);

  useEffect(() => {
    document.body.classList.toggle(
      "otr-chat-keyboard-active",
      isTextFocused || showEmoji || isSwitchingToKeyboard,
    );
    document.body.classList.toggle("otr-chat-emoji-active", showEmoji);
    return () => {
      document.body.classList.remove("otr-chat-keyboard-active");
      document.body.classList.remove("otr-chat-emoji-active");
    };
  }, [isSwitchingToKeyboard, isTextFocused, showEmoji]);

  useEffect(() => {
    let cancelled = false;
    const assetId = activeImage?.photoAsset?.id ?? activeImage?.mediaAssetId;
    setActiveImageFaces([]);
    if (!assetId) return;
    const resolvedAssetId = assetId;

    async function loadFaces() {
      try {
        const groups = await getPhotoFacesForAssets([resolvedAssetId]);
        if (!cancelled) setActiveImageFaces(groups[resolvedAssetId] ?? []);
      } catch {
        if (!cancelled) setActiveImageFaces([]);
      }
    }

    void loadFaces();
    return () => {
      cancelled = true;
    };
  }, [activeImage]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const currentList = list;

    function handleScroll() {
      if (currentList.scrollTop < 96) {
        void loadOlderMessages();
      }
      updateUnreadJumpVisibility();
    }

    currentList.addEventListener("scroll", handleScroll, { passive: true });
    return () => currentList.removeEventListener("scroll", handleScroll);
  }, [loadOlderMessages, updateUnreadJumpVisibility]);

  useEffect(() => {
    window.requestAnimationFrame(updateUnreadJumpVisibility);
  }, [messages, updateUnreadJumpVisibility]);

  const recorder = useVoiceRecorder({
    maxDurationMs: 90_000,
    silenceMs: 90_000,
    onRecordingComplete: (file) => {
      const durationMs = recordingStartedAtRef.current
        ? Date.now() - recordingStartedAtRef.current
        : null;
      recordingStartedAtRef.current = null;
      void sendVoice(file, durationMs);
    },
    onError: (recordingError) => setError(recordingError.message),
  });

  const focusTextInput = useCallback(() => {
    setVoiceMode(false);
    setShowEmoji(false);
    setIsSwitchingToKeyboard(true);
    window.setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true });
      window.setTimeout(() => {
        textareaRef.current?.focus({ preventScroll: true });
        setIsSwitchingToKeyboard(false);
      }, 80);
    }, 40);
  }, []);

  const closeTextInputArea = useCallback(() => {
    textareaRef.current?.blur();
    setIsTextFocused(false);
    setShowEmoji(false);
    setIsSwitchingToKeyboard(false);
  }, []);

  function toggleEmojiPanel() {
    if (showEmoji) {
      focusTextInput();
      return;
    }
    setVoiceMode(false);
    textareaRef.current?.blur();
    setIsTextFocused(false);
    setShowEmoji(true);
    scheduleBottomLock();
  }

  function removeLastEmojiCharacter() {
    setText((current) => Array.from(current).slice(0, -1).join(""));
  }

  const sendText = useCallback(async () => {
    const value = text.trim();
    if (!value || isSending) return;
    const clientUploadId = crypto.randomUUID();
    const now = new Date().toISOString();
    const pendingMessage: JourneyChatMessage = {
      id: `pending-text-${clientUploadId}`,
      tripId,
      userId: currentUserId,
      journeyMemberId: null,
      messageType: "text",
      textContent: value,
      mediaAssetId: null,
      memoryEntryId: null,
      mediaUrl: null,
      voiceDurationMs: null,
      transcriptText: null,
      transcriptStatus: null,
      sourceType: "chat",
      sourceId: null,
      deletedAt: null,
      deletedBy: null,
      metadata: {
        pendingStatus: "uploading" satisfies LocalChatPendingStatus,
        clientUploadId,
      },
      createdAt: now,
      updatedAt: now,
      senderName: "我",
      senderAvatarUrl: null,
      mediaDisplayUrl: null,
      photoAsset: null,
    };

    setIsSending(true);
    setError(null);
    setMessages((current) => [...current, pendingMessage]);
    setText("");
    scheduleBottomLock();
    try {
      const message = await sendTextChatMessage(tripId, value, clientUploadId);
      setMessages((current) => {
        const withoutSameUpload = current.filter(
          (item) =>
            item.id === pendingMessage.id || getClientUploadId(item) !== clientUploadId,
        );
        if (!withoutSameUpload.some((item) => item.id === pendingMessage.id)) {
          return [...withoutSameUpload, message].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
        }
        return withoutSameUpload.map((item) =>
          item.id === pendingMessage.id ? message : item,
        );
      });
      scheduleBottomLock();
      window.dispatchEvent(new CustomEvent("otr:chat-changed"));
    } catch (sendError) {
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingMessage.id
            ? {
                ...item,
                metadata: { ...item.metadata, pendingStatus: "failed" },
              }
            : item,
        ),
      );
      setError(getErrorMessage(sendError, "发送失败。"));
    } finally {
      setIsSending(false);
    }
  }, [currentUserId, isSending, scheduleBottomLock, text, tripId]);

  const sendVoice = useCallback(
    async (file: File, durationMs: number | null) => {
      if (isSending) return;
      const pendingId = `pending-voice-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const pendingMessage: JourneyChatMessage = {
        id: pendingId,
        tripId,
        userId: currentUserId,
        journeyMemberId: null,
        messageType: "voice",
        textContent: null,
        mediaAssetId: null,
        memoryEntryId: null,
        mediaUrl: null,
        voiceDurationMs: durationMs,
        transcriptText: null,
        transcriptStatus: "processing",
        sourceType: "chat",
        sourceId: null,
        deletedAt: null,
        deletedBy: null,
        metadata: { pendingStatus: "uploading" satisfies LocalChatPendingStatus },
        createdAt: now,
        updatedAt: now,
        senderName: "我",
        senderAvatarUrl: null,
        mediaDisplayUrl: null,
        photoAsset: null,
      };

      setIsSending(true);
      setError(null);
      setMessages((current) => [...current, pendingMessage]);
      scheduleBottomLock();
      try {
        const message = await sendVoiceChatMessage(tripId, file, durationMs);
        setMessages((current) => {
          if (!current.some((item) => item.id === pendingId)) return [...current, message];
          return current.map((item) => (item.id === pendingId ? message : item));
        });
        scheduleBottomLock();
        window.dispatchEvent(new CustomEvent("otr:chat-changed"));
      } catch (sendError) {
        setMessages((current) =>
          current.map((item) =>
            item.id === pendingId
              ? {
                  ...item,
                  transcriptStatus: "failed",
                  metadata: { ...item.metadata, pendingStatus: "failed" },
                }
              : item,
          ),
        );
        setError(getErrorMessage(sendError, "语音发送失败。"));
      } finally {
        setIsSending(false);
      }
    },
    [currentUserId, isSending, scheduleBottomLock, tripId],
  );

  async function sendImages(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;

    const caption = text.trim();
    const now = Date.now();
    const pendingMessages = files.map((file, index) => {
      const clientUploadId = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      const createdAt = new Date(now + index).toISOString();
      return {
        id: `pending-image-${clientUploadId}`,
        clientUploadId,
        file,
        previewUrl,
        caption: index === 0 ? caption : "",
        message: {
          id: `pending-image-${clientUploadId}`,
          tripId,
          userId: currentUserId,
          journeyMemberId: null,
          messageType: "image" as const,
          textContent: index === 0 ? caption || "图片" : "图片",
          mediaAssetId: null,
          memoryEntryId: null,
          mediaUrl: null,
          voiceDurationMs: null,
          transcriptText: null,
          transcriptStatus: null,
          sourceType: "chat" as const,
          sourceId: null,
          deletedAt: null,
          deletedBy: null,
          metadata: {
            pendingStatus: "uploading" satisfies LocalChatPendingStatus,
            clientUploadId,
          },
          createdAt,
          updatedAt: createdAt,
          senderName: "我",
          senderAvatarUrl: null,
          mediaDisplayUrl: previewUrl,
          photoAsset: null,
        } satisfies JourneyChatMessage,
      };
    });

    setError(null);
    setText("");
    setShowEmoji(false);
    setUploadingImageCount((current) => current + pendingMessages.length);
    setMessages((current) => [
      ...current,
      ...pendingMessages.map((pending) => pending.message),
    ]);
    scheduleBottomLock();
    if (fileInputRef.current) fileInputRef.current.value = "";

    pendingMessages.forEach((pending) => {
      void (async () => {
        try {
          const message = await sendImageChatMessage(
            tripId,
            pending.file,
            pending.caption,
            pending.clientUploadId,
          );
          setMessages((current) => {
            const withoutSameUpload = current.filter(
              (item) =>
                item.id === pending.message.id ||
                getClientUploadId(item) !== pending.clientUploadId,
            );
            if (!withoutSameUpload.some((item) => item.id === pending.message.id)) {
              return dedupeChatMessages([...withoutSameUpload, message]);
            }
            return dedupeChatMessages(
              withoutSameUpload.map((item) =>
                item.id === pending.message.id ? message : item,
              ),
            );
          });
          window.dispatchEvent(new CustomEvent("otr:chat-changed"));
        } catch (sendError) {
          setMessages((current) =>
            current.map((item) =>
              item.id === pending.message.id
                ? {
                    ...item,
                    metadata: { ...item.metadata, pendingStatus: "failed" },
                    textContent: item.textContent || "图片发送失败",
                  }
                : item,
            ),
          );
          setError(getErrorMessage(sendError, "图片发送失败。"));
        } finally {
          URL.revokeObjectURL(pending.previewUrl);
          setUploadingImageCount((current) => Math.max(0, current - 1));
          scheduleBottomLock();
        }
      })();
    });
  }

  async function revoke(message: JourneyChatMessage) {
    try {
      const updated = await revokeChatMessage(message.id);
      setMessages((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
      window.dispatchEvent(new CustomEvent("otr:chat-changed"));
    } catch (revokeError) {
      setError(getErrorMessage(revokeError, "撤回失败。"));
    }
  }

  async function primeSafariMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持语音录制。");
      return;
    }
    setIsPrimingMicrophone(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      hasPrimedSafariMicrophoneRef.current = true;
      setError("麦克风权限已开启，请重新按住说话。");
    } catch (primeError) {
      setError(getErrorMessage(primeError, "无法打开麦克风权限。"));
    } finally {
      setIsPrimingMicrophone(false);
    }
  }

  function startHoldToTalk(event: PointerEvent<HTMLButtonElement>) {
    if (isSafariBrowser() && !hasPrimedSafariMicrophoneRef.current) {
      void primeSafariMicrophone();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    recordingStartedAtRef.current = Date.now();
    void recorder.start();
  }

  function stopHoldToTalk(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    recorder.stop();
  }

  async function jumpToFirstUnread() {
    const unreadId = firstUnreadMessageId;
    if (!unreadId) return;
    dismissedUnreadMessageIdRef.current = unreadId;
    setFirstUnreadMessageId(null);
    setShowUnreadJump(false);

    if (!document.getElementById(`chat-message-${unreadId}`)) {
      setIsLoadingOlder(true);
      await loadOlderMessagesUntil(unreadId).catch((jumpError) => {
        setError(getErrorMessage(jumpError, "定位新消息失败。"));
      });
      setIsLoadingOlder(false);
    }
    window.requestAnimationFrame(() => {
      document
        .getElementById(`chat-message-${unreadId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center text-sm font-black text-white/80">
          加载群聊中...
        </div>
      );
    }

    if (messages.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-8 text-center text-sm font-bold text-white/80">
          还没有聊天消息。相册里的新动态和群聊里的照片会自动出现在这里。
        </div>
      );
    }

    return (
      <div className="space-y-3 px-3 py-4">
        {hasMoreBefore ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void loadOlderMessages()}
              disabled={isLoadingOlder}
              className="rounded-full bg-white/85 px-3 py-1 text-xs font-black text-emerald-700 shadow-sm"
            >
              {isLoadingOlder ? "加载中..." : "查看更早消息"}
            </button>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const previous = index > 0 ? messages[index - 1] : null;
          const mine = Boolean(currentUserId && message.userId === currentUserId);
          return (
            <div
              key={message.id}
              id={`chat-message-${message.id}`}
              className="space-y-2 scroll-mt-24"
            >
              {shouldShowTime(previous, message) ? (
                <div className="mx-auto w-fit rounded-md bg-white/70 px-2 py-0.5 text-xs font-bold text-stone-500">
                  {formatMessageTime(message.createdAt)}
                </div>
              ) : null}
              <MessageBubble
                message={message}
                mine={mine}
                onOpenImage={setActiveImage}
                onRevoke={revoke}
                onMediaLoad={() => {
                  if (Date.now() < initialAutoScrollUntilRef.current || isNearBottom()) {
                    scheduleBottomLock();
                  }
                }}
              />
            </div>
          );
        })}
        <div ref={bottomRef} className="h-px" />
      </div>
    );
  }, [
    currentUserId,
    hasMoreBefore,
    isLoading,
    isLoadingOlder,
    loadOlderMessages,
    messages,
  ]);

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-[#dcefe9] md:static md:h-[calc(100vh-3rem)] md:min-h-[640px] md:overflow-hidden md:rounded-none">
      <div className="hidden shrink-0 border-b border-white/40 bg-white/90 px-4 pb-3 pt-4 shadow-sm backdrop-blur md:block">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <div className="text-xs font-black text-emerald-700">Journey 群聊</div>
            <h1 className="text-lg font-black text-stone-950">
              {trip?.name || "群聊"}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => void load().catch(() => null)}
            className="rounded-full bg-white px-4 py-2 text-sm font-black text-stone-700 shadow-sm"
          >
            刷新
          </button>
        </div>
      </div>

      <div
        ref={listRef}
        className="otr-chat-message-list min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(0,105,82,0.24),rgba(0,105,82,0.12)),linear-gradient(135deg,#b9e5d8,#e8f5ef_48%,#bfded5)] pb-[176px] pt-20 md:pb-4 md:pt-2"
      >
        {content}
      </div>

      {showUnreadJump ? (
        <button
          type="button"
          onClick={() => void jumpToFirstUnread()}
          className="fixed right-4 top-24 z-40 rounded-full bg-white/95 px-4 py-2 text-sm font-black text-emerald-700 shadow-lg md:absolute md:right-6 md:top-20"
        >
          ↑ 新消息
        </button>
      ) : null}

      {error ? (
        <div className="fixed inset-x-4 bottom-[172px] z-40 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 shadow-xl md:absolute md:bottom-20 md:left-1/2 md:right-auto md:w-full md:max-w-xl md:-translate-x-1/2">
          {error}
        </div>
      ) : null}

      {recorder.isRecording ? (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/60 text-white backdrop-blur-sm">
          <div className="rounded-3xl bg-[#95ec69] px-16 py-10 text-emerald-950 shadow-2xl">
            <div className="text-center text-4xl font-black tracking-widest">▮▮▮▮▮</div>
          </div>
          <div className="mt-12 text-lg font-black">松开发送</div>
        </div>
      ) : null}

      <div className="otr-chat-input-bar fixed inset-x-0 bottom-[82px] z-30 border-t border-white/40 bg-[#e4f4ef]/95 shadow-[0_-12px_30px_rgba(0,0,0,0.08)] backdrop-blur md:static md:shrink-0">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (!voiceMode) {
                closeTextInputArea();
              }
              setVoiceMode((current) => !current);
            }}
            className="ml-3 my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl font-black text-emerald-800 shadow-sm transition active:scale-95"
            aria-label="切换语音"
          >
            {voiceMode ? "⌨" : "◉"}
          </button>

          {voiceMode ? (
            <button
              type="button"
              onPointerDown={startHoldToTalk}
              onPointerUp={stopHoldToTalk}
              onPointerCancel={stopHoldToTalk}
              disabled={isSending || isPrimingMicrophone}
              className="my-2 h-11 flex-1 rounded-2xl bg-white text-base font-black text-stone-900 shadow-sm active:bg-emerald-50"
            >
              {isPrimingMicrophone ? "正在开启麦克风..." : "按住 说话"}
            </button>
          ) : (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void sendText();
                }
              }}
              enterKeyHint="send"
              rows={1}
              placeholder="输入消息..."
              onFocus={() => {
                setVoiceMode(false);
                setShowEmoji(false);
                setIsSwitchingToKeyboard(false);
                setIsTextFocused(true);
                window.setTimeout(
                  () => textareaRef.current?.focus({ preventScroll: true }),
                  50,
                );
              }}
              onBlur={() => setIsTextFocused(false)}
              className="my-2 max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-white bg-white px-3 py-2 text-base font-semibold leading-7 text-stone-950 shadow-sm outline-none focus:border-emerald-400"
            />
          )}

          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={toggleEmojiPanel}
            className="my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl font-black text-emerald-800 shadow-sm transition active:scale-95"
            aria-label="表情"
          >
            {showEmoji ? "⌨" : "☺"}
          </button>
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              closeTextInputArea();
              setVoiceMode(false);
              fileInputRef.current?.click();
            }}
            className="my-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl font-black text-emerald-800 shadow-sm transition active:scale-95"
            aria-label={uploadingImageCount > 0 ? "图片上传中" : "添加图片"}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => void sendText()}
            disabled={!text.trim() || isSending || voiceMode}
            className="mr-3 my-2 hidden h-11 rounded-xl bg-emerald-700 px-3 text-sm font-black text-white disabled:bg-stone-300 md:block"
          >
            发送
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => void sendImages(event.target.files)}
          />
        </div>

        {showEmoji ? (
          <div className="border-t border-emerald-900/5 bg-[#dcefeb] px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3 md:hidden">
            <div className="mx-auto max-w-3xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                {emojiTabs.map((tab, index) => (
                  <button
                    key={`${tab}-${index}`}
                    type="button"
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl text-3xl font-black ${
                      index === 1 ? "bg-white shadow-sm" : "text-stone-700"
                    }`}
                    aria-label={`表情分类 ${index + 1}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="h-[260px] overflow-y-auto">
                <div className="mb-3 text-lg font-semibold text-stone-500">最近使用</div>
                <div className="grid grid-cols-8 gap-x-3 gap-y-4">
                  {commonEmojis.map((emoji, index) => (
                    <button
                      key={`${emoji}-${index}`}
                      type="button"
                      onClick={() => setText((current) => `${current}${emoji}`)}
                      className="text-4xl leading-none"
                      aria-label={`输入表情 ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div className="mt-5 text-lg font-semibold text-stone-500">所有表情</div>
                <div className="mt-3 grid grid-cols-8 gap-x-3 gap-y-4 pb-20">
                  {[...commonEmojis, ...commonEmojis.slice(0, 16)].map((emoji, index) => (
                    <button
                      key={`all-${emoji}-${index}`}
                      type="button"
                      onClick={() => setText((current) => `${current}${emoji}`)}
                      className="text-4xl leading-none"
                      aria-label={`输入表情 ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pointer-events-none absolute bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={removeLastEmojiCharacter}
                  className="pointer-events-auto h-14 rounded-2xl bg-white/80 px-7 text-2xl font-black text-stone-700 shadow-sm"
                  aria-label="删除表情"
                >
                  ⌫
                </button>
                <button
                  type="button"
                  onClick={() => void sendText()}
                  disabled={!text.trim() || isSending}
                  className="pointer-events-auto h-14 rounded-2xl bg-emerald-600 px-7 text-xl font-black text-white shadow-sm disabled:bg-stone-300"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <ImageViewer
        message={activeImage}
        faces={activeImageFaces}
        onClose={() => setActiveImage(null)}
      />
    </div>
  );
}

export default function JourneyChatPage() {
  return <AuthGate>{() => <ChatContent />}</AuthGate>;
}
