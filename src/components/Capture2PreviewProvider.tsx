"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useEffect,
  useContext,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CurrencyCombobox } from "@/components/CurrencyCombobox";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useI18n } from "@/components/I18nProvider";
import { compressImageFile } from "@/lib/images";
import { findCurrencyMatch, normalizeCurrencyCode } from "@/lib/currencies";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import {
  type Capture2UploadFileMetadata,
  uploadCapture2Media,
} from "@/lib/capture2/media-upload";
import { answerCapture2JourneyQuery } from "@/lib/capture2/journey-query";
import {
  classifyCapture2SafeIntent,
  type Capture2SafeClassification,
} from "@/lib/capture2/safe-classifier";
import { getErrorMessage } from "@/lib/errors";
import { createRawCaptureEvent } from "@/lib/supabase/capture-events";
import { createItineraryEvent, createItineraryReservation } from "@/lib/supabase/itinerary";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { createLedgerEntry } from "@/lib/supabase/ledger";
import { createPhotoMemory, createTextMemory } from "@/lib/supabase/memories";
import { requestVoiceTranscription } from "@/lib/supabase/media-assets";
import { supabase } from "@/lib/supabase/client";
import { startPhotoUploadBatch } from "@/lib/uploads/photo-upload-manager";
import type {
  ItineraryEventType,
  ItineraryReservationType,
  JourneyMember,
  LedgerAccountingMode,
  LedgerCategory,
} from "@/types";

type Capture2OpenOptions = {
  tripId?: string | null;
  memoryDateKey?: string | null;
  memoryContextLabel?: string | null;
};

type Capture2ContextValue = {
  openCapture2: (options?: Capture2OpenOptions) => void;
};

type Capture2Mode = "home" | "text" | "expense" | "planner";
type Capture2TextDestination = "inbox" | "memory";
type Capture2PlannerKind =
  | "activity"
  | "hotel"
  | "flight"
  | "lodging"
  | "restaurant"
  | "ferry"
  | "car"
  | "reservation";

type Capture2QuickFormState = {
  plannerKind: Capture2PlannerKind;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  locationName: string;
  description: string;
  eventType: ItineraryEventType;
  reservationType: ItineraryReservationType;
  amount: string;
  currency: string;
  category: LedgerCategory;
  accountingMode: LedgerAccountingMode;
  payerMemberId: string;
  provider: string;
  confirmationCode: string;
  url: string;
};

type Capture2UploadItem = {
  id: string;
  name: string;
  kind: "image" | "video" | "unsupported";
  size: number;
  status: "queued" | "uploading" | "completed" | "failed" | "rejected";
  message?: string | null;
};

type Capture2Interpretation = {
  value: string;
  source: "text" | "voice";
  classification: Capture2SafeClassification;
  captureEventId?: string | null;
  queryAnswer?: string | null;
  transcriptionProvider?: string | null;
  transcriptionModel?: string | null;
};

type Capture2FeedbackKind =
  | "auto_memory"
  | "memory_confirm"
  | "query"
  | "action"
  | "deferred";

type Capture2TextIntent =
  | "memory"
  | "query"
  | "expense"
  | "planner"
  | "navigation";

type Capture2MemoryContext = {
  dateKey: string;
  source: "journey_day" | "today";
  label?: string | null;
};

const MAX_VIDEO_FILES = 5;
const RECOMMENDED_VIDEO_BYTES = 100 * 1024 * 1024;
const HARD_VIDEO_BYTES = 300 * 1024 * 1024;
const RECOMMENDED_VIDEO_SECONDS = 30;
const HARD_VIDEO_SECONDS = 120;
const capture2PlannerKinds: Capture2PlannerKind[] = [
  "activity",
  "hotel",
  "flight",
  "lodging",
  "restaurant",
  "ferry",
  "car",
  "reservation",
];

const capture2PlannerKindLabels: Record<Capture2PlannerKind, string> = {
  activity: "行程",
  hotel: "酒店",
  flight: "机票",
  lodging: "住宿",
  restaurant: "餐厅",
  ferry: "船票",
  car: "租车",
  reservation: "其他预订",
};

const capture2EventTypes: ItineraryEventType[] = [
  "activity",
  "meal",
  "transport",
  "shopping",
  "note",
  "other",
];

const capture2EventTypeLabels: Record<ItineraryEventType, string> = {
  flight: "航班",
  hotel: "住宿",
  car: "租车",
  activity: "活动",
  shopping: "购物",
  meal: "用餐",
  transport: "交通",
  note: "备注",
  other: "其他",
};

const Capture2PreviewContext = createContext<Capture2ContextValue | null>(null);

function activeTripIdFromPath(pathname: string) {
  const segment = pathname.match(/^\/trips\/([^/]+)/)?.[1] ?? null;
  return segment && segment !== "new" ? segment : null;
}

function activeMemoryDateFromPath(pathname: string) {
  return pathname.match(/^\/trips\/[^/]+\/days\/(\d{4}-\d{2}-\d{2})(?:\/|$)/)?.[1] ?? null;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateKey(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function capturedAtForDateKey(dateKey: string) {
  const now = new Date();
  return new Date(
    `${dateKey}T${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
    ).toISOString();
}

function normalizeMoneyAmount(rawValue: string) {
  const value = rawValue.trim();
  const hasComma = value.includes(",");
  const hasDot = value.includes(".");

  if (hasComma && hasDot) return value.replace(/,/g, "");

  if (hasComma) {
    const parts = value.split(",");
    const last = parts[parts.length - 1];
    const looksLikeThousands =
      parts.length > 1 && parts.slice(1).every((part) => /^\d{3}$/.test(part));

    if (looksLikeThousands) return value.replace(/,/g, "");
    if (last.length <= 2) return value.replace(",", ".");
  }

  return value;
}

function normalizeCapture2Currency(value: string, fallback = "NZD") {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (trimmed === "€") return "EUR";
  if (trimmed === "$") return "USD";
  if (trimmed === "£") return "GBP";
  if (trimmed === "¥" || trimmed === "￥") return "CNY";
  if (/^欧$/i.test(trimmed)) return "EUR";
  const match = findCurrencyMatch(trimmed);
  return normalizeCurrencyCode(match?.code ?? trimmed) || fallback;
}

function parseCapture2MoneyInput(value: string, fallbackCurrency = "NZD") {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const currencyPattern =
    "(¥|￥|€|\\$|£|[A-Z]{3}|RMB|CNY|NZD|AUD|USD|EUR|GBP|JPY|DKK|ISK|CHF|CAD|HKD|SGD|THB|韩元|日元|人民币|元|纽币|新西兰元|澳币|澳元|美元|美金|欧元|欧|英镑|丹麦克朗|冰岛克朗|瑞士法郎|港币|新币|泰铢)";
  const amountPattern = "(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)";
  const before = new RegExp(`^\\s*${currencyPattern}\\s*${amountPattern}\\s*$`, "i");
  const after = new RegExp(`^\\s*${amountPattern}\\s*${currencyPattern}\\s*$`, "i");
  const beforeMatch = trimmed.match(before);
  if (beforeMatch?.[1] && beforeMatch[2]) {
    return {
      amount: normalizeMoneyAmount(beforeMatch[2]),
      currency: normalizeCapture2Currency(beforeMatch[1], fallbackCurrency),
    };
  }
  const afterMatch = trimmed.match(after);
  if (afterMatch?.[1] && afterMatch[2]) {
    return {
      amount: normalizeMoneyAmount(afterMatch[1]),
      currency: normalizeCapture2Currency(afterMatch[2], fallbackCurrency),
    };
  }
  return null;
}

function addDateDays(date: string, days: number) {
  if (!date) return "";
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function quickDateTime(date: string, time: string) {
  if (!date) return "";
  return `${date}T${time || "09:00"}:00`;
}

function plannerKindDefaults(kind: Capture2PlannerKind, date = localDateKey()) {
  if (kind === "hotel" || kind === "lodging") {
    return {
      title: kind === "hotel" ? "新酒店" : "新住宿",
      startTime: "15:00",
      endDate: addDateDays(date, 1),
      endTime: "11:00",
      eventType: "hotel" as ItineraryEventType,
      reservationType: "hotel" as ItineraryReservationType,
    };
  }
  if (kind === "flight") {
    return {
      title: "新航班",
      startTime: "09:00",
      endDate: date,
      endTime: "12:00",
      eventType: "flight" as ItineraryEventType,
      reservationType: "flight" as ItineraryReservationType,
    };
  }
  if (kind === "restaurant") {
    return {
      title: "新餐厅预订",
      startTime: "19:00",
      endDate: date,
      endTime: "21:00",
      eventType: "meal" as ItineraryEventType,
      reservationType: "restaurant" as ItineraryReservationType,
    };
  }
  if (kind === "ferry") {
    return {
      title: "新船票",
      startTime: "09:00",
      endDate: date,
      endTime: "12:00",
      eventType: "transport" as ItineraryEventType,
      reservationType: "ferry" as ItineraryReservationType,
    };
  }
  if (kind === "car") {
    return {
      title: "新租车",
      startTime: "09:00",
      endDate: date,
      endTime: "18:00",
      eventType: "car" as ItineraryEventType,
      reservationType: "car" as ItineraryReservationType,
    };
  }
  if (kind === "reservation") {
    return {
      title: "新预订",
      startTime: "09:00",
      endDate: date,
      endTime: "12:00",
      eventType: "activity" as ItineraryEventType,
      reservationType: "other" as ItineraryReservationType,
    };
  }
  return {
    title: "新行程",
    startTime: "09:00",
    endDate: date,
    endTime: "10:00",
    eventType: "activity" as ItineraryEventType,
    reservationType: "other" as ItineraryReservationType,
  };
}

function defaultCapture2QuickForm(
  kind: Capture2PlannerKind = "activity",
  prefill: Partial<Capture2QuickFormState> = {},
): Capture2QuickFormState {
  const date = prefill.date || localDateKey();
  const defaults = plannerKindDefaults(kind, date);
  return {
    plannerKind: kind,
    title: prefill.title || defaults.title,
    date,
    endDate: prefill.endDate || defaults.endDate,
    startTime: prefill.startTime || defaults.startTime,
    endTime: prefill.endTime || defaults.endTime,
    locationName: prefill.locationName || "",
    description: prefill.description || "",
    eventType: prefill.eventType || defaults.eventType,
    reservationType: prefill.reservationType || defaults.reservationType,
    amount: prefill.amount || "",
    currency: normalizeCapture2Currency(prefill.currency || "NZD"),
    category: prefill.category || "other",
    accountingMode: prefill.accountingMode || "stats_only",
    payerMemberId: prefill.payerMemberId || "",
    provider: prefill.provider || "",
    confirmationCode: prefill.confirmationCode || "",
    url: prefill.url || "",
  };
}

function plannerKindForClassification(classification: Capture2SafeClassification) {
  const reservationType = classification.extracted.reservationType;
  if (reservationType === "hotel") return "hotel";
  if (reservationType === "flight") return "flight";
  if (reservationType === "restaurant") return "restaurant";
  if (reservationType === "ferry") return "ferry";
  if (reservationType === "car") return "car";
  if (reservationType === "reservation") return "reservation";
  return "activity";
}

function mediaKind(file: File): Capture2UploadItem["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "unsupported";
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function itemId(file: File, index: number) {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function readImageMetadata(file: File) {
  return new Promise<Pick<Capture2UploadFileMetadata, "width" | "height">>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    image.src = url;
  });
}

function readVideoMetadata(file: File) {
  return new Promise<
    Pick<Capture2UploadFileMetadata, "width" | "height" | "durationSeconds">
  >((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null, durationSeconds: null });
    };
    video.src = url;
  });
}

async function getClientFileMetadata(file: File): Promise<Capture2UploadFileMetadata> {
  const kind = mediaKind(file);
  let width: number | null = null;
  let height: number | null = null;
  let durationSeconds: number | null = null;

  if (kind === "image") {
    const imageMetadata = await readImageMetadata(file);
    width = imageMetadata.width;
    height = imageMetadata.height;
  } else if (kind === "video") {
    const videoMetadata = await readVideoMetadata(file);
    width = videoMetadata.width;
    height = videoMetadata.height;
    durationSeconds = videoMetadata.durationSeconds;
  }

  return {
    name: file.name,
    size: file.size,
    type: file.type,
    width,
    height,
    durationSeconds,
    lastModified: file.lastModified || null,
  };
}

function videoRecommendationKey(metadata: Capture2UploadFileMetadata): TranslationKey | null {
  if (metadata.size > RECOMMENDED_VIDEO_BYTES) {
    return "capture2.upload.recommendSize";
  }
  if (
    metadata.durationSeconds !== null &&
    metadata.durationSeconds > RECOMMENDED_VIDEO_SECONDS
  ) {
    return "capture2.upload.recommendDuration";
  }
  return null;
}

function videoHardLimitKey(metadata: Capture2UploadFileMetadata): TranslationKey | null {
  if (metadata.size > HARD_VIDEO_BYTES) return "capture2.upload.hardSize";
  if (metadata.durationSeconds !== null && metadata.durationSeconds > HARD_VIDEO_SECONDS) {
    return "capture2.upload.hardDuration";
  }
  return null;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function uploadStatusTranslationKey(status: Capture2UploadItem["status"]): TranslationKey {
  if (status === "uploading") return "capture2.upload.status.uploading";
  if (status === "completed") return "capture2.upload.status.completed";
  if (status === "failed") return "capture2.upload.status.failed";
  if (status === "rejected") return "capture2.upload.status.rejected";
  return "capture2.upload.status.queued";
}

function intentLabel(intent: Capture2SafeClassification["intent"]) {
  if (intent === "journey_query") return "Journey Query";
  if (intent === "navigation") return "Map / Navigation";
  if (intent === "expense") return "Expense Draft";
  if (intent === "planner") return "Planner Draft";
  return "Deferred";
}

function MicIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h9" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function useCapture2Preview() {
  const context = useContext(Capture2PreviewContext);
  if (!context) {
    throw new Error("useCapture2Preview must be used inside Capture2PreviewProvider.");
  }
  return context;
}

export function Capture2PreviewProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [mode, setMode] = useState<Capture2Mode>("home");
  const [textDestination, setTextDestination] =
    useState<Capture2TextDestination>("inbox");
  const [memoryContext, setMemoryContext] = useState<Capture2MemoryContext>(() => ({
    dateKey: localDateKey(),
    source: "today",
  }));
  const [journeyMemoryContext, setJourneyMemoryContext] =
    useState<Capture2MemoryContext | null>(null);
  const [text, setText] = useState("");
  const [selectedTextIntent, setSelectedTextIntent] =
    useState<Capture2TextIntent | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [quickForm, setQuickForm] = useState<Capture2QuickFormState>(() =>
    defaultCapture2QuickForm(),
  );
  const [journeyMembers, setJourneyMembers] = useState<JourneyMember[]>([]);
  const [lastAudioFile, setLastAudioFile] = useState<File | null>(null);
  const [lastMediaFiles, setLastMediaFiles] = useState<File[]>([]);
  const [uploadItems, setUploadItems] = useState<Capture2UploadItem[]>([]);
  const [interpretation, setInterpretation] = useState<Capture2Interpretation | null>(
    null,
  );
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(false);
  const autoMemoryHandledRef = useRef<string | null>(null);

  const recorder = useVoiceRecorder({
    onRecordingComplete: (file) => {
      setLastAudioFile(file);
      void transcribeAndSave(file);
    },
    onError: (recordError) => {
      setError(getErrorMessage(recordError, t("capture2.error.recording")));
    },
  });

  function translatedActionLabel(action: Capture2SafeClassification["action"]) {
    if (action === "answer_query") return t("capture2.action.answerQuery");
    if (action === "open_map") return t("capture2.action.openMap");
    if (action === "open_expense_form") return t("capture2.action.openExpenseForm");
    if (action === "open_planner_form") return t("capture2.action.openPlannerForm");
    if (action === "open_planner_page") return t("capture2.action.openPlannerPage");
    if (action === "open_ledger_page") return t("capture2.action.openLedgerPage");
    return t("capture2.action.keepInbox");
  }

  function isRecordLikeText(
    textValue: string,
    classification: Capture2SafeClassification,
  ) {
    if (classification.extracted.layer1 === "record") return true;
    if (classification.action !== "defer") return false;
    return /(?:今天|刚才|终于|差点|感觉|觉得|这里|这家|这个|我们|bao|leon|我).*(?:到了|看到|遇到|摔倒|下雨|风|不错|好吃|漂亮|开心|累|冷|热|喜欢|记得|太牛|便宜|瀑布|餐厅|饭店)/i.test(
      textValue,
    );
  }

  function isRecordLikeInterpretation(nextInterpretation: Capture2Interpretation) {
    return isRecordLikeText(nextInterpretation.value, nextInterpretation.classification);
  }

  function memoryConfidence(nextInterpretation: Capture2Interpretation) {
    if (!isRecordLikeInterpretation(nextInterpretation)) return 0;
    if (
      /(?:今天|刚才|终于|这家|这个|这里|我们).*(?:到了|看到|遇到|不错|好吃|漂亮|开心|喜欢|太牛|便宜|瀑布|餐厅|饭店)/i.test(
        nextInterpretation.value,
      )
    ) {
      return Math.max(nextInterpretation.classification.confidence, 0.92);
    }
    return nextInterpretation.classification.confidence;
  }

  function feedbackKind(nextInterpretation: Capture2Interpretation): Capture2FeedbackKind {
    if (nextInterpretation.classification.action === "answer_query") return "query";
    if (nextInterpretation.classification.action !== "defer") return "action";
    if (isRecordLikeInterpretation(nextInterpretation)) {
      return memoryConfidence(nextInterpretation) >= 0.9
        ? "auto_memory"
        : "memory_confirm";
    }
    return "deferred";
  }

  function capture2ActionDescription(kind: Capture2FeedbackKind) {
    if (kind === "auto_memory") return "已添加到记忆";
    if (kind === "memory_confirm") {
      return `即将添加到${formatMemoryContext(memoryContext)}的记忆中`;
    }
    if (kind === "query") return "已找到回答";
    if (kind === "action") return "需要你确认后继续";
    return "留在 Today Review";
  }

  function textIntentLabel(intent: Capture2TextIntent) {
    if (intent === "memory") return "记忆";
    if (intent === "query") return "查询";
    if (intent === "expense") return "消费";
    if (intent === "planner") return "行程/预订";
    return "导航";
  }

  function textIntentButtonLabel(intent: Capture2TextIntent) {
    if (intent === "memory") return "添加记忆";
    if (intent === "query") return "查看回答";
    if (intent === "expense") return "添加消费";
    if (intent === "planner") return "添加行程/预订";
    return "打开导航/地图";
  }

  function detectedTextIntents(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return [] as Capture2TextIntent[];
    const classification = classifyCapture2SafeIntent(trimmed);
    const intents: Capture2TextIntent[] = [];

    if (classification.action === "answer_query") intents.push("query");
    if (classification.action === "open_expense_form") intents.push("expense");
    if (
      classification.action === "open_planner_form" ||
      classification.action === "open_planner_page"
    ) {
      intents.push("planner");
    }
    if (classification.action === "open_map") intents.push("navigation");
    if (isRecordLikeText(trimmed, classification)) intents.push("memory");

    if (/(?:消费|费用|花了|停车|加油|午饭|晚饭|早餐|咖啡|门票|票|€|\$|¥|欧元|美元|人民币|纽币|澳元|\d+\s*(?:欧|元|eur|usd|nzd|aud|cny))/i.test(trimmed)) {
      intents.push("expense");
    }
    if (/(?:订了|定了|预订|行程|安排|酒店|住宿|机票|航班|船票|餐厅|booking|hotel|flight)/i.test(trimmed)) {
      intents.push("planner");
    }
    if (/(?:导航|地图|带我去|怎么去|路线)/i.test(trimmed)) {
      intents.push("navigation");
    }
    if (/(?:看看|查看|查一下|告诉我|还有什么|几点|住哪里|在哪里|多少|为什么|什么|[？?])/i.test(trimmed)) {
      intents.push("query");
    }

    return [...new Set(intents)];
  }

  function activeTextIntent(value: string) {
    const intents = detectedTextIntents(value);
    if (selectedTextIntent && intents.includes(selectedTextIntent)) {
      return selectedTextIntent;
    }
    return intents[0] ?? null;
  }

  function formatMemoryContext(context: Capture2MemoryContext) {
    const dateText = new Date(`${context.dateKey}T00:00:00`).toLocaleDateString(
      locale,
      {
        month: "short",
        day: "numeric",
      },
    );
    if (context.label) {
      return t("capture2.memoryTarget.custom", {
        label: context.label,
        date: dateText,
      });
    }
    if (context.source === "journey_day") {
      return t("capture2.memoryTarget.journeyDay", { date: dateText });
    }
    return t("capture2.memoryTarget.today", { date: dateText });
  }

  function todayMemoryContext(): Capture2MemoryContext {
    return { dateKey: localDateKey(), source: "today" };
  }

  function spokenTextForInterpretation(nextInterpretation: Capture2Interpretation) {
    const { classification } = nextInterpretation;
    const { extracted } = classification;
    if (classification.action === "answer_query") {
      return nextInterpretation.queryAnswer || t("capture2.speak.answerQuery");
    }
    if (classification.action === "open_map") {
      const target = extracted.locationName || extracted.rawTarget;
      return target
        ? t("capture2.speak.openMapWithTarget", { target })
        : t("capture2.speak.openMap");
    }
    if (classification.action === "open_expense_form") {
      const amount = extracted.amount
        ? `${extracted.amount}${extracted.currency ? ` ${extracted.currency}` : ""}`
        : "";
      return amount
        ? t("capture2.speak.openExpenseWithAmount", { amount })
        : t("capture2.speak.openExpense");
    }
    if (classification.action === "open_planner_form") {
      return t("capture2.speak.openPlannerForm");
    }
    if (classification.action === "open_planner_page") {
      return t("capture2.speak.openPlannerPage");
    }
    if (classification.action === "open_ledger_page") {
      return t("capture2.speak.openLedgerPage");
    }
    if (extracted.target === "mutation") {
      return t("capture2.speak.mutationDeferred");
    }
    return t("capture2.speak.deferred");
  }

  function resolveTripId(options?: Capture2OpenOptions) {
    return options?.tripId || activeTripIdFromPath(pathname);
  }

  function resolveMemoryContext(options?: Capture2OpenOptions): Capture2MemoryContext {
    const optionDateKey = options?.memoryDateKey ?? null;
    const optionLabel = options?.memoryContextLabel ?? null;
    if (isDateKey(optionDateKey)) {
      return {
        dateKey: optionDateKey,
        source: "journey_day",
        label: optionLabel,
      };
    }

    const pathDate = activeMemoryDateFromPath(pathname);
    if (isDateKey(pathDate)) {
      return {
        dateKey: pathDate!,
        source: "journey_day",
        label: optionLabel,
      };
    }

    const queryDate =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("date")
        : null;
    if (isDateKey(queryDate)) {
      return {
        dateKey: queryDate,
        source: "journey_day",
        label: optionLabel,
      };
    }

    return {
      dateKey: localDateKey(),
      source: "today",
      label: optionLabel,
    };
  }

  function openCapture2(options?: Capture2OpenOptions) {
    const resolvedMemoryContext = resolveMemoryContext(options);
    setTripId(resolveTripId(options));
    setMemoryContext(resolvedMemoryContext);
    setJourneyMemoryContext(
      resolvedMemoryContext.source === "journey_day" ? resolvedMemoryContext : null,
    );
    setMode("home");
    setTextDestination("inbox");
    setText("");
    setSelectedTextIntent(null);
    setStatus(null);
    setError(null);
    setUploadItems([]);
    setInterpretation(null);
    setQuickForm(defaultCapture2QuickForm());
    setIsOpen(true);
  }

  function closeCapture2() {
    if (recorder.isRecording) recorder.stop();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setIsOpen(false);
    setMode("home");
    setTextDestination("inbox");
    setStatus(null);
    setError(null);
    setText("");
    setSelectedTextIntent(null);
    setUploadItems([]);
    setInterpretation(null);
    setMemoryContext({ dateKey: localDateKey(), source: "today" });
    setJourneyMemoryContext(null);
    setQuickForm(defaultCapture2QuickForm());
  }

  function speakInterpretation(nextInterpretation: Capture2Interpretation | null) {
    if (!nextInterpretation || typeof window === "undefined") return;
    const synthesis = window.speechSynthesis;
    if (!synthesis) return;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      spokenTextForInterpretation(nextInterpretation),
    );
    utterance.lang = locale;
    utterance.rate = 1;
    synthesis.speak(utterance);
  }

  useEffect(() => {
    if (!isSpeechEnabled || !interpretation) return;
    speakInterpretation(interpretation);
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, [interpretation, isSpeechEnabled]);

  useEffect(() => {
    if (!interpretation || feedbackKind(interpretation) !== "auto_memory") return;
    const autoMemoryKey =
      interpretation.captureEventId || `${interpretation.source}:${interpretation.value}`;
    if (autoMemoryHandledRef.current === autoMemoryKey) return;
    autoMemoryHandledRef.current = autoMemoryKey;

    let cancelled = false;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    setIsSaving(true);
    void saveFeedbackMemory(interpretation, undefined, "auto_memory")
      .then(() => {
        if (cancelled) return;
        setStatus(t("capture2.status.memorySaved"));
        closeTimer = setTimeout(() => {
          if (!cancelled) setInterpretation(null);
        }, 3000);
      })
      .catch((autoMemoryError) => {
        if (!cancelled) {
          setError(getErrorMessage(autoMemoryError, t("capture2.error.save")));
        }
      })
      .finally(() => {
        if (!cancelled) setIsSaving(false);
      });

    return () => {
      cancelled = true;
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [interpretation]);

  useEffect(() => {
    if (!tripId || !isOpen) {
      setJourneyMembers([]);
      return;
    }

    let cancelled = false;
    void getJourneyMembers(tripId)
      .then((members) => {
        if (!cancelled) setJourneyMembers(members);
      })
      .catch(() => {
        if (!cancelled) setJourneyMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, isOpen]);

  async function saveRawText(input: {
    value: string;
    source: "text" | "voice";
    metadata?: Record<string, unknown>;
  }) {
    const activeTripId = tripId;
    const value = input.value.trim();
    if (!activeTripId) throw new Error(t("capture2.error.noJourney"));
    if (!value) throw new Error(t("capture2.error.empty"));

    const event = await createRawCaptureEvent({
      tripId: activeTripId,
      inputType: "text",
      originalInput: value,
      capturedAt: new Date().toISOString(),
      metadata: {
        source: "capture2_preview",
        capture2: {
          version: "preview",
          entryPoint: input.source,
          safetyClass: "deferred",
          status: "captured",
          deferReason: "Safe Mode default",
        },
        ...(input.metadata ?? {}),
      },
    });
    window.dispatchEvent(new CustomEvent("otr:capture2-changed"));
    return event;
  }

  async function markCaptureEventProcessed(
    captureEventId: string | null | undefined,
    extra: Record<string, unknown>,
  ) {
    if (!captureEventId) return;
    const { data } = await supabase
      .from("journey_capture_events")
      .select("metadata")
      .eq("id", captureEventId)
      .maybeSingle();
    const currentMetadata =
      data?.metadata && typeof data.metadata === "object"
        ? (data.metadata as Record<string, unknown>)
        : {};
    const { error: updateError } = await supabase
      .from("journey_capture_events")
      .update({
        status: "processed",
        metadata: {
          ...currentMetadata,
          capture2Inbox: {
            status: "archived",
            updatedAt: new Date().toISOString(),
            ...extra,
          },
        },
      })
      .eq("id", captureEventId);
    if (updateError) throw updateError;
  }

  async function saveFeedbackMemory(
    nextInterpretation: Capture2Interpretation,
    inputValue?: string,
    action = "voice_feedback_memory",
  ) {
    const activeTripId = tripId;
    const trimmed = (inputValue ?? nextInterpretation.value).trim();
    if (!activeTripId) throw new Error(t("capture2.error.noJourney"));
    if (!trimmed) throw new Error(t("capture2.error.empty"));

    const capturedAt = capturedAtForDateKey(memoryContext.dateKey);
    const memory = await createTextMemory(activeTripId, trimmed, {
      capturedAt,
      locationName: "",
    });

    if (nextInterpretation.captureEventId) {
      await markCaptureEventProcessed(nextInterpretation.captureEventId, {
        action,
        memoryEntryId: memory.id,
        memoryContext,
      });
    } else {
      await createRawCaptureEvent({
        tripId: activeTripId,
        inputType: "text",
        originalInput: trimmed,
        capturedAt,
        metadata: {
          source: "capture2_preview",
          capture2: {
            version: "preview",
            entryPoint: action,
            status: "processed",
            routedTo: "text_memory",
            memoryEntryId: memory.id,
            memoryContext,
          },
          safeClassifier: {
            version: "v2",
            ...nextInterpretation.classification,
          },
          capture2Inbox: {
            status: "archived",
            updatedAt: new Date().toISOString(),
            action,
            memoryEntryId: memory.id,
          },
        },
      }).catch(() => null);
    }

    window.dispatchEvent(
      new CustomEvent("otr:memory-created", {
        detail: { tripId: activeTripId, memoryId: memory.id, source: "capture2" },
      }),
    );
    window.dispatchEvent(new CustomEvent("otr:capture2-changed"));
    return memory;
  }

  async function saveTextMemory(value: string) {
    const activeTripId = tripId;
    const trimmed = value.trim();
    if (!activeTripId) throw new Error(t("capture2.error.noJourney"));
    if (!trimmed) throw new Error(t("capture2.error.empty"));

    const capturedAt = capturedAtForDateKey(memoryContext.dateKey);
    const memory = await createTextMemory(activeTripId, trimmed, {
      capturedAt,
      locationName: "",
    });

    await createRawCaptureEvent({
      tripId: activeTripId,
      inputType: "text",
      originalInput: trimmed,
      capturedAt,
      metadata: {
        source: "capture2_text_memory",
        capture2: {
          version: "preview",
          entryPoint: "quick_form_add_memory",
          status: "processed",
          routedTo: "text_memory",
          memoryEntryId: memory.id,
          memoryContext,
        },
      },
    }).catch(() => null);

    window.dispatchEvent(
      new CustomEvent("otr:memory-created", {
        detail: { tripId: activeTripId, memoryId: memory.id, source: "capture2" },
      }),
    );
    window.dispatchEvent(new CustomEvent("otr:capture2-changed"));
    return memory;
  }

  function openClassifiedAction(
    value: string,
    classification: Capture2SafeClassification,
  ) {
    const activeTripId = tripId;
    if (!activeTripId) return;

    if (classification.action === "answer_query") {
      void answerCapture2JourneyQuery({ tripId: activeTripId, text: value })
        .then((answer) => setStatus(answer.answer))
        .catch((queryError) =>
          setError(getErrorMessage(queryError, t("capture2.query.notFound"))),
        );
      return;
    }

    if (classification.action === "open_map") {
      closeCapture2();
      router.push(`/trips/${activeTripId}/map`);
      return;
    }

    if (classification.action === "open_planner_page") {
      closeCapture2();
      router.push(`/trips/${activeTripId}/planner`);
      return;
    }

    if (classification.action === "open_ledger_page") {
      closeCapture2();
      router.push(`/trips/${activeTripId}/ledger`);
      return;
    }

    if (classification.action === "open_expense_form") {
      setQuickForm(
        defaultCapture2QuickForm("activity", {
          title: classification.extracted.title || t("capture2.prefill.expenseTitle"),
          amount: classification.extracted.amount || "",
          currency: normalizeCapture2Currency(
            classification.extracted.currency || "NZD",
          ),
          category: (classification.extracted.category ?? "other") as LedgerCategory,
          date: todayDate(),
          description: value,
        }),
      );
      setInterpretation(null);
      setMode("expense");
      return;
    }

    if (classification.action === "open_planner_form") {
      const plannerKind = plannerKindForClassification(classification);
      setQuickForm(
        defaultCapture2QuickForm(plannerKind, {
          title: classification.extracted.title || value,
          eventType: (classification.extracted.eventType ?? "activity") as never,
          reservationType: (classification.extracted.reservationType ?? "other") as never,
          date: todayDate(),
          endDate: todayDate(),
          description: value,
        }),
      );
      setInterpretation(null);
      setMode("planner");
    }
  }

  async function classifyAndRouteText(input: {
    value: string;
    source: "text" | "voice";
    shouldSaveRawEvent: boolean;
    captureEventId?: string | null;
    transcriptionProvider?: string | null;
    transcriptionModel?: string | null;
  }) {
    const activeTripId = tripId;
    const classification = classifyCapture2SafeIntent(input.value);
    let queryAnswer: string | null = null;
    let captureEventId = input.captureEventId ?? null;
    if (input.shouldSaveRawEvent) {
      captureEventId = await saveRawText({
        value: input.value,
        source: input.source,
        metadata: {
          safeClassifier: {
            version: "v2",
            ...classification,
          },
        },
      });
    }

    if (classification.action === "answer_query") {
      try {
        const answer = await answerCapture2JourneyQuery({
          tripId: activeTripId ?? "",
          text: input.value,
        });
        queryAnswer = answer.answer;
        setStatus(answer.answer);
      } catch (queryError) {
        queryAnswer = t("capture2.query.notFound");
        setStatus(queryAnswer);
      }
    } else if (classification.action === "defer") {
      setStatus(t("capture2.status.deferred"));
    } else {
      setStatus(t("capture2.status.confirmIntent"));
    }
    setInterpretation({
      value: input.value,
      source: input.source,
      classification,
      captureEventId,
      queryAnswer,
      transcriptionProvider: input.transcriptionProvider ?? null,
      transcriptionModel: input.transcriptionModel ?? null,
    });
  }

  async function deferTextForLater() {
    setError(null);
    setStatus(null);
    setIsSaving(true);
    try {
      const value = text.trim();
      const classification = classifyCapture2SafeIntent(value);
      await saveRawText({
        value,
        source: "text",
        metadata: {
          safeClassifier: {
            version: "v2",
            ...classification,
          },
        },
      });
      setStatus(t("capture2.status.deferred"));
      setText("");
      setSelectedTextIntent(null);
      setMode("home");
      setTextDestination("inbox");
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("capture2.error.save")));
    } finally {
      setIsSaving(false);
    }
  }

  async function submitTextIntent(intent: Capture2TextIntent) {
    setError(null);
    setStatus(null);
    setIsSaving(true);
    try {
      const activeTripId = tripId;
      const value = text.trim();
      if (!activeTripId) throw new Error(t("capture2.error.noJourney"));
      if (!value) throw new Error(t("capture2.error.empty"));

      if (intent === "memory") {
        await saveTextMemory(value);
        setStatus(t("capture2.status.memorySaved"));
        setText("");
        setSelectedTextIntent(null);
        setMode("home");
        setTextDestination("inbox");
        return;
      }

      const classification = classifyCapture2SafeIntent(value);
      const captureEventId = await saveRawText({
        value,
        source: "text",
        metadata: {
          safeClassifier: {
            version: "v2",
            ...classification,
          },
        },
      });

      if (intent === "query") {
        let queryAnswer: string | null = null;
        try {
          const answer = await answerCapture2JourneyQuery({
            tripId: activeTripId,
            text: value,
          });
          queryAnswer = answer.answer;
          setStatus(answer.answer);
        } catch {
          queryAnswer = t("capture2.query.notFound");
          setStatus(queryAnswer);
        }
        setInterpretation({
          value,
          source: "text",
          classification: {
            ...classification,
            intent: "journey_query",
            action: "answer_query",
            extracted: {
              ...classification.extracted,
              title: value,
              layer1: "question",
              target: "journey",
            },
          },
          captureEventId,
          queryAnswer,
        });
        setText("");
        setSelectedTextIntent(null);
        setMode("home");
        setTextDestination("inbox");
        return;
      }

      const forcedClassification: Capture2SafeClassification =
        intent === "expense"
          ? {
              ...classification,
              intent: "expense",
              action: "open_expense_form",
              extracted: {
                ...classification.extracted,
                title: classification.extracted.title || value,
                amount: classification.extracted.amount || "",
                currency: classification.extracted.currency || "",
                category: classification.extracted.category || "other",
                target: "ledger",
                layer1: "command",
              },
            }
          : intent === "planner"
            ? {
                ...classification,
                intent: "planner",
                action: "open_planner_form",
                extracted: {
                  ...classification.extracted,
                  title: classification.extracted.title || value,
                  eventType: classification.extracted.eventType || "activity",
                  target: "planner",
                  layer1: "command",
                },
              }
            : {
                ...classification,
                intent: "navigation",
                action: "open_map",
                extracted: {
                  ...classification.extracted,
                  rawTarget: classification.extracted.rawTarget || value,
                  locationName: classification.extracted.locationName || value,
                  target: "navigation",
                  layer1: "command",
                },
              };

      setText("");
      setSelectedTextIntent(null);
      setTextDestination("inbox");
      openClassifiedAction(value, forcedClassification);
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("capture2.error.save")));
    } finally {
      setIsSaving(false);
    }
  }

  async function transcribeAndSave(file: File) {
    const activeTripId = tripId;
    if (!activeTripId) {
      setError(t("capture2.error.noJourneyVoice"));
      return;
    }

    setError(null);
    setStatus(null);
    setIsTranscribing(true);
    try {
      const result = await requestVoiceTranscription({
        tripId: activeTripId,
        audio: file,
        metadata: {
          source: "capture2_preview",
          capture2: {
            version: "preview",
            entryPoint: "push_to_talk",
            safetyClass: "deferred",
            status: "captured",
            deferReason: "Safe Mode default after transcription",
          },
        },
      });
      setText(result.transcript);
      await classifyAndRouteText({
        value: result.transcript,
        source: "voice",
        shouldSaveRawEvent: false,
        captureEventId: result.captureEventId,
        transcriptionProvider: result.provider,
        transcriptionModel: result.model,
      });
      window.dispatchEvent(new CustomEvent("otr:capture2-changed"));
      setLastAudioFile(null);
    } catch (voiceError) {
      setError(getErrorMessage(voiceError, t("capture2.error.transcribe")));
    } finally {
      setIsTranscribing(false);
    }
  }

  async function handleFiles(files: File[]) {
    const activeTripId = tripId;
    if (!activeTripId) {
      setError(t("capture2.error.noJourneyUpload"));
      return;
    }
    if (files.length === 0) return;

    setError(null);
    setStatus(null);
    setLastMediaFiles(files);
    setIsUploading(true);
    try {
      const metadata = await Promise.all(files.map(getClientFileMetadata));
      const videoCount = files.filter((file) => mediaKind(file) === "video").length;
      const baseItems = files.map((file, index): Capture2UploadItem => {
        const kind = mediaKind(file);
        const fileMetadata = metadata[index];
        const hardLimitKey =
          kind === "video" && fileMetadata ? videoHardLimitKey(fileMetadata) : null;
        const recommendationKey =
          kind === "video" && fileMetadata ? videoRecommendationKey(fileMetadata) : null;
        const shouldReject =
          kind === "unsupported" || Boolean(hardLimitKey) || (kind === "video" && videoCount > MAX_VIDEO_FILES);

        return {
          id: itemId(file, index),
          name: file.name || `file-${index + 1}`,
          kind,
          size: file.size,
          status: shouldReject ? "rejected" : "queued",
          message:
            kind === "unsupported"
              ? t("capture2.upload.unsupported")
              : (hardLimitKey ? t(hardLimitKey) : null) ||
                (kind === "video" && videoCount > MAX_VIDEO_FILES
                  ? t("capture2.upload.tooManyVideos")
                  : recommendationKey
                    ? t(recommendationKey)
                    : null),
        };
      });
      setUploadItems(baseItems);

      const uploadableIndexes = baseItems
        .map((item, index) => (item.status === "queued" ? index : -1))
        .filter((index) => index >= 0);

      if (uploadableIndexes.length === 0) {
        setError(t("capture2.upload.none"));
        return;
      }

      setUploadItems((items) =>
        items.map((item) =>
          item.status === "queued" ? { ...item, status: "uploading" } : item,
        ),
      );

      const imageIndexes = uploadableIndexes.filter(
        (index) => mediaKind(files[index]) === "image",
      );
      const videoIndexes = uploadableIndexes.filter(
        (index) => mediaKind(files[index]) === "video",
      );

      if (imageIndexes.length === 1) {
        const imageIndex = imageIndexes[0];
        const imageFile = files[imageIndex];
        const compressed = await compressImageFile(imageFile);
        try {
          const memory = await createPhotoMemory(
            activeTripId,
            compressed,
            imageFile.name || "capture-photo.jpg",
            "",
            {
              capturedAt: imageFile.lastModified
                ? new Date(imageFile.lastModified).toISOString()
                : new Date().toISOString(),
              locationName: "",
            },
            imageFile,
          );
          await createRawCaptureEvent({
            tripId: activeTripId,
            inputType: "photo",
            originalInput: `Capture 2.0 photo upload: ${imageFile.name || "photo"}`,
            capturedAt: new Date().toISOString(),
            metadata: {
              source: "capture2_photo_memory",
              capture2: {
                version: "preview",
                entryPoint: "upload_media",
                status: "processed",
                routedTo: "photo_memory",
                memoryEntryId: memory.id,
                mediaAssetIds: memory.mediaAssetId ? [memory.mediaAssetId] : [],
              },
            },
          }).catch(() => null);
        } finally {
          URL.revokeObjectURL(compressed.previewUrl);
        }
      } else if (imageIndexes.length > 1) {
        await startPhotoUploadBatch({
          journeyId: activeTripId,
          files: imageIndexes.map((index) => files[index]),
          triggeredBy: "capture2_preview",
        });
        await createRawCaptureEvent({
          tripId: activeTripId,
          inputType: "photo",
          originalInput: `Capture 2.0 photo upload: ${imageIndexes.length} file(s)`,
          capturedAt: new Date().toISOString(),
          metadata: {
            source: "capture2_photo_memory",
            capture2: {
              version: "preview",
              entryPoint: "upload_media",
              status: "background_processing",
              routedTo: "photo_memory_batch",
              fileCount: imageIndexes.length,
            },
          },
        }).catch(() => null);
      }

      if (videoIndexes.length > 0) {
        await uploadCapture2Media({
          tripId: activeTripId,
          files: videoIndexes.map((index) => files[index]),
          fileMetadata: videoIndexes.map((index) => metadata[index]),
        });
      }
      window.dispatchEvent(new CustomEvent("otr:capture2-changed"));

      setUploadItems((items) =>
        items.map((item) =>
          item.status === "uploading" ? { ...item, status: "completed" } : item,
        ),
      );
      if (imageIndexes.length > 0 && videoIndexes.length > 0) {
        setStatus(t("capture2.status.mixedUploaded"));
      } else if (imageIndexes.length > 0) {
        setStatus(t("capture2.status.photosUploaded"));
      } else {
        setStatus(t("capture2.status.videosUploaded"));
      }
      setLastMediaFiles([]);
    } catch (uploadError) {
      setUploadItems((items) =>
        items.map((item) =>
          item.status === "uploading" || item.status === "queued"
            ? { ...item, status: "failed", message: t("capture2.upload.failed") }
            : item,
        ),
      );
      setError(getErrorMessage(uploadError, t("capture2.error.upload")));
    } finally {
      setIsUploading(false);
    }
  }

  function updateQuickForm(patch: Partial<Capture2QuickFormState>) {
    setQuickForm((current) => ({ ...current, ...patch }));
  }

  function updateQuickExpenseAmount(value: string) {
    const parsed = parseCapture2MoneyInput(value, quickForm.currency || "NZD");
    if (parsed) {
      updateQuickForm({ amount: parsed.amount, currency: parsed.currency });
      return;
    }
    updateQuickForm({ amount: value });
  }

  function activeJourneyMemberIds() {
    return journeyMembers
      .filter((member) => member.status !== "unlinked")
      .map((member) => member.id);
  }

  async function saveCapture2Expense() {
    const activeTripId = tripId;
    if (!activeTripId) {
      setError(t("capture2.error.noJourneyQuickForms"));
      return;
    }
    const parsedMoney = parseCapture2MoneyInput(
      quickForm.amount,
      quickForm.currency || "NZD",
    );
    const amountText = parsedMoney?.amount ?? quickForm.amount;
    const currency = normalizeCapture2Currency(
      parsedMoney?.currency ?? quickForm.currency,
      "NZD",
    );
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请填写有效金额。");
      return;
    }

    setIsSaving(true);
    setError(null);
    setStatus(null);
    const expenseDate = quickForm.date || localDateKey();
    const sourceText = `${quickForm.title} ${amountText} ${currency}`.trim();
    try {
      await createRawCaptureEvent({
        tripId: activeTripId,
        inputType: "text",
        originalInput: sourceText,
        capturedAt: capturedAtForDateKey(expenseDate),
        metadata: {
          source: "capture2_quick_form",
          capture2: {
            version: "preview",
            quickFormType: "expense",
            form: quickForm,
          },
        },
      });

      await createLedgerEntry({
        journeyId: activeTripId,
        title: quickForm.title || t("capture2.prefill.expenseTitle"),
        description: quickForm.description,
        category: quickForm.category,
        accountingMode: quickForm.accountingMode,
        expenseDate,
        startDate: expenseDate,
        endDate: expenseDate,
        originalAmount: amount,
        originalCurrency: currency,
        baseCurrency: currency,
        exchangeRate: 1,
        payerMemberId: quickForm.payerMemberId || null,
        participantMemberIds:
          quickForm.accountingMode === "shared" ? activeJourneyMemberIds() : [],
        addressText: quickForm.locationName,
      });

      window.dispatchEvent(new CustomEvent("otr:capture-completed"));
      window.dispatchEvent(new CustomEvent("otr:capture2-changed"));
      setQuickForm(defaultCapture2QuickForm());
      setMode("home");
      setStatus("已添加消费。");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "添加消费失败。"));
    } finally {
      setIsSaving(false);
    }
  }

  async function saveCapture2PlannerItem() {
    const activeTripId = tripId;
    if (!activeTripId) {
      setError(t("capture2.error.noJourneyQuickForms"));
      return;
    }
    if (!quickForm.title.trim()) {
      setError("请填写标题。");
      return;
    }

    setIsSaving(true);
    setError(null);
    setStatus(null);
    const isActivity = quickForm.plannerKind === "activity";
    const planDate = quickForm.date || localDateKey();
    const sourceText = [
      capture2PlannerKindLabels[quickForm.plannerKind],
      quickForm.title,
      planDate,
      quickForm.locationName,
      quickForm.description,
    ]
      .filter(Boolean)
      .join(" · ");

    try {
      await createRawCaptureEvent({
        tripId: activeTripId,
        inputType: "text",
        originalInput: sourceText,
        capturedAt: capturedAtForDateKey(planDate),
        metadata: {
          source: "capture2_quick_form",
          capture2: {
            version: "preview",
            quickFormType: isActivity ? "planner_event" : "planner_reservation",
            form: quickForm,
          },
        },
      });

      if (isActivity) {
        await createItineraryEvent({
          tripId: activeTripId,
          tripDayId: null,
          title: quickForm.title,
          description: quickForm.description,
          eventType: quickForm.eventType,
          locationName: quickForm.locationName,
          plannedStart: quickDateTime(planDate, quickForm.startTime),
          plannedEnd: quickDateTime(quickForm.endDate || planDate, quickForm.endTime),
          bookingReference: quickForm.confirmationCode,
          url: quickForm.url,
          sourceText,
          confidence: 1,
          needsReview: false,
        });
      } else {
        await createItineraryReservation({
          tripId: activeTripId,
          tripDayId: null,
          reservationType: quickForm.reservationType,
          title: quickForm.title,
          provider: quickForm.provider,
          locationName: quickForm.locationName,
          startsAt: quickDateTime(planDate, quickForm.startTime),
          endsAt: quickDateTime(quickForm.endDate || planDate, quickForm.endTime),
          confirmationCode: quickForm.confirmationCode,
          url: quickForm.url,
          sourceText,
          confidence: 1,
          needsReview: false,
        });
      }

      window.dispatchEvent(new CustomEvent("otr:capture-completed"));
      window.dispatchEvent(new CustomEvent("otr:capture2-changed"));
      setQuickForm(defaultCapture2QuickForm("activity"));
      setMode("home");
      setStatus(isActivity ? "已添加行程。" : "已添加预订。");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "添加行程失败。"));
    } finally {
      setIsSaving(false);
    }
  }

  function openQuickForm(kind: "memory" | "expense" | "planner" | "bulk") {
    const activeTripId = tripId;
    if (!activeTripId) {
      setError(t("capture2.error.noJourneyQuickForms"));
      return;
    }
    if (kind === "memory") {
      setMode("text");
      setTextDestination("memory");
      setStatus(null);
      setError(null);
      return;
    }
    if (kind === "expense") {
      setMode("expense");
      setQuickForm(defaultCapture2QuickForm());
      setStatus(null);
      setError(null);
      return;
    }
    if (kind === "planner") {
      setMode("planner");
      setQuickForm(defaultCapture2QuickForm("activity"));
      setStatus(null);
      setError(null);
      return;
    }
    closeCapture2();
    router.push(`/trips/${activeTripId}/planner/import`);
  }

  const canUseJourney = Boolean(tripId);
  const isBusy = isSaving || isUploading || isTranscribing;
  const todayContext = todayMemoryContext();
  const isPlannerActivity = quickForm.plannerKind === "activity";
  const currentFeedbackKind = interpretation ? feedbackKind(interpretation) : null;
  const textIntents = detectedTextIntents(text);
  const currentTextIntent = activeTextIntent(text);

  async function confirmFeedbackMemory(
    nextInterpretation: Capture2Interpretation,
    inputValue?: string,
    action = "confirmed_memory",
  ) {
    setError(null);
    setIsSaving(true);
    try {
      await saveFeedbackMemory(nextInterpretation, inputValue, action);
      setStatus(t("capture2.status.memorySaved"));
      setInterpretation(null);
    } catch (memoryError) {
      setError(getErrorMessage(memoryError, t("capture2.error.save")));
    } finally {
      setIsSaving(false);
    }
  }

  function deferFeedback() {
    setInterpretation(null);
    setStatus(t("capture2.status.deferred"));
  }

  function openQuickFormFromFeedback(kind: "memory" | "expense" | "planner" | "bulk") {
    setInterpretation(null);
    openQuickForm(kind);
  }

  function renderFeedbackQuickForms() {
    return (
      <div className="mt-4 border-t border-stone-200 pt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-stone-500">
          <PlusIcon />
          {t("capture2.quickForms")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["memory", t("capture2.quick.memory")],
            ["expense", t("capture2.quick.expense")],
            ["planner", t("capture2.quick.plan")],
            ["bulk", t("capture2.quick.bulk")],
          ].map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() =>
                openQuickFormFromFeedback(
                  kind as "memory" | "expense" | "planner" | "bulk",
                )
              }
              disabled={!canUseJourney || isBusy}
              className="rounded-2xl bg-stone-100 px-3 py-3 text-sm font-black text-stone-800 disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function memoryContextButtonClass(context: Capture2MemoryContext) {
    const isSelected =
      memoryContext.dateKey === context.dateKey && memoryContext.source === context.source;
    return `rounded-2xl px-3 py-3 text-left text-xs font-black transition ${
      isSelected
        ? "bg-emerald-700 text-white shadow-lg shadow-emerald-900/15"
        : "bg-white text-emerald-900 ring-1 ring-emerald-100"
    }`;
  }

  return (
    <Capture2PreviewContext.Provider value={{ openCapture2 }}>
      {children}
      {isOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] bg-stone-950/45 p-3 backdrop-blur-sm md:p-6"
              onMouseDown={(event) => {
                const target = event.target;
                if (
                  target instanceof Element &&
                  !target.closest("[data-capture2-panel]")
                ) {
                  closeCapture2();
                }
              }}
            >
              <div className="mx-auto flex min-h-full max-w-lg flex-col justify-end gap-4 md:justify-center">
                {interpretation && currentFeedbackKind ? (
                  <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center px-5 py-8">
                    <div
                      data-capture2-panel
                      className="pointer-events-auto w-full max-w-md rounded-[26px] bg-[#fffdf8] p-5 text-stone-950 shadow-2xl shadow-stone-950/35"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                            {t("capture2.safeMode.analysis")}
                          </p>
                          <h3 className="mt-1 text-2xl font-black">
                            {capture2ActionDescription(currentFeedbackKind)}
                          </h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {currentFeedbackKind === "query" ? (
                            <button
                              type="button"
                              onClick={() => {
                                const nextValue = !isSpeechEnabled;
                                setIsSpeechEnabled(nextValue);
                                if (nextValue) speakInterpretation(interpretation);
                                else if (typeof window !== "undefined") {
                                  window.speechSynthesis?.cancel();
                                }
                              }}
                              className={`rounded-full px-3 py-2 text-xs font-black ${
                                isSpeechEnabled
                                  ? "bg-emerald-700 text-white"
                                  : "bg-stone-100 text-stone-700"
                              }`}
                            >
                              {isSpeechEnabled
                                ? t("capture2.speech.on")
                                : t("capture2.speech.off")}
                            </button>
                          ) : null}
                          <span className="rounded-full bg-stone-100 px-3 py-2 text-xs font-black text-stone-700">
                            {Math.round(
                              (currentFeedbackKind === "auto_memory" ||
                              currentFeedbackKind === "memory_confirm"
                                ? memoryConfidence(interpretation)
                                : interpretation.classification.confidence) * 100,
                            )}
                            %
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {currentFeedbackKind === "query" ? (
                          <div className="rounded-3xl bg-emerald-900 px-4 py-4 text-white">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-200">
                              查询结果
                            </p>
                            <p className="mt-2 text-lg font-black leading-7">
                              {interpretation.queryAnswer || t("capture2.query.notFound")}
                            </p>
                            <button
                              type="button"
                              onClick={() => speakInterpretation(interpretation)}
                              className="mt-3 rounded-full bg-white/15 px-4 py-2 text-sm font-black text-white"
                            >
                              {t("capture2.action.play")}
                            </button>
                          </div>
                        ) : null}

                        <div className="rounded-3xl bg-stone-100 px-4 py-3">
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                            {t("capture2.safeMode.userSaid")}
                          </p>
                          <p className="mt-1 text-xl font-black leading-snug text-stone-950">
                            {interpretation.value}
                          </p>
                          {interpretation.source === "voice" ? (
                            <p className="mt-2 text-xs font-bold text-stone-500">
                              STT: {interpretation.transcriptionProvider ?? "unknown"} ·{" "}
                              {interpretation.transcriptionModel ?? "unknown"}
                            </p>
                          ) : null}
                        </div>

                        {currentFeedbackKind === "memory_confirm" ? (
                          <p className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm font-black leading-6 text-emerald-900">
                            即将把这段内容添加到{formatMemoryContext(memoryContext)}的记忆中。
                          </p>
                        ) : null}

                        {currentFeedbackKind === "action" ? (
                          <div className="rounded-3xl bg-emerald-50 px-4 py-3">
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">
                              {t("capture2.safeMode.systemUnderstood")}
                            </p>
                            <p className="mt-1 text-lg font-black text-emerald-950">
                              {translatedActionLabel(interpretation.classification.action)}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                openClassifiedAction(
                                  interpretation.value,
                                  interpretation.classification,
                                )
                              }
                              className="mt-3 w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white"
                            >
                              {translatedActionLabel(interpretation.classification.action)}
                            </button>
                          </div>
                        ) : null}

                        {currentFeedbackKind === "deferred" ? (
                          <p className="rounded-3xl bg-stone-100 px-4 py-3 text-sm font-black leading-6 text-stone-700">
                            这条内容先留在 Today Review，稍后再整理。
                          </p>
                        ) : null}
                      </div>

                      {currentFeedbackKind === "auto_memory" ? (
                        <div className="mt-4 space-y-2">
                          <button
                            type="button"
                            onClick={() => setInterpretation(null)}
                            className="w-full rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white"
                          >
                            关闭
                          </button>
                          <p className="text-center text-xs font-bold text-stone-500">
                            {isSaving ? "正在保存..." : "3 秒后自动关闭"}
                          </p>
                        </div>
                      ) : null}

                      {currentFeedbackKind === "memory_confirm" ? (
                        <div className="mt-4 space-y-3">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              void confirmFeedbackMemory(
                                interpretation,
                                undefined,
                                "confirmed_memory",
                              )
                            }
                            className="w-full rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white disabled:opacity-50"
                          >
                            确认添加到记忆
                          </button>
                          <div className="h-px bg-stone-200" />
                          <button
                            type="button"
                            onClick={deferFeedback}
                            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-800"
                          >
                            等我稍后处理
                          </button>
                          {renderFeedbackQuickForms()}
                        </div>
                      ) : null}

                      {currentFeedbackKind === "query" ? (
                        <div className="mt-4 space-y-3">
                          <button
                            type="button"
                            onClick={() => setInterpretation(null)}
                            className="w-full rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white"
                          >
                            关闭
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              void confirmFeedbackMemory(
                                interpretation,
                                `${interpretation.value}\n\n${interpretation.queryAnswer ?? ""}`,
                                "query_saved_as_memory",
                              )
                            }
                            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:opacity-50"
                          >
                            添加记忆并关闭
                          </button>
                          <div className="h-px bg-stone-200" />
                          <button
                            type="button"
                            onClick={deferFeedback}
                            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-800"
                          >
                            稍后再说
                          </button>
                          {renderFeedbackQuickForms()}
                        </div>
                      ) : null}

                      {currentFeedbackKind === "action" ? (
                        <div className="mt-4 space-y-3">
                          <div className="h-px bg-stone-200" />
                          <button
                            type="button"
                            onClick={deferFeedback}
                            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-800"
                          >
                            稍后再说
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              void confirmFeedbackMemory(
                                interpretation,
                                undefined,
                                "action_saved_as_memory",
                              )
                            }
                            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:opacity-50"
                          >
                            保存记忆
                          </button>
                          {renderFeedbackQuickForms()}
                        </div>
                      ) : null}

                      {currentFeedbackKind === "deferred" ? (
                        <div className="mt-4 space-y-3">
                          <button
                            type="button"
                            onClick={deferFeedback}
                            className="w-full rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white"
                          >
                            稍后再说
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              void confirmFeedbackMemory(
                                interpretation,
                                undefined,
                                "deferred_saved_as_memory",
                              )
                            }
                            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:opacity-50"
                          >
                            保存记忆
                          </button>
                          {renderFeedbackQuickForms()}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <section
                  data-capture2-panel
                  className="w-full rounded-[28px] bg-[#fffdf8] p-5 shadow-2xl shadow-stone-950/25"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                        {t("capture2.eyebrow")}
                      </p>
                      <h2 className="mt-2 text-2xl font-black text-stone-950">
                        {t("capture2.title")}
                      </h2>
                      <p className="mt-1 text-sm font-semibold text-stone-500">
                        {t("capture2.subtitle")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeCapture2}
                      className="rounded-full bg-stone-100 px-3 py-2 text-sm font-black text-stone-700"
                    >
                      {t("common.close")}
                    </button>
                  </div>

                  {!canUseJourney ? (
                    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                      {t("capture2.notice.noJourney")}
                    </div>
                  ) : null}

                  {mode === "expense" ? (
                    <form
                      className="mt-5 max-h-[60vh] overflow-y-auto pr-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveCapture2Expense();
                      }}
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs font-bold text-stone-600">
                            支出标题
                          </span>
                          <input
                            value={quickForm.title}
                            onChange={(event) =>
                              updateQuickForm({ title: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">金额</span>
                          <input
                            inputMode="decimal"
                            value={quickForm.amount}
                            onChange={(event) =>
                              updateQuickExpenseAmount(event.target.value)
                            }
                            placeholder="50欧 / €50 / 50 EUR"
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <CurrencyCombobox
                          value={quickForm.currency}
                          onChange={(currency) =>
                            updateQuickForm({
                              currency: normalizeCapture2Currency(currency),
                            })
                          }
                          label="币种"
                        />
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">日期</span>
                          <input
                            type="date"
                            value={quickForm.date}
                            onChange={(event) =>
                              updateQuickForm({ date: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">类别</span>
                          <select
                            value={quickForm.category}
                            onChange={(event) =>
                              updateQuickForm({
                                category: event.target.value as LedgerCategory,
                              })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          >
                            <option value="food">餐饮</option>
                            <option value="transport">交通</option>
                            <option value="fuel">燃油</option>
                            <option value="hotel">酒店</option>
                            <option value="ticket">门票</option>
                            <option value="shopping">购物</option>
                            <option value="car">租车</option>
                            <option value="flight">航班</option>
                            <option value="other">其他</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">记账方式</span>
                          <select
                            value={quickForm.accountingMode}
                            onChange={(event) =>
                              updateQuickForm({
                                accountingMode: event.target.value as LedgerAccountingMode,
                              })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          >
                            <option value="stats_only">只统计</option>
                            <option value="shared">共同分摊</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">付款人</span>
                          <select
                            value={quickForm.payerMemberId}
                            onChange={(event) =>
                              updateQuickForm({ payerMemberId: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          >
                            <option value="">未选择</option>
                            {journeyMembers.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs font-bold text-stone-600">地点</span>
                          <input
                            value={quickForm.locationName}
                            onChange={(event) =>
                              updateQuickForm({ locationName: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs font-bold text-stone-600">备注</span>
                          <textarea
                            value={quickForm.description}
                            onChange={(event) =>
                              updateQuickForm({ description: event.target.value })
                            }
                            rows={3}
                            className="w-full resize-none rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base leading-6 text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setMode("home")}
                          className="rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-700"
                        >
                          {t("capture2.action.back")}
                        </button>
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                        >
                          {isSaving ? t("capture2.status.saving") : "确认添加"}
                        </button>
                      </div>
                    </form>
                  ) : mode === "planner" ? (
                    <form
                      className="mt-5 max-h-[60vh] overflow-y-auto pr-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveCapture2PlannerItem();
                      }}
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs font-bold text-stone-600">
                            添加类型
                          </span>
                          <select
                            value={quickForm.plannerKind}
                            onChange={(event) => {
                              const plannerKind = event.target.value as Capture2PlannerKind;
                              const defaults = plannerKindDefaults(
                                plannerKind,
                                quickForm.date || localDateKey(),
                              );
                              updateQuickForm({
                                plannerKind,
                                ...defaults,
                              });
                            }}
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          >
                            {capture2PlannerKinds.map((kind) => (
                              <option key={kind} value={kind}>
                                {capture2PlannerKindLabels[kind]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs font-bold text-stone-600">
                            {isPlannerActivity ? "行程标题" : "预订标题"}
                          </span>
                          <input
                            value={quickForm.title}
                            onChange={(event) =>
                              updateQuickForm({ title: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">开始日期</span>
                          <input
                            type="date"
                            value={quickForm.date}
                            onChange={(event) => {
                              const nextDate = event.target.value;
                              updateQuickForm({
                                date: nextDate,
                                endDate:
                                  quickForm.plannerKind === "hotel" ||
                                  quickForm.plannerKind === "lodging"
                                    ? addDateDays(nextDate, 1)
                                    : nextDate,
                              });
                            }}
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">结束日期</span>
                          <input
                            type="date"
                            value={quickForm.endDate}
                            onChange={(event) =>
                              updateQuickForm({ endDate: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">开始时间</span>
                          <input
                            type="time"
                            value={quickForm.startTime}
                            onChange={(event) =>
                              updateQuickForm({ startTime: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-stone-600">结束时间</span>
                          <input
                            type="time"
                            value={quickForm.endTime}
                            onChange={(event) =>
                              updateQuickForm({ endTime: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        {isPlannerActivity ? (
                          <label className="space-y-1">
                            <span className="text-xs font-bold text-stone-600">行程类型</span>
                            <select
                              value={quickForm.eventType}
                              onChange={(event) =>
                                updateQuickForm({
                                  eventType: event.target.value as ItineraryEventType,
                                })
                              }
                              className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                            >
                              {capture2EventTypes.map((type) => (
                                <option key={type} value={type}>
                                  {capture2EventTypeLabels[type]}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <>
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-600">服务商</span>
                              <input
                                value={quickForm.provider}
                                onChange={(event) =>
                                  updateQuickForm({ provider: event.target.value })
                                }
                                className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs font-bold text-stone-600">确认号</span>
                              <input
                                value={quickForm.confirmationCode}
                                onChange={(event) =>
                                  updateQuickForm({
                                    confirmationCode: event.target.value,
                                  })
                                }
                                className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                              />
                            </label>
                          </>
                        )}
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs font-bold text-stone-600">地点</span>
                          <input
                            value={quickForm.locationName}
                            onChange={(event) =>
                              updateQuickForm({ locationName: event.target.value })
                            }
                            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                        {!isPlannerActivity ? (
                          <label className="space-y-1 sm:col-span-2">
                            <span className="text-xs font-bold text-stone-600">链接</span>
                            <input
                              value={quickForm.url}
                              onChange={(event) =>
                                updateQuickForm({ url: event.target.value })
                              }
                              className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                            />
                          </label>
                        ) : null}
                        <label className="space-y-1 sm:col-span-2">
                          <span className="text-xs font-bold text-stone-600">备注</span>
                          <textarea
                            value={quickForm.description}
                            onChange={(event) =>
                              updateQuickForm({ description: event.target.value })
                            }
                            rows={3}
                            className="w-full resize-none rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base leading-6 text-stone-950 outline-none focus:border-emerald-500"
                          />
                        </label>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setMode("home")}
                          className="rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-700"
                        >
                          {t("capture2.action.back")}
                        </button>
                        <button
                          type="submit"
                          disabled={isSaving || !quickForm.title.trim()}
                          className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                        >
                          {isSaving ? t("capture2.status.saving") : "确认添加"}
                        </button>
                      </div>
                    </form>
                  ) : mode === "text" ? (
                    <div className="mt-5">
                      <div className="rounded-2xl bg-emerald-50/80 p-2 ring-1 ring-emerald-100">
                        <p className="px-1 pb-2 text-xs font-black text-emerald-800">
                          {t("capture2.memoryTarget.prefix")}
                        </p>
                        <div
                          className={`grid gap-2 ${
                            journeyMemoryContext ? "sm:grid-cols-2" : ""
                          }`}
                        >
                          {journeyMemoryContext ? (
                            <button
                              type="button"
                              onClick={() => setMemoryContext(journeyMemoryContext)}
                              className={memoryContextButtonClass(journeyMemoryContext)}
                            >
                              {formatMemoryContext(journeyMemoryContext)}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setMemoryContext(todayContext)}
                            className={memoryContextButtonClass(todayContext)}
                          >
                            {formatMemoryContext(todayContext)}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 min-h-20 rounded-2xl border border-stone-200 bg-white p-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                          识别到的意图
                        </p>
                        {textIntents.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {textIntents.map((intent) => {
                              const isActive = currentTextIntent === intent;
                              return (
                                <button
                                  key={intent}
                                  type="button"
                                  onClick={() => setSelectedTextIntent(intent)}
                                  className={`rounded-full px-4 py-2 text-sm font-black transition ${
                                    isActive
                                      ? "bg-emerald-700 text-white shadow-lg shadow-emerald-900/15"
                                      : "bg-stone-100 text-stone-700"
                                  }`}
                                >
                                  {textIntentLabel(intent)}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm font-bold text-stone-500">
                            还没有识别出明确意图。默认可以保存为记忆，或暂存稍后处理。
                          </p>
                        )}
                      </div>

                      <textarea
                        value={text}
                        onChange={(event) => {
                          setText(event.target.value);
                          const nextIntents = detectedTextIntents(event.target.value);
                          if (
                            selectedTextIntent &&
                            !nextIntents.includes(selectedTextIntent)
                          ) {
                            setSelectedTextIntent(null);
                          }
                        }}
                        rows={12}
                        autoFocus
                        placeholder={t("capture2.text.memoryPlaceholder")}
                        className="mt-4 w-full resize-none rounded-3xl border border-stone-200 bg-white p-4 text-base font-semibold leading-7 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                      />

                      <div className="mt-3 space-y-2">
                        {currentTextIntent ? (
                          <button
                            type="button"
                            onClick={() => void submitTextIntent(currentTextIntent)}
                            disabled={isBusy || !text.trim() || !canUseJourney}
                            className="w-full rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white shadow-lg shadow-emerald-900/20 disabled:cursor-not-allowed disabled:bg-stone-300"
                          >
                            {isSaving
                              ? t("capture2.status.saving")
                              : textIntentButtonLabel(currentTextIntent)}
                          </button>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => void submitTextIntent("memory")}
                              disabled={isBusy || !text.trim() || !canUseJourney}
                              className="rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white shadow-lg shadow-emerald-900/20 disabled:cursor-not-allowed disabled:bg-stone-300"
                            >
                              {isSaving ? t("capture2.status.saving") : "添加记忆"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void deferTextForLater()}
                              disabled={isBusy || !text.trim() || !canUseJourney}
                              className="rounded-2xl bg-stone-100 px-4 py-4 text-base font-black text-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200"
                            >
                              暂存稍后再说
                            </button>
                          </div>
                        )}

                        {currentTextIntent ? (
                          <button
                            type="button"
                            onClick={() => void deferTextForLater()}
                            disabled={isBusy || !text.trim() || !canUseJourney}
                            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200"
                          >
                            暂存稍后再说
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={closeCapture2}
                          className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-700"
                        >
                          取消关闭
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6">
                      <button
                        type="button"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          if (!isBusy && canUseJourney) void recorder.start();
                        }}
                        onPointerUp={(event) => {
                          event.preventDefault();
                          if (recorder.isRecording) recorder.stop();
                        }}
                        onPointerCancel={() => {
                          if (recorder.isRecording) recorder.stop();
                        }}
                        onClick={() => {
                          if (!canUseJourney) setError(t("capture2.error.noJourney"));
                        }}
                        className={`mx-auto flex aspect-square w-40 flex-col items-center justify-center rounded-full text-white shadow-2xl transition active:scale-95 ${
                          recorder.isRecording
                            ? "bg-red-600 shadow-red-950/25"
                            : "bg-emerald-700 shadow-emerald-950/25"
                        }`}
                      >
                        <MicIcon className="size-12" />
                        <span className="mt-3 text-sm font-black">
                          {recorder.isRecording
                            ? t("capture2.voice.release")
                            : t("capture2.voice.hold")}
                        </span>
                      </button>

                      <div className="mt-6 grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isBusy || !canUseJourney}
                          className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-4 text-sm font-black text-stone-800 shadow-sm disabled:opacity-50"
                        >
                          <UploadIcon />
                          {isUploading
                            ? t("capture2.upload.uploading")
                            : t("capture2.upload.button")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTextDestination("inbox");
                            setMode("text");
                          }}
                          disabled={isBusy || !canUseJourney}
                          className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-4 text-sm font-black text-stone-800 shadow-sm disabled:opacity-50"
                        >
                          <TextIcon />
                          {t("capture2.text.button")}
                        </button>
                      </div>

                      <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-stone-500">
                          <PlusIcon />
                          {t("capture2.quickForms")}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ["memory", t("capture2.quick.memory")],
                            ["expense", t("capture2.quick.expense")],
                            ["planner", t("capture2.quick.plan")],
                            ["bulk", t("capture2.quick.bulk")],
                          ].map(([kind, label]) => (
                            <button
                              key={kind}
                              type="button"
                              onClick={() =>
                                openQuickForm(kind as "memory" | "expense" | "planner" | "bulk")
                              }
                              disabled={!canUseJourney}
                              className="rounded-xl bg-stone-100 px-3 py-2 text-sm font-black text-stone-700 disabled:opacity-50"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {uploadItems.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {uploadItems.map((item) => (
                        <div
                          key={item.id}
                          className="overflow-hidden rounded-2xl border border-stone-200 bg-white text-sm shadow-sm"
                        >
                          {item.status === "uploading" ? (
                            <div className="h-2 bg-stone-100">
                              <div className="capture2-upload-flow h-full w-full" />
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate font-black text-stone-900">{item.name}</p>
                              <p className="mt-0.5 text-xs font-bold text-stone-500">
                                {item.kind === "video"
                                  ? t("capture2.media.video")
                                  : item.kind === "image"
                                    ? t("capture2.media.image")
                                    : t("capture2.media.file")}{" "}
                                · {formatBytes(item.size)}
                                {item.message ? ` · ${item.message}` : ""}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${
                                item.status === "completed"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : item.status === "failed" || item.status === "rejected"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-stone-100 text-stone-700"
                              }`}
                            >
                              {t(uploadStatusTranslationKey(item.status))}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {text && mode === "home" && !interpretation ? (
                    <div className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
                      {t("capture2.transcript")}{text}
                    </div>
                  ) : null}

                  {lastAudioFile && error ? (
                    <button
                      type="button"
                      onClick={() => void transcribeAndSave(lastAudioFile)}
                      disabled={isTranscribing}
                      className="mt-3 w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                    >
                      {t("capture2.action.retryVoice")}
                    </button>
                  ) : null}

                  {lastMediaFiles.length > 0 && error ? (
                    <button
                      type="button"
                      onClick={() => void handleFiles(lastMediaFiles)}
                      disabled={isUploading}
                      className="mt-3 w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
                    >
                      {t("capture2.action.retryUpload")}
                    </button>
                  ) : null}

                  {status ? (
                    <div className="mt-4 rounded-2xl bg-emerald-100 px-4 py-3 text-sm font-black text-emerald-900">
                      {status}
                    </div>
                  ) : null}
                  {error ? (
                    <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
                      {error}
                    </div>
                  ) : null}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void handleFiles(files);
                    }}
                  />
                </section>
              </div>
            </div>,
            document.body,
          )
        : null}
    </Capture2PreviewContext.Provider>
  );
}
