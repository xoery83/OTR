"use client";

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import {
  CaptureConfirmCard,
  CaptureMessageList,
  type CaptureChatMessage,
  type CaptureQuickAction,
} from "@/components/capture/CaptureChatWindow";
import { useI18n } from "@/components/I18nProvider";
import { resolveCaptureInput } from "@/capture/stateMachine";
import type {
  CaptureResolution,
  CaptureStateInput,
} from "@/capture/stateMachine";
import { executeCaptureAction } from "@/lib/capture-ai/actions";
import {
  detectCaptureIntent,
  findCaptureParserExample,
} from "@/lib/capture-ai/client";
import type {
  CaptureActionGraphNode,
  CaptureEngineOptions,
  CaptureIntentKey,
  CaptureIntentDetection,
  CaptureSessionState,
} from "@/lib/capture-ai/types";
import { getErrorMessage } from "@/lib/errors";
import { compressImageFile, type CompressedImage } from "@/lib/images";
import { readTodayScopedValue } from "@/lib/day-view-storage";
import { getDefaultCapturedAt } from "@/lib/format";
import {
  compareTripsByStartDateAsc,
  getJourneyStatus,
} from "@/lib/journeys/status";
import { createRawCaptureEvent } from "@/lib/supabase/capture-events";
import {
  createItineraryEvent,
  createItineraryReservation,
} from "@/lib/supabase/itinerary";
import { createLedgerEntry, getLedgerData } from "@/lib/supabase/ledger";
import { getPlannerV2, type PlannerV2Day } from "@/lib/supabase/planner-v2";
import { requestVoiceTranscription } from "@/lib/supabase/media-assets";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import { startPhotoUploadBatch } from "@/lib/uploads/photo-upload-manager";
import type {
  ItineraryEventType,
  ItineraryReservation,
  ItineraryReservationType,
  JourneyMember,
  LedgerAccountingMode,
  LedgerCategory,
  Trip,
} from "@/types";

type CaptureOpenOptions = {
  tripId?: string | null;
  entryPoint?: CaptureEngineOptions["entryPoint"];
  intentBias?: CaptureEngineOptions["intentBias"];
  intentLock?: CaptureEngineOptions["intentLock"];
  mode?: CaptureEngineOptions["mode"];
  lockedContext?: CaptureEngineOptions["lockedContext"];
};

type CaptureModalContextValue = {
  openCapture: (options?: CaptureOpenOptions) => void;
};

type QuickRecordType =
  | ""
  | "schedule"
  | "expense"
  | "hotel"
  | "flight"
  | "reservation";

type QuickRecordFormState = {
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  locationName: string;
  description: string;
  eventType: ItineraryEventType;
  amount: string;
  currency: string;
  category: LedgerCategory;
  accountingMode: LedgerAccountingMode;
  payerMemberId: string;
  provider: string;
  confirmationCode: string;
  url: string;
  reservationType: ItineraryReservationType;
};

const CaptureModalContext = createContext<CaptureModalContextValue | null>(null);

function getActiveTripId(pathname: string) {
  const match = pathname.match(/^\/trips\/([^/]+)/);
  return match?.[1] ?? null;
}

function stringPayload(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

const captureQuickEmojis = ["😀", "😂", "🥰", "😎", "😭", "👍", "🙏", "🎉", "❤️", "📍", "💸", "✅"];

const quickRecordLabels: Record<Exclude<QuickRecordType, "">, string> = {
  schedule: "一条日程",
  expense: "费用支出",
  hotel: "酒店预订",
  flight: "航班信息",
  reservation: "预订信息",
};

const captureEventTypes: ItineraryEventType[] = [
  "activity",
  "meal",
  "transport",
  "shopping",
  "note",
  "other",
];

const captureEventTypeLabels: Record<ItineraryEventType, string> = {
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

const captureReservationTypes: ItineraryReservationType[] = [
  "car",
  "ferry",
  "tour",
  "restaurant",
  "other",
];

const captureReservationTypeLabels: Record<ItineraryReservationType, string> = {
  flight: "航班",
  hotel: "住宿",
  car: "租车",
  ferry: "轮渡",
  tour: "预订活动",
  restaurant: "餐厅",
  other: "其他",
};

function addQuickRecordDateDays(date: string, days: number) {
  if (!date) return "";
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function quickRecordReservationType(
  type: QuickRecordType,
  selectedType: ItineraryReservationType,
) {
  if (type === "hotel") return "hotel";
  if (type === "flight") return "flight";
  return selectedType;
}

function reservationDefaultsForType(type: ItineraryReservationType, date: string) {
  if (type === "hotel") {
    return {
      title: "新住宿",
      startTime: "15:00",
      endDate: addQuickRecordDateDays(date, 1),
      endTime: "11:00",
    };
  }
  if (type === "restaurant") {
    return {
      title: "新餐厅预订",
      startTime: "19:00",
      endDate: date,
      endTime: "21:00",
    };
  }
  if (type === "car") {
    return {
      title: "新租车",
      startTime: "09:00",
      endDate: date,
      endTime: "18:00",
    };
  }
  if (type === "flight") {
    return {
      title: "新航班",
      startTime: "09:00",
      endDate: date,
      endTime: "12:00",
    };
  }
  if (type === "ferry") {
    return {
      title: "新轮渡",
      startTime: "09:00",
      endDate: date,
      endTime: "12:00",
    };
  }
  if (type === "tour") {
    return {
      title: "新活动预订",
      startTime: "09:00",
      endDate: date,
      endTime: "12:00",
    };
  }
  return {
    title: "新预订",
    startTime: "09:00",
    endDate: date,
    endTime: "12:00",
  };
}

function reservationFormCopy(type: ItineraryReservationType) {
  if (type === "flight") {
    return {
      heading: "航班预订",
      titleLabel: "航班号 / 航班标题",
      locationLabel: "航线 / 机场",
      startLabel: "起飞时间",
      endLabel: "到达时间",
      providerLabel: "航空公司 / 预订平台",
      codeLabel: "PNR / 确认号",
      urlLabel: "机票链接",
      saveLabel: "保存这条航班",
    };
  }
  if (type === "hotel") {
    return {
      heading: "住宿预订",
      titleLabel: "酒店 / 住宿名称",
      locationLabel: "住宿地址",
      startLabel: "入住时间",
      endLabel: "退房时间",
      providerLabel: "平台 / 预订人",
      codeLabel: "确认号",
      urlLabel: "预订链接",
      saveLabel: "保存这条住宿",
    };
  }
  if (type === "car") {
    return {
      heading: "租车预订",
      titleLabel: "车行 / 租车标题",
      locationLabel: "取还车地点",
      startLabel: "取车时间",
      endLabel: "还车时间",
      providerLabel: "租车公司 / 平台",
      codeLabel: "预订号",
      urlLabel: "租车链接",
      saveLabel: "保存这条租车",
    };
  }
  if (type === "restaurant") {
    return {
      heading: "餐厅预订",
      titleLabel: "餐厅名称",
      locationLabel: "餐厅地址",
      startLabel: "用餐时间",
      endLabel: "结束时间",
      providerLabel: "预订平台 / 联系人",
      codeLabel: "确认号",
      urlLabel: "餐厅链接",
      saveLabel: "保存这条餐厅",
    };
  }
  if (type === "tour") {
    return {
      heading: "活动预订",
      titleLabel: "活动 / Tour 名称",
      locationLabel: "集合地点",
      startLabel: "开始时间",
      endLabel: "结束时间",
      providerLabel: "供应商 / 平台",
      codeLabel: "确认号",
      urlLabel: "活动链接",
      saveLabel: "保存这条活动预订",
    };
  }
  if (type === "ferry") {
    return {
      heading: "轮渡预订",
      titleLabel: "轮渡 / 船班标题",
      locationLabel: "航线 / 港口",
      startLabel: "出发时间",
      endLabel: "抵达时间",
      providerLabel: "船公司 / 平台",
      codeLabel: "确认号",
      urlLabel: "轮渡链接",
      saveLabel: "保存这条轮渡",
    };
  }
  return {
    heading: "其他预订",
    titleLabel: "预订标题",
    locationLabel: "地点 / 地址",
    startLabel: "开始时间",
    endLabel: "结束时间",
    providerLabel: "供应商 / 平台",
    codeLabel: "确认号",
    urlLabel: "链接",
    saveLabel: "保存这条预订",
  };
}

function MicrophoneIcon({ className = "size-4" }: { className?: string }) {
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
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}

export function useCaptureModal() {
  const context = useContext(CaptureModalContext);
  if (!context) {
    throw new Error("useCaptureModal must be used inside CaptureModalProvider.");
  }
  return context;
}

export function CaptureModalProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const activeTripId = getActiveTripId(pathname);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const messageScrollerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<CaptureChatMessage[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [sessionState, setSessionState] = useState<CaptureSessionState | null>(
    null,
  );
  const [photoFileName, setPhotoFileName] = useState("");
  const [originalPhotoFile, setOriginalPhotoFile] = useState<File | null>(null);
  const [compressedImage, setCompressedImage] = useState<CompressedImage | null>(
    null,
  );
  const [isPhotoPreparing, setIsPhotoPreparing] = useState(false);
  const [singlePhotoProgress, setSinglePhotoProgress] = useState<number | null>(
    null,
  );
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isDetectingIntent, setIsDetectingIntent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [intentResult, setIntentResult] = useState<CaptureIntentDetection | null>(
    null,
  );
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isImmersiveInputOpen, setIsImmersiveInputOpen] = useState(false);
  const [showCaptureEmoji, setShowCaptureEmoji] = useState(false);
  const [quickRecordType, setQuickRecordType] = useState<QuickRecordType>("");
  const [isQuickRecordOpen, setIsQuickRecordOpen] = useState(false);
  const [isQuickRecordSaving, setIsQuickRecordSaving] = useState(false);
  const [quickRecordError, setQuickRecordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineOptions, setEngineOptions] = useState<CaptureEngineOptions>({
    entryPoint: "global_capture",
  });
  const [quickRecordForm, setQuickRecordForm] = useState<QuickRecordFormState>(
    () => defaultQuickRecordForm(""),
  );

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? null;
  const confirmLabel = intentResult?.intent === "planner_update"
    ? t("capture.action.addItinerary")
    : intentResult?.intent === "expense"
      ? t("capture.action.recordExpense")
      : intentResult?.intent === "navigation"
        ? t("capture.action.startNavigation")
        : intentResult?.intent === "assistant"
          ? t("capture.action.continue")
          : t("capture.action.saveMemory");

  const groupedTrips = useMemo(
    () => ({
      active: trips
        .filter((trip) => getJourneyStatus(trip) === "active")
        .sort(compareTripsByStartDateAsc),
      upcoming: trips
        .filter((trip) => getJourneyStatus(trip) === "upcoming")
        .sort(compareTripsByStartDateAsc),
      completed: trips
        .filter((trip) => getJourneyStatus(trip) === "completed")
        .sort(compareTripsByStartDateAsc),
    }),
    [trips],
  );
  const isDayPlannerAdd = engineOptions.entryPoint === "day_planner_add";
  const lockedDayDate =
    typeof engineOptions.lockedContext?.dayDate === "string"
      ? engineOptions.lockedContext.dayDate
      : "";
  const captureTitle = isDayPlannerAdd
    ? t("capture.title.dayPlannerAdd")
    : t("capture.title.default");
  const captureIntro = isDayPlannerAdd
    ? t("capture.intro.dayPlannerAdd")
    : t("capture.intro.default");
  const capturePlaceholder = isDayPlannerAdd
    ? t("capture.placeholder.dayPlannerAdd")
    : t("capture.placeholder.default");
  const captureJourneyName = selectedTrip?.name || t("capture.context.chooseJourney");
  const captureContextLine = isDayPlannerAdd
    ? `${captureJourneyName} · ${t("capture.context.dayPlanner")}${
        lockedDayDate ? ` · ${lockedDayDate}` : ""
      }`
    : `${captureJourneyName}${
        lockedDayDate ? ` · ${t("capture.context.recordTo", { date: lockedDayDate })}` : ""
      }`;

  function defaultQuickRecordForm(type: QuickRecordType): QuickRecordFormState {
    const contextDate =
      typeof engineOptions.lockedContext?.dayDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(engineOptions.lockedContext.dayDate)
        ? engineOptions.lockedContext.dayDate
        : new Date().toISOString().slice(0, 10);
    const base: QuickRecordFormState = {
      title: "",
      date: contextDate,
      endDate: contextDate,
      startTime: "",
      endTime: "",
      locationName: "",
      description: "",
      eventType: "activity",
      amount: "",
      currency: "NZD",
      category: "other",
      accountingMode: "shared",
      payerMemberId: "",
      provider: "",
      confirmationCode: "",
      url: "",
      reservationType: "other",
    };

    if (type === "expense") {
      return {
        ...base,
        title: "费用支出",
        category: "other",
        accountingMode: "shared",
        payerMemberId:
          members.find((member) => member.role === "owner")?.id ??
          members.find((member) => member.role === "group_member")?.id ??
          "",
      };
    }
    if (type === "hotel") {
      const defaults = reservationDefaultsForType("hotel", contextDate);
      return {
        ...base,
        ...defaults,
        eventType: "hotel",
        reservationType: "hotel",
      };
    }
    if (type === "flight") {
      const defaults = reservationDefaultsForType("flight", contextDate);
      return {
        ...base,
        ...defaults,
        eventType: "flight",
        reservationType: "flight",
      };
    }
    if (type === "reservation") {
      const defaults = reservationDefaultsForType("other", contextDate);
      return {
        ...base,
        ...defaults,
        reservationType: "other",
      };
    }
    return {
      ...base,
      title: type === "schedule" ? "新日程" : base.title,
      startTime: type === "schedule" ? "09:00" : base.startTime,
      endTime: type === "schedule" ? "10:00" : base.endTime,
    };
  }

  useEffect(() => {
    if (!isOpen) return;
    window.requestAnimationFrame(() => {
      const scroller = messageScrollerRef.current;
      if (!scroller) return;
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [
    isOpen,
    messages.length,
    intentResult?.needsClarification,
    intentResult?.actionGraph.nodes.length,
  ]);

  function resetCaptureState() {
    if (compressedImage?.previewUrl) {
      URL.revokeObjectURL(compressedImage.previewUrl);
    }
    setText("");
    setMessages([]);
    setSessionId("");
    setSessionState(null);
    setPhotoFileName("");
    setOriginalPhotoFile(null);
    setCompressedImage(null);
    setIsPhotoPreparing(false);
    setIsTranscribing(false);
    setIsDetectingIntent(false);
    setIsSubmitting(false);
    setIntentResult(null);
    setIsDebugOpen(false);
    setIsImmersiveInputOpen(false);
    setShowCaptureEmoji(false);
    setQuickRecordType("");
    setIsQuickRecordOpen(false);
    setIsQuickRecordSaving(false);
    setQuickRecordError(null);
    setQuickRecordForm(defaultQuickRecordForm(""));
    setError(null);
    setEngineOptions({ entryPoint: "global_capture" });
  }

  function closeCapture() {
    setIsOpen(false);
    setError(null);
    setIsImmersiveInputOpen(false);
    setShowCaptureEmoji(false);
    setQuickRecordType("");
    setIsQuickRecordOpen(false);
    setQuickRecordError(null);
    if (recorder.isRecording) {
      recorder.stop();
    }
  }

  function resetCaptureConversation() {
    setText("");
    setMessages([]);
    setSessionId("");
    setSessionState(null);
    setIntentResult(null);
    setPhotoFileName("");
    setOriginalPhotoFile(null);
    setCompressedImage(null);
    setIsDebugOpen(false);
    setIsImmersiveInputOpen(false);
    setShowCaptureEmoji(false);
    setQuickRecordType("");
    setIsQuickRecordOpen(false);
    setQuickRecordError(null);
    setQuickRecordForm(defaultQuickRecordForm(""));
    setEngineOptions({ entryPoint: "global_capture" });
  }

  function clearCaptureSession() {
    resetCaptureState();
    const nextSessionId = crypto.randomUUID();
    setSessionId(nextSessionId);
    setSessionState({
      id: nextSessionId,
      status: "idle",
      currentFields: {},
      missingFields: [],
      completedActions: [],
    });
    if (selectedTripId) {
      void getJourneyMembers(selectedTripId)
        .then(setMembers)
        .catch(() => setMembers([]));
    }
  }

  async function loadTrips(preferredTripId?: string | null) {
    setIsLoadingTrips(true);
    try {
      const journeyData = await getTripsForCurrentUser();
      setTrips(journeyData);
      setSelectedTripId(
        preferredTripId ||
          activeTripId ||
          journeyData.find((trip) => getJourneyStatus(trip) === "active")?.id ||
          journeyData[0]?.id ||
          "",
      );
      const nextTripId =
        preferredTripId ||
        activeTripId ||
        journeyData.find((trip) => getJourneyStatus(trip) === "active")?.id ||
        journeyData[0]?.id ||
        "";
      if (nextTripId) {
        const nextMembers = await getJourneyMembers(nextTripId).catch(() => []);
        setMembers(nextMembers);
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError, t("capture.error.loadJourneys")));
    } finally {
      setIsLoadingTrips(false);
    }
  }

  const recorder = useVoiceRecorder({
    onRecordingComplete: async (file) => {
      if (!selectedTripId) {
        setError(t("capture.error.chooseJourneyBeforeRecording"));
        return;
      }

      setIsTranscribing(true);
      setError(null);
      try {
        const result = await requestVoiceTranscription({
          tripId: selectedTripId,
          audio: file,
        });
        setText((current) =>
          [current.trim(), result.transcript].filter(Boolean).join("\n"),
        );
      } catch (voiceError) {
        setError(getErrorMessage(voiceError, t("capture.error.transcribeVoice")));
      } finally {
        setIsTranscribing(false);
      }
    },
    onError: (recordError) => {
      setError(getErrorMessage(recordError, t("capture.error.startRecording")));
    },
  });

  useEffect(() => {
    return () => {
      if (compressedImage?.previewUrl) {
        URL.revokeObjectURL(compressedImage.previewUrl);
      }
    };
  }, [compressedImage]);

  function contextualDayDateForCapture(tripId: string | null | undefined) {
    if (!tripId) return "";
    if (!pathname.match(/^\/trips\/[^/]+\/(?:planner|map)$/)) return "";

    const queryDate =
      typeof window === "undefined"
        ? ""
        : new URLSearchParams(window.location.search).get("date");
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      return queryDate;
    }

    const storedDate = readTodayScopedValue(`otr:planner-day:${tripId}`);
    return storedDate && /^\d{4}-\d{2}-\d{2}$/.test(storedDate)
      ? storedDate
      : "";
  }

  function contextualLockedContext(options?: CaptureOpenOptions) {
    const tripId = options?.tripId ?? selectedTripId ?? activeTripId;
    const lockedContext = { ...(options?.lockedContext ?? {}) };
    const hasExplicitDate =
      typeof lockedContext.dayDate === "string" ||
      typeof lockedContext.date === "string";
    const contextualDayDate = hasExplicitDate
      ? ""
      : contextualDayDateForCapture(tripId);

    return {
      ...lockedContext,
      ...(contextualDayDate ? { dayDate: contextualDayDate } : {}),
      ...(options?.tripId ? { journeyId: options.tripId } : {}),
    };
  }

  function openCapture(options?: CaptureOpenOptions) {
    if (!sessionId) {
      const nextSessionId = crypto.randomUUID();
      setSessionId(nextSessionId);
      setSessionState({
        id: nextSessionId,
        status: "idle",
        currentFields: {},
        missingFields: [],
        completedActions: [],
      });
    }
    const shouldReplaceEngineOptions =
      messages.length === 0 ||
      Boolean(options?.entryPoint && options.entryPoint !== engineOptions.entryPoint);
    if (shouldReplaceEngineOptions) {
      const lockedContext = contextualLockedContext(options);
      setEngineOptions({
        entryPoint: options?.entryPoint ?? "global_capture",
        intentBias: options?.intentBias,
        intentLock: options?.intentLock,
        mode: options?.mode ?? "single_action",
        lockedContext,
      });
    }
    setIsOpen(true);
    if (trips.length === 0 || options?.tripId) {
      void loadTrips(options?.tripId ?? selectedTripId ?? activeTripId);
    }
  }

  function looksLikePlannerImportText(input: string) {
    const lines = input.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return false;

    const hasDateTime = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b|\b\d{1,2}\s*月\s*\d{1,2}\s*日/.test(input);
    const hasTravelKeyword =
      /\bflight\s+[A-Z0-9-]+\b|航班|酒店|住宿|hotel|accommodation|car rental|租车|ferry|tour/i.test(input);
    const hasRoute = /\([A-Z]{3}\)\s*(?:→|->|to|到)\s*.+\([A-Z]{3}\)/i.test(input);
    const hasDayPlanShape = /^d\d+\b|^day\s+\d+\b|^\d{1,2}[:：]\d{2}\b/im.test(input);

    return hasDateTime && (hasTravelKeyword || hasRoute || hasDayPlanShape);
  }

  function routeToPlannerImport(importText: string) {
    window.localStorage.setItem(
      `otr:planner-import-draft:${selectedTripId}`,
      importText,
    );
    resetCaptureConversation();
    closeCapture();
    router.push(`/trips/${selectedTripId}/planner/import`);
  }

  async function changeSelectedTrip(tripId: string) {
    setSelectedTripId(tripId);
    setMembers(await getJourneyMembers(tripId).catch(() => []));
  }

  async function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    if (!selectedTripId) {
      setError(t("capture.error.chooseJourney"));
      return;
    }

    setError(null);
    setIsPhotoPreparing(true);

    try {
      if (files.length > 1) {
        if (compressedImage?.previewUrl) {
          URL.revokeObjectURL(compressedImage.previewUrl);
        }
        setPhotoFileName("");
        setOriginalPhotoFile(null);
        setCompressedImage(null);
        const lockedContext = engineOptions.lockedContext ?? {};
        const dayId =
          typeof lockedContext.dayId === "string"
            ? lockedContext.dayId
            : typeof lockedContext.tripDayId === "string"
              ? lockedContext.tripDayId
              : null;
        const plannerItemId =
          typeof lockedContext.plannerItemId === "string"
            ? lockedContext.plannerItemId
            : typeof lockedContext.itineraryEventId === "string"
              ? lockedContext.itineraryEventId
              : typeof lockedContext.itineraryReservationId === "string"
                ? lockedContext.itineraryReservationId
                : null;

        await startPhotoUploadBatch({
          journeyId: selectedTripId,
          dayId,
          plannerItemId,
          triggeredBy: engineOptions.entryPoint ?? "capture",
          files,
        });
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            text: t("capture.photo.uploaded", { count: files.length }),
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: t("capture.photo.batchStarted", { count: files.length }),
          },
        ]);
        return;
      }

      const file = files[0];
      const compressed = await compressImageFile(file);
      if (compressedImage?.previewUrl) {
        URL.revokeObjectURL(compressedImage.previewUrl);
      }
      setPhotoFileName(file.name);
      setOriginalPhotoFile(file);
      setCompressedImage(compressed);
    } catch (photoError) {
      setError(getErrorMessage(photoError, t("capture.error.preparePhoto")));
    } finally {
      setIsPhotoPreparing(false);
    }
  }

  function isMobileCaptureViewport() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
    );
  }

  function focusCaptureInput() {
    if (isMobileCaptureViewport()) {
      setIsImmersiveInputOpen(true);
      setShowCaptureEmoji(false);
    }
  }

  function closeImmersiveInput() {
    setIsImmersiveInputOpen(false);
    setShowCaptureEmoji(false);
    if (typeof document !== "undefined") {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
    }
  }

  function appendCaptureEmoji(emoji: string) {
    setText((current) => `${current}${emoji}`);
  }

  function handleQuickRecordSelect(nextType: QuickRecordType) {
    setQuickRecordType(nextType);
    if (!nextType) {
      setIsQuickRecordOpen(false);
      setQuickRecordError(null);
      return;
    }
    setQuickRecordForm(defaultQuickRecordForm(nextType));
    setIsQuickRecordOpen(true);
    setQuickRecordError(null);
    setError(null);
    closeImmersiveInput();
  }

  function updateQuickRecordForm(patch: Partial<QuickRecordFormState>) {
    setQuickRecordForm((current) => ({ ...current, ...patch }));
  }

  function quickDateTime(date: string, time: string) {
    if (!date) return "";
    return `${date}T${time || "12:00"}`;
  }

  function quickRecordTripDayId() {
    const context = engineOptions.lockedContext ?? {};
    const tripDayId =
      typeof context.tripDayId === "string"
        ? context.tripDayId
        : typeof context.dayId === "string"
          ? context.dayId
          : "";
    return tripDayId || null;
  }

  function quickRecordSourceText(type: Exclude<QuickRecordType, "">) {
    return [
      quickRecordLabels[type],
      quickRecordForm.title,
      quickRecordForm.date,
      quickRecordForm.startTime,
      quickRecordForm.locationName,
      quickRecordForm.amount
        ? `${quickRecordForm.amount} ${quickRecordForm.currency}`
        : "",
      quickRecordForm.provider,
      quickRecordForm.confirmationCode,
      quickRecordForm.description,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function submitQuickRecord(addAnother: boolean) {
    if (!selectedTripId || !quickRecordType) {
      setQuickRecordError(t("capture.error.chooseJourney"));
      return;
    }
    if (!quickRecordForm.title.trim()) {
      setQuickRecordError("请填写标题。");
      return;
    }

    setIsQuickRecordSaving(true);
    setQuickRecordError(null);
    const type = quickRecordType;
    const sourceText = quickRecordSourceText(type);

    try {
      await createRawCaptureEvent({
        tripId: selectedTripId,
        inputType: "text",
        originalInput: sourceText,
        capturedAt: getDefaultCapturedAt(quickRecordForm.date),
        metadata: {
          source: "capture_quick_record",
          quickRecordType: type,
          form: quickRecordForm,
          engineOptions,
        },
      });

      if (type === "schedule") {
        await createItineraryEvent({
          tripId: selectedTripId,
          tripDayId: quickRecordTripDayId(),
          title: quickRecordForm.title,
          description: quickRecordForm.description,
          eventType: quickRecordForm.eventType,
          locationName: quickRecordForm.locationName,
          plannedStart: quickDateTime(quickRecordForm.date, quickRecordForm.startTime),
          plannedEnd: quickRecordForm.endTime
            ? quickDateTime(
                quickRecordForm.endDate || quickRecordForm.date,
                quickRecordForm.endTime,
              )
            : "",
          bookingReference: quickRecordForm.confirmationCode,
          url: quickRecordForm.url,
          sourceText,
          confidence: 1,
          needsReview: false,
        });
      } else if (type === "expense") {
        const ledgerData = await getLedgerData(selectedTripId);
        const amount = Number(quickRecordForm.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("请填写有效金额。");
        }
        await createLedgerEntry({
          journeyId: selectedTripId,
          title: quickRecordForm.title,
          description: quickRecordForm.description,
          category: quickRecordForm.category,
          accountingMode: quickRecordForm.accountingMode,
          expenseDate: quickRecordForm.date,
          startDate: quickRecordForm.date,
          endDate: quickRecordForm.date,
          originalAmount: amount,
          originalCurrency: quickRecordForm.currency || ledgerData.ledger.baseCurrency,
          baseCurrency: ledgerData.ledger.baseCurrency,
          exchangeRate: 1,
          payerMemberId: quickRecordForm.payerMemberId || null,
          participantMemberIds:
            quickRecordForm.accountingMode === "shared"
              ? activeJourneyMemberIds()
              : [],
          addressText: quickRecordForm.locationName,
        });
      } else {
        await createItineraryReservation({
          tripId: selectedTripId,
          tripDayId: quickRecordTripDayId(),
          reservationType:
            type === "hotel"
              ? "hotel"
              : type === "flight"
                ? "flight"
                : quickRecordForm.reservationType,
          title: quickRecordForm.title,
          provider: quickRecordForm.provider,
          locationName: quickRecordForm.locationName,
          startsAt: quickDateTime(quickRecordForm.date, quickRecordForm.startTime),
          endsAt: quickRecordForm.endTime
            ? quickDateTime(
                quickRecordForm.endDate || quickRecordForm.date,
                quickRecordForm.endTime,
              )
            : "",
          confirmationCode: quickRecordForm.confirmationCode,
          url: quickRecordForm.url,
          sourceText,
          confidence: 1,
          needsReview: false,
        });
      }

      window.dispatchEvent(new CustomEvent("otr:capture-completed"));

      if (addAnother) {
        setQuickRecordForm(defaultQuickRecordForm(type));
        setQuickRecordType(type);
        setIsQuickRecordOpen(true);
        return;
      }

      setQuickRecordType("");
      setIsQuickRecordOpen(false);
      setQuickRecordError(null);
      closeCapture();
    } catch (quickError) {
      setQuickRecordError(getErrorMessage(quickError, "快速记录保存失败。"));
    } finally {
      setIsQuickRecordSaving(false);
    }
  }

  function isAssistantWithIntent(
    message: CaptureChatMessage,
  ): message is Extract<CaptureChatMessage, { role: "assistant" }> & {
    intent: CaptureIntentDetection;
  } {
    return message.role === "assistant" && Boolean(message.intent);
  }

  function withSourceTextOnMemoryIntent(
    intent: CaptureIntentDetection,
    sourceText: string,
  ): CaptureIntentDetection {
    if (!sourceText.trim()) return intent;
    return {
      ...intent,
      actionGraph: {
        ...intent.actionGraph,
        nodes: intent.actionGraph.nodes.map((node) => {
          if (node.intent !== "memory") return node;
          const content = stringPayload(node.payload.content) || sourceText.trim();
          return {
            ...node,
            summary: content,
            payload: {
              ...node.payload,
              content,
            },
          };
        }),
      },
    };
  }

  function sourceTextForIntent(intent: CaptureIntentDetection | null) {
    const memoryContent = intent?.actionGraph.nodes
      .filter((node) => node.intent === "memory")
      .map((node) => stringPayload(node.payload.content))
      .find(Boolean);
    if (memoryContent) return memoryContent;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isAssistantWithIntent(message) && message.intent === intent) {
        return message.sourceText?.trim() || "";
      }
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "user") return message.text.trim();
    }

    return text.trim();
  }

  function stateFromIntent(
    intent: CaptureIntentDetection,
    status: CaptureSessionState["status"] = intent.needsClarification
      ? "collecting_fields"
      : "ready_to_confirm",
  ): CaptureSessionState {
    const fields = Object.fromEntries(
      intent.actionGraph.nodes.flatMap((node) =>
        Object.entries(node.payload).map(([key, value]) => [
          `${node.id}.${key}`,
          value,
        ]),
      ),
    );

    return {
      id: sessionId,
      status,
      currentIntent: intent.intent,
      currentFields: fields,
      missingFields: intent.missingInformation,
      lastQuestion: intent.clarificationQuestions[0]
        ? {
            field: intent.clarificationQuestions[0].id,
            question: intent.clarificationQuestions[0].question,
          }
        : undefined,
      actionGraph: intent.actionGraph,
      confidence: intent.confidence,
      completedActions: sessionState?.completedActions ?? [],
    };
  }

  function captureSessionContext() {
    return (
      sessionState ?? {
        id: sessionId,
        status: "idle",
        currentFields: {},
        missingFields: [],
        completedActions: [],
      }
    );
  }

  function flattenIntentFields(intent: CaptureIntentDetection | null) {
    if (!intent) return {};
    return Object.fromEntries(
      intent.actionGraph.nodes.flatMap((node) => Object.entries(node.payload)),
    );
  }

  function resolverStateFromSession(): CaptureStateInput {
    const currentIntent = latestIntent();
    const fields = {
      ...(sessionState?.currentFields ?? {}),
      ...flattenIntentFields(currentIntent),
    };
    const stateMachineIntentType =
      typeof fields.__stateMachineIntentType === "string"
        ? fields.__stateMachineIntentType
        : undefined;
    const missingFields = [
      ...(sessionState?.missingFields ?? []),
      ...(currentIntent?.missingInformation ?? []),
    ].map((field) => {
      if (field === "splitMembers") return "splitMethod";
      return field;
    });
    const firstMissing = missingFields[0];

    return {
      intentType: stateMachineIntentType ?? (sessionState?.currentIntent
        ? stateIntentType(sessionState.currentIntent)
        : currentIntent
          ? stateIntentType(currentIntent.intent)
          : undefined),
      fields,
      missingFields: [...new Set(missingFields)],
      lastQuestion:
        sessionState?.lastQuestion ??
        (firstMissing
          ? {
              field: firstMissing,
            }
          : undefined),
    };
  }

  function stateIntentType(intent: CaptureIntentKey) {
    if (intent === "expense") return "create_expense";
    if (intent === "planner_update") return "update_planner_item";
    if (intent === "memory") return "create_memory";
    if (intent === "navigation") return "navigation";
    return "assistant";
  }

  function latestIntent() {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isAssistantWithIntent(message)) return message.intent;
    }
    return intentResult;
  }

  function updateLatestAssistantIntent(nextIntent: CaptureIntentDetection) {
    setIntentResult(nextIntent);
    setSessionState(stateFromIntent(nextIntent));
    setMessages((current) => {
      const next = [...current];
      for (let index = next.length - 1; index >= 0; index -= 1) {
        if (isAssistantWithIntent(next[index])) {
          next[index] = {
            ...(next[index] as Extract<CaptureChatMessage, { role: "assistant" }>),
            intent: nextIntent,
          };
          return next;
        }
      }
      return next;
    });
  }

  function updateActionFieldDisplay(
    node: CaptureActionGraphNode,
    payloadPatch: Record<string, string>,
  ) {
    const labelByKey: Record<string, string> = {
      title: "标题",
      date: "日期",
      time: node.type === "hotel_stay" ? "入住时间" : "时间",
      locationName: "地点",
      location: "地点",
      content: "内容",
    };
    const patchedKeys = new Set(Object.keys(payloadPatch));
    const patchFacts = Object.entries(payloadPatch)
      .filter(([, value]) => value.trim())
      .map(([key, value]) => ({
        key,
        label: labelByKey[key] ?? key,
        value: value.trim(),
        source: "explicit" as const,
      }));
    const detailLabelSet = new Set(patchFacts.map((fact) => fact.label));

    return {
      ...node,
      title: payloadPatch.title?.trim() || node.title,
      details: [
        ...node.details.filter((detail) => !detailLabelSet.has(detail.label)),
        ...patchFacts.map((fact) => ({
          label: fact.label,
          value: fact.value,
          source: fact.source,
        })),
      ],
      facts: [
        ...(node.facts ?? []).filter((fact) => !patchedKeys.has(fact.key)),
        ...patchFacts,
      ],
      payload: {
        ...node.payload,
        ...Object.fromEntries(
          Object.entries(payloadPatch).map(([key, value]) => [key, value.trim()]),
        ),
      },
    };
  }

  function handleActionUpdate(
    messageId: string,
    nodeId: string,
    payloadPatch: Record<string, string>,
  ) {
    const targetMessage = messages.find(
      (message) => message.id === messageId && isAssistantWithIntent(message),
    );
    if (!targetMessage || !isAssistantWithIntent(targetMessage)) return;
    const nextIntent: CaptureIntentDetection = {
      ...targetMessage.intent,
      actionGraph: {
        ...targetMessage.intent.actionGraph,
        nodes: targetMessage.intent.actionGraph.nodes.map((node) =>
          node.id === nodeId ? updateActionFieldDisplay(node, payloadPatch) : node,
        ),
      },
      shouldAutoExecute: false,
    };
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId && isAssistantWithIntent(message)
          ? {
              ...message,
              sourceText: sourceTextForIntent(nextIntent),
              intent: nextIntent,
            }
          : message,
      ),
    );
    if (nextIntent) {
      setIntentResult(nextIntent);
      setSessionState(stateFromIntent(nextIntent));
    }
  }

  function applyQuickActionToIntent(
    intent: CaptureIntentDetection,
    action: CaptureQuickAction,
  ): CaptureIntentDetection {
    const nextNodes = intent.actionGraph.nodes.map((node) => {
      if (node.intent !== "expense") return node;
      const payload = { ...node.payload };
      let mandatoryMissing = node.mandatoryMissing;

      if (action.type === "payer") {
        payload.payerMemberId = action.memberId;
        const member = members.find((item) => item.id === action.memberId);
        mandatoryMissing = mandatoryMissing.filter((field) => field !== "payer");
        return {
          ...node,
          payload,
          mandatoryMissing,
          facts: [
            ...(node.facts ?? []),
            ...(member
              ? [
                  {
                    key: "payer",
                    label: t("capture.fact.payer"),
                    value: member.displayName,
                    source: "explicit" as const,
                  },
                ]
              : []),
          ],
        };
      }

      if (action.type === "split_all") {
        payload.accountingMode = "shared";
        payload.participantMemberIds = members
          .filter((member) => member.role === "owner" || member.role === "group_member")
          .map((member) => member.id);
        mandatoryMissing = mandatoryMissing.filter(
          (field) => field !== "splitMembers",
        );
        return {
          ...node,
          payload,
          mandatoryMissing,
          facts: [
            ...(node.facts ?? []),
            {
              key: "splitMembers",
              label: t("capture.fact.split"),
              value: t("capture.question.splitAll"),
              source: "explicit" as const,
            },
          ],
        };
      }

      if (action.type === "split_members") {
        payload.accountingMode = "shared";
        payload.participantMemberIds = action.memberIds;
        mandatoryMissing = mandatoryMissing.filter(
          (field) => field !== "splitMembers",
        );
        return {
          ...node,
          payload,
          mandatoryMissing,
        };
      }

      if (action.type === "stats_only") {
        payload.accountingMode = "stats_only";
        payload.participantMemberIds = [];
        mandatoryMissing = mandatoryMissing.filter(
          (field) => field !== "splitMembers",
        );
        return {
          ...node,
          payload,
          mandatoryMissing,
          facts: [
            ...(node.facts ?? []),
            {
              key: "accountingMode",
              label: t("capture.fact.accountingMode"),
              value: t("capture.question.statsOnly"),
              source: "explicit" as const,
            },
          ],
        };
      }

      return node;
    });

    const graphMissing = [
      ...new Set(nextNodes.flatMap((node) => node.mandatoryMissing)),
    ];
    const nextQuestions = intent.clarificationQuestions.filter((question) =>
      graphMissing.includes(question.id),
    );
    const needsClarification = graphMissing.length > 0 || nextQuestions.length > 0;

    return {
      ...intent,
      actionGraph: {
        ...intent.actionGraph,
        nodes: nextNodes,
      },
      missingInformation: graphMissing,
      clarificationQuestions: nextQuestions,
      needsClarification,
      interactionLevel: needsClarification ? "clarification" : "confirm",
      shouldAutoExecute: false,
    };
  }

  function parseLocalTimeUpdate(nextText: string) {
    if (
      !/时间|入住|到达|出发|改到|改成|上午|早上|中午|下午|晚上|今晚|\d{1,2}[:：]\d{2}|[零〇一二两三四五六七八九十\d]{1,3}\s*(?:点|时|am|pm)/i.test(
        nextText,
      )
    ) {
      return null;
    }

    const match = nextText.match(
      /(上午|早上|中午|下午|晚上|今晚)?\s*([零〇一二两三四五六七八九十\d]{1,3})(?:(?:[:：])([零〇一二两三四五六七八九十\d]{1,2}))?\s*(点|时|am|pm)?/i,
    );
    if (!match) return null;

    const period = match[1] ?? "";
    const hourValue = parseChineseTimeNumber(match[2]);
    const minuteValue = match[3] ? parseChineseTimeNumber(match[3]) : 0;
    if (hourValue === null || minuteValue === null) return null;
    let hour = hourValue;
    const minute = minuteValue;
    const suffix = (match[4] ?? "").toLocaleLowerCase();
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    if ((period === "下午" || period === "晚上" || period === "今晚" || suffix === "pm") && hour < 12) {
      hour += 12;
    }
    if ((period === "上午" || period === "早上" || suffix === "am") && hour === 12) {
      hour = 0;
    }

    return {
      value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      label: `${period}${hourValue}${match[3] ? `:${String(minute).padStart(2, "0")}` : "点"}`,
      evidence: match[0].trim(),
    };
  }

  function parseChineseTimeNumber(value: string) {
    if (/^\d+$/.test(value)) return Number(value);
    const digits: Record<string, number> = {
      零: 0,
      "〇": 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    if (value === "十") return 10;
    if (value.startsWith("十")) {
      return 10 + (digits[value.slice(1)] ?? 0);
    }
    if (value.endsWith("十")) {
      return (digits[value.slice(0, 1)] ?? 0) * 10;
    }
    if (value.includes("十")) {
      const [tens, ones] = value.split("十");
      return (digits[tens] ?? 0) * 10 + (digits[ones] ?? 0);
    }
    return digits[value] ?? null;
  }

  function applyPlannerTimeUpdate(
    intent: CaptureIntentDetection,
    time: { value: string; label: string; evidence: string },
  ): CaptureIntentDetection | null {
    let didUpdate = false;
    const nextNodes = intent.actionGraph.nodes.map((node) => {
      if (node.intent !== "planner_update") return node;
      didUpdate = true;
      const nextFacts = [
        ...(node.facts ?? []).filter(
          (fact) => fact.key !== "checkInTime" && fact.key !== "time",
        ),
        {
          key: node.type === "hotel_stay" ? "checkInTime" : "time",
          label: node.type === "hotel_stay" ? "入住时间" : "时间",
          value: time.label,
          source: "explicit" as const,
          evidence: time.evidence,
        },
      ];
      const nextDetails = [
        ...node.details.filter(
          (detail) => detail.label !== "入住时间" && detail.label !== "时间",
        ),
        {
          label: node.type === "hotel_stay" ? "入住时间" : "时间",
          value: time.label,
          source: "explicit" as const,
          evidence: time.evidence,
        },
      ];
      return {
        ...node,
        summary: node.summary.includes(time.label)
          ? node.summary
          : `${node.summary}，${time.label}`,
        details: nextDetails,
        facts: nextFacts,
        payload: {
          ...node.payload,
          time: time.value,
          checkInTime: time.value,
        },
      };
    });

    if (!didUpdate) return null;
    return {
      ...intent,
      actionGraph: {
        ...intent.actionGraph,
        nodes: nextNodes,
      },
      reason: `${intent.reason} Updated planner time from session context.`,
      shouldAutoExecute: false,
    };
  }

  function parseLocalPlannerFieldUpdate(nextText: string) {
    const trimmed = nextText.trim();
    const fieldPatterns: {
      key: "title" | "date" | "time" | "locationName";
      pattern: RegExp;
    }[] = [
      {
        key: "locationName",
        pattern:
          /(?:吃饭地点|吃饭的地方|地点|位置|餐厅|地方)\s*(?:是|在|为|:|：)\s*(.+)$/i,
      },
      {
        key: "title",
        pattern: /(?:标题|主题|名字|名称)\s*(?:是|为|叫|:|：)\s*(.+)$/i,
      },
      {
        key: "date",
        pattern: /(?:日期|哪天|时间日期)\s*(?:是|为|:|：)\s*(.+)$/i,
      },
      {
        key: "time",
        pattern: /(?:具体时间|开始时间|时间)\s*(?:是|为|在|:|：)\s*(.+)$/i,
      },
    ];

    for (const item of fieldPatterns) {
      const match = trimmed.match(item.pattern);
      const value = match?.[1]?.trim().replace(/[。.!！]$/g, "");
      if (value) return { key: item.key, value };
    }

    return null;
  }

  function applyPlannerFieldUpdate(
    intent: CaptureIntentDetection,
    update: { key: "title" | "date" | "time" | "locationName"; value: string },
  ): CaptureIntentDetection | null {
    let didUpdate = false;
    const payloadPatch =
      update.key === "time"
        ? { time: update.value, checkInTime: update.value }
        : { [update.key]: update.value };
    const nextNodes = intent.actionGraph.nodes.map((node) => {
      if (node.intent !== "planner_update" || didUpdate) return node;
      didUpdate = true;
      return updateActionFieldDisplay(node, payloadPatch);
    });

    if (!didUpdate) return null;
    return {
      ...intent,
      actionGraph: {
        ...intent.actionGraph,
        nodes: nextNodes,
      },
      reason: `${intent.reason} Updated planner ${update.key} from session context.`,
      shouldAutoExecute: false,
    };
  }

  function appendContextUpdateMessage(
    nextText: string,
    nextIntent: CaptureIntentDetection,
    message: string,
  ) {
    const userMessage: CaptureChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: nextText,
    };
    const assistantMessage: CaptureChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: message,
      sourceText: nextText,
      intent: nextIntent,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setIntentResult(nextIntent);
    setSessionState(stateFromIntent(nextIntent));
    setText("");
  }

  function resolveSessionInputLocally(nextText: string) {
    const currentIntent = latestIntent();
    if (!currentIntent) return false;

    const normalizedText = nextText.trim().toLocaleLowerCase();
    if (!normalizedText) return false;

    const timeUpdate = parseLocalTimeUpdate(nextText);
    if (timeUpdate && currentIntent.actionGraph.nodes.some((node) => node.intent === "planner_update")) {
      const nextIntent = applyPlannerTimeUpdate(currentIntent, timeUpdate);
      if (nextIntent) {
        appendContextUpdateMessage(
          nextText,
          nextIntent,
          t("capture.message.contextTimeUpdated"),
        );
        return true;
      }
    }

    const fieldUpdate = parseLocalPlannerFieldUpdate(nextText);
    if (
      fieldUpdate &&
      currentIntent.actionGraph.nodes.some((node) => node.intent === "planner_update")
    ) {
      const nextIntent = applyPlannerFieldUpdate(currentIntent, fieldUpdate);
      if (nextIntent) {
        appendContextUpdateMessage(
          nextText,
          nextIntent,
          t("capture.message.contextUpdated"),
        );
        return true;
      }
    }

    let quickAction: CaptureQuickAction | null = null;
    if (currentIntent.missingInformation.includes("payer")) {
      const member = members.find((item) => {
        const aliases = [
          item.displayName,
          ...(item.notes ?? "")
            .split(/[,，、]/)
            .map((value) => value.trim()),
        ]
          .filter(Boolean)
          .map((value) => String(value).toLocaleLowerCase());
        return aliases.some((alias) => normalizedText.includes(alias));
      });
      if (member) {
        quickAction = { type: "payer", memberId: member.id };
      }
    }

    if (!quickAction && currentIntent.missingInformation.includes("splitMembers")) {
      if (/不分摊|只统计|不用分|no split|stats only/.test(normalizedText)) {
        quickAction = { type: "stats_only" };
      } else if (/所有人|全员|全部|everyone|all|我们/.test(normalizedText)) {
        quickAction = { type: "split_all" };
      }
    }

    if (!quickAction) return false;

    const nextIntent = applyQuickActionToIntent(currentIntent, quickAction);
    const userMessage: CaptureChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: nextText,
    };
    const assistantMessage: CaptureChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: nextIntent.needsClarification
        ? t("capture.message.contextNeedInfo")
        : t("capture.message.contextReady"),
      sourceText: nextText,
      intent: nextIntent,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setIntentResult(nextIntent);
    setSessionState(stateFromIntent(nextIntent));
    setText("");
    return true;
  }

  function handleQuickAction(_messageId: string, action: CaptureQuickAction) {
    const currentIntent = latestIntent();
    if (!currentIntent) return;

    if (action.type === "memory_only") {
      return;
    }

    updateLatestAssistantIntent(applyQuickActionToIntent(currentIntent, action));
  }

  function intentKeyFromResolution(resolution: CaptureResolution): CaptureIntentKey {
    if (resolution.intentType.includes("expense")) return "expense";
    if (resolution.intentType.includes("planner")) return "planner_update";
    if (resolution.intentType.includes("lodging")) return "assistant";
    if (resolution.intentType.includes("ledger")) return "assistant";
    if (resolution.intentType.includes("query")) return "assistant";
    if (resolution.intentType.includes("memory")) return "memory";
    if (resolution.intentType.includes("navigation")) return "navigation";
    if (resolution.intentType === "correction") {
      return latestIntent()?.intent ?? "assistant";
    }
    return "assistant";
  }

  function titleForLocalResolution(resolution: CaptureResolution) {
    if (resolution.intentType === "query_planner") return "查询行程";
    if (resolution.intentType === "query_lodging") return "查询住宿";
    if (resolution.intentType === "query_ledger") return "查询账本";
    if (resolution.intentType === "create_expense") return "记录支出";
    if (resolution.intentType === "create_planner_item") return "新增行程";
    if (resolution.intentType === "update_planner_item") return "更新行程";
    if (resolution.intentType === "delete_planner_item") return "删除行程";
    if (resolution.intentType === "create_memory") return "保存回忆";
    if (resolution.intentType === "correction") return "更新上一项";
    return "Capture";
  }

  function actionTypeForLocalResolution(resolution: CaptureResolution) {
    if (resolution.intentType === "create_expense") return "create_expense";
    if (resolution.intentType === "create_planner_item") return "planner_update";
    if (resolution.intentType === "update_planner_item") return "planner_update";
    if (resolution.intentType === "delete_planner_item") return "planner_update";
    if (resolution.intentType === "create_memory") return "create_memory";
    return resolution.action;
  }

  function localResolutionSummary(resolution: CaptureResolution) {
    const fields = resolution.fields;
    const pieces = [
      fields.title,
      fields.amount && fields.currency ? `${fields.amount} ${fields.currency}` : null,
      fields.date,
      fields.timeFilter,
      fields.newTime,
      fields.newDate,
      fields.targetHint,
      fields.location ? fields.location : fields.newLocationHint,
    ]
      .filter(Boolean)
      .map(String);
    if (pieces.length > 0) return pieces.join("，");
    if (resolution.action === "answer") return "我会根据 Journey 当前数据回答这个问题。";
    if (resolution.action === "show_choices") return "需要从当前 Journey 里选择具体对象。";
    if (resolution.action === "ask_followup") return "我会先保存重点，并询问是否需要继续补充。";
    return "已用本地 Capture State Machine 解析。";
  }

  function nodeTypeForLocalResolution(resolution: CaptureResolution) {
    if (resolution.intentType === "create_expense") {
      return String(resolution.fields.category ?? "expense");
    }
    if (resolution.intentType.includes("planner")) {
      return String(resolution.fields.category ?? resolution.intentType);
    }
    if (resolution.intentType === "create_memory") {
      return String(resolution.fields.memoryType ?? "memory");
    }
    return resolution.intentType;
  }

  function localResolutionDetails(resolution: CaptureResolution) {
    return Object.entries(resolution.fields)
      .filter(([key]) => !key.startsWith("__"))
      .map(([key, value]) => ({
        label: key,
        value: Array.isArray(value) ? value.join(", ") : String(value),
        source: "explicit" as const,
      }));
  }

  function ledgerCategoryForLocal(value: unknown) {
    const category = typeof value === "string" ? value.toLocaleLowerCase() : "";
    if (category === "car_rental") return "car";
    if (category === "grocery") return "shopping";
    if (category === "parking") return "transport";
    if (category === "lodging" || category === "accommodation") return "hotel";
    return category || value;
  }

  function memberByName(value: unknown) {
    const name = typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
    if (!name) return null;
    if (name === "current_user") {
      return (
        members.find((member) => member.role === "owner") ??
        members.find((member) => member.role === "group_member") ??
        null
      );
    }
    return members.find((member) => {
      const displayName = member.displayName.toLocaleLowerCase();
      const notes = (member.notes ?? "").toLocaleLowerCase();
      return displayName === name || notes.split(/[,，、/\s;]/).some((item: string) => item.trim() === name);
    }) ?? null;
  }

  function activeJourneyMemberIds() {
    return members
      .filter((member) => member.role === "owner" || member.role === "group_member")
      .map((member) => member.id);
  }

  function payloadForLocalResolution(resolution: CaptureResolution) {
    const payload = { ...resolution.fields };
    if (resolution.intentType !== "create_expense") return payload;

    payload.category = ledgerCategoryForLocal(payload.category);
    const payer = memberByName(payload.payer);
    if (payer) payload.payerMemberId = payer.id;

    if (payload.splitMethod === "stats_only") {
      payload.accountingMode = "stats_only";
      if (payer) payload.participantMemberIds = [payer.id];
    } else if (payload.splitMethod === "all_members" || payload.splitMethod === "selected_members") {
      payload.accountingMode = "shared";
      payload.participantMemberIds = activeJourneyMemberIds();
    }

    return payload;
  }

  function resolveQueryDate(value: unknown) {
    const raw = typeof value === "string" ? value : "";
    const lockedDayDate =
      typeof engineOptions.lockedContext?.dayDate === "string"
        ? engineOptions.lockedContext.dayDate
        : "";
    const now = lockedDayDate && /^\d{4}-\d{2}-\d{2}$/.test(lockedDayDate)
      ? new Date(`${lockedDayDate}T00:00:00`)
      : new Date();
    if (!raw || raw === "today" || raw === "tonight") {
      return now.toISOString().slice(0, 10);
    }
    if (raw === "tomorrow" || raw === "tomorrow_night") {
      now.setDate(now.getDate() + 1);
      return now.toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return raw;
  }

  function localTime(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function activePlannerItems(day: PlannerV2Day) {
    const reservations = day.reservations.filter(
      (item) => item.status !== "cancelled" && item.reservationType !== "hotel",
    );
    const activities = day.activities.filter((item) => item.status !== "cancelled");
    return [
      ...reservations.map((item) => ({
        title: item.title,
        time: localTime(item.startsAt),
        sortValue: item.startsAt ?? "",
        location: item.locationName ?? "",
        itemType: item.reservationType,
      })),
      ...activities.map((item) => ({
        title: item.title,
        time: localTime(item.plannedStart),
        sortValue: item.plannedStart ?? "",
        location: item.locationName ?? "",
        itemType: item.eventType,
      })),
    ].sort((first, second) => first.sortValue.localeCompare(second.sortValue));
  }

  function navigationLink(location: string) {
    const trimmed = location.trim();
    if (!trimmed) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
  }

  function lodgingItems(day: PlannerV2Day) {
    return day.reservations.filter(
      (item) => item.status !== "cancelled" && item.reservationType === "hotel",
    );
  }

  function formatPlannerItemLine(
    item: { title: string; time: string; location: string },
    index: number,
  ) {
    const link = navigationLink(item.location);
    return `${index + 1}. ${[item.time, item.title, item.location, link ? `导航: ${link}` : ""]
      .filter(Boolean)
      .join(" · ")}`;
  }

  function plannerItemMatches(
    item: { title: string; itemType: string },
    fields: Record<string, unknown>,
  ) {
    const requestedType = typeof fields.itemType === "string" ? fields.itemType : "";
    const transportMode = typeof fields.transportMode === "string" ? fields.transportMode : "";
    const haystack = `${item.title} ${item.itemType}`.toLocaleLowerCase();

    if (!requestedType && !transportMode) return true;
    if (requestedType === "transport") {
      return item.itemType === "transport" || item.itemType === "car" || /drive|driving|car|租车|开车|取车/.test(haystack);
    }
    if (requestedType === "attraction") {
      return item.itemType === "activity" || item.itemType === "tour" || /景点|瀑布|温泉|glacier|lagoon|church|waterfall/.test(haystack);
    }
    if (transportMode === "drive") {
      return item.itemType === "transport" || item.itemType === "car" || /drive|driving|car|租车|开车|取车/.test(haystack);
    }
    return item.itemType === requestedType || haystack.includes(requestedType);
  }

  function morningItem(item: { sortValue: string; time: string }) {
    const source = item.sortValue || item.time;
    if (!source) return true;
    const date = new Date(source);
    if (!Number.isNaN(date.getTime())) return date.getHours() < 12;
    return !/PM/i.test(source) || /^0?[1-9]|1[01]/.test(source);
  }

  function formatLodgingLine(item: ItineraryReservation) {
    const link = navigationLink(item.locationName ?? "");
    return [
      item.title,
      item.locationName,
      item.startsAt ? `入住 ${localTime(item.startsAt)}` : "",
      link ? `导航: ${link}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function formatMoney(amount: number, currency: string) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function formatLedgerEntryLine(
    entry: { title: string; baseAmount: number; baseCurrency: string; category: string },
    index: number,
  ) {
    return `${index + 1}. ${entry.title} · ${formatMoney(entry.baseAmount, entry.baseCurrency)} · ${entry.category}`;
  }

  async function answerLocalQuery(resolution: CaptureResolution) {
    if (!selectedTrip) {
      return "我已经理解了这个查询，但还没有选中 Journey。";
    }

    const date = resolveQueryDate(resolution.fields.date);

    if (resolution.intentType === "query_ledger") {
      const ledgerData = await getLedgerData(selectedTrip.id);
      const currency = ledgerData.ledger.displayCurrency || ledgerData.ledger.baseCurrency || "NZD";
      if (resolution.fields.aggregate === "payer_balance") {
        const topPayer = [...ledgerData.summary.balances].sort(
          (first, second) => second.paidTotal - first.paidTotal,
        )[0];
        if (!topPayer || topPayer.paidTotal <= 0) {
          return "目前还没有人垫付共同支出。";
        }
        return `目前垫付最多的是 ${topPayer.member.displayName}：${formatMoney(topPayer.paidTotal, currency)}。\n\n结算余额：${formatMoney(topPayer.balance, currency)}。`;
      }

      const entries = ledgerData.entries.filter((entry) => entry.expenseDate === date);
      const total = entries.reduce((sum, entry) => sum + entry.baseAmount, 0);
      if (entries.length === 0) {
        return `${date} 还没有记录支出。`;
      }
      return `${date} 的支出总额：${formatMoney(total, currency)}\n\n共 ${entries.length} 笔。\n\n${entries
        .slice(0, 6)
        .map(formatLedgerEntryLine)
        .join("\n")}`;
    }

    const planner = await getPlannerV2(selectedTrip, { includeMemories: false });
    const day = planner.days.find((item) => item.day.dayDate === date);

    if (resolution.intentType === "query_lodging") {
      const lodgings = day ? lodgingItems(day) : [];
      if (lodgings.length === 0) {
        return `${date} 还没有住宿安排。`;
      }
      return `${date} 的住宿：\n\n${lodgings.map(formatLodgingLine).join("\n")}`;
    }

    if (resolution.intentType === "query_planner") {
      const items = day ? activePlannerItems(day) : [];
      let filtered =
        resolution.fields.timePeriod === "morning"
          ? items.filter(morningItem)
          : items;
      filtered = filtered.filter((item) => plannerItemMatches(item, resolution.fields));
      filtered =
        resolution.fields.timeFilter === "after_now" && date === new Date().toISOString().slice(0, 10)
          ? filtered.filter((item) => !item.time || item.time >= new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }))
          : filtered;

      if (resolution.fields.aggregate === "count") {
        return `${date} 找到 ${filtered.length} 个相关安排。\n\n${filtered.map(formatPlannerItemLine).join("\n")}`;
      }

      if (resolution.fields.transportMode === "drive") {
        return `${date} ${filtered.length > 0 ? "有" : "没有"}开车/用车相关安排。${
          filtered.length > 0 ? `\n\n${filtered.map(formatPlannerItemLine).join("\n")}` : ""
        }`;
      }

      if (filtered.length === 0) {
        return `${date} 没有找到后续行程。`;
      }

      if (
        resolution.fields.target === "first_planner_item" ||
        resolution.fields.timeFilter === "next_item"
      ) {
        const [firstItem] = filtered;
        return `${date} ${resolution.fields.timeFilter === "next_item" ? "下一项安排" : "第一个安排"}：\n\n${formatPlannerItemLine(firstItem, 0)}`;
      }

      return `${date} 的行程：\n\n${filtered.map(formatPlannerItemLine).join("\n")}`;
    }

    return "";
  }

  function detectionFromLocalResolution(
    resolution: CaptureResolution,
    answerText?: string,
  ): CaptureIntentDetection {
    const intent = intentKeyFromResolution(resolution);
    const localPayload = payloadForLocalResolution(resolution);
    const unsupportedPlannerMutation =
      resolution.intentType === "update_planner_item" ||
      resolution.intentType === "delete_planner_item";
    const missingInformation = [
      ...resolution.missingFields.map((field) =>
        field === "splitMethod" ? "splitMembers" : field,
      ),
      ...(unsupportedPlannerMutation && !localPayload.targetPlannerItemId
        ? ["targetPlannerItem"]
        : []),
    ].filter((field, index, all) => all.indexOf(field) === index);
    const actionNode: CaptureActionGraphNode = {
      id: resolution.intentType,
      intent,
      type: nodeTypeForLocalResolution(resolution),
      icon:
        intent === "expense"
          ? "💰"
          : intent === "planner_update"
            ? "🗓️"
            : intent === "memory"
              ? "✓"
              : "⌕",
      title: titleForLocalResolution(resolution),
      summary: answerText || localResolutionSummary(resolution),
      details: localResolutionDetails(resolution),
      facts: localResolutionDetails(resolution).map((detail) => ({
        key: detail.label,
        label: detail.label,
        value: detail.value,
        source: "explicit" as const,
      })),
      mandatoryMissing: missingInformation,
      optionalMissing: [],
      payload: answerText
        ? { ...localPayload, queryAnswer: answerText }
        : localPayload,
    };

    return {
      intent,
      confidence: resolution.confidence,
      entities: {
        source: "capture_state_machine",
        stateMachine: {
          intentType: resolution.intentType,
          action: resolution.action,
          source: resolution.source,
          matchedFixtureId: resolution.matchedFixtureId,
        },
      },
      actionGraph: {
        nodes: [actionNode],
        relations: [],
      },
      missingInformation,
      clarificationQuestions: missingInformation.map((field) => ({
        id: field,
        question:
          field === "payer"
            ? t("capture.question.payer")
            : field === "splitMembers"
              ? t("capture.question.split")
              : field === "targetPlannerItem"
                ? t("capture.question.targetPlannerItem")
                : t("capture.question.missingField", { field }),
      })),
      reason: `Matched locally by Capture State Machine (${resolution.source}).`,
      proposedAction: {
        type: actionTypeForLocalResolution(resolution),
        label: titleForLocalResolution(resolution),
        description: answerText || localResolutionSummary(resolution),
        payload: localPayload,
      },
      requiresConfirmation: resolution.action !== "answer",
      needsClarification: missingInformation.length > 0,
      interactionLevel:
        missingInformation.length > 0
          ? "clarification"
          : resolution.action === "answer"
            ? "confirm"
            : "confirm",
      shouldAutoExecute: false,
      fallbackToMemory: false,
      provider: "local",
      model: "capture-state-machine-batch-001",
      rawResponse: resolution,
    };
  }

  function stateFromLocalResolution(
    resolution: CaptureResolution,
  ): CaptureSessionState {
    return {
      id: sessionId,
      status: resolution.missingFields.length > 0
        ? "collecting_fields"
        : "ready_to_confirm",
      currentIntent: intentKeyFromResolution(resolution),
      currentFields: {
        ...resolution.updatedState.fields,
        __stateMachineIntentType: resolution.intentType,
      },
      missingFields: resolution.updatedState.missingFields,
      lastQuestion: resolution.updatedState.missingFields[0]
        ? {
            field: resolution.updatedState.missingFields[0],
            question: `还需要补充 ${resolution.updatedState.missingFields[0]}`,
          }
        : undefined,
      confidence: resolution.confidence,
      completedActions: sessionState?.completedActions ?? [],
    };
  }

  async function applyLocalResolution(nextText: string, resolution: CaptureResolution) {
    const answerText = resolution.action === "answer"
      ? await answerLocalQuery(resolution).catch((queryError) =>
          getErrorMessage(queryError, "我理解了这个查询，但暂时读取不到 Journey 数据。"),
        )
      : undefined;
    const result = withSourceTextOnMemoryIntent(
      detectionFromLocalResolution(resolution, answerText),
      nextText,
    );
    const userMessage: CaptureChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: nextText,
    };
    const assistantMessage: CaptureChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      text:
        resolution.action === "answer"
          ? answerText || t("capture.message.localAnswer")
          : result.needsClarification
            ? t("capture.message.needInfo")
            : t("capture.message.ready"),
      sourceText: nextText,
      intent: result,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setSessionState(stateFromLocalResolution(resolution));
    setIntentResult(resolution.action === "answer" ? null : result);
    setText("");
  }

  async function reviewCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    closeImmersiveInput();
    if (!selectedTripId) {
      setError(t("capture.error.chooseJourney"));
      return;
    }
    if (!text.trim() && !compressedImage) {
      setError(t("capture.error.empty"));
      return;
    }
    setError(null);
    setIsDetectingIntent(true);

    try {
      const trimmedText = text.trim();
      if (
        !compressedImage &&
        (engineOptions.entryPoint === "planner_import" || looksLikePlannerImportText(trimmedText))
      ) {
        routeToPlannerImport(trimmedText);
        return;
      }

      if (!compressedImage && resolveSessionInputLocally(trimmedText)) {
        return;
      }

      if (!compressedImage) {
        const exactExampleResult = await findCaptureParserExample({
          tripId: selectedTripId,
          text: trimmedText,
          engineOptions: {
            ...engineOptions,
            lockedContext: {
              ...(engineOptions.lockedContext ?? {}),
              journeyId: selectedTripId,
            },
          },
          sessionContext: captureSessionContext(),
          inputTypes: ["text"],
        });
        const exactExampleIntent = exactExampleResult
          ? withSourceTextOnMemoryIntent(exactExampleResult, trimmedText)
          : null;
        if (exactExampleIntent) {
          const userMessage: CaptureChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            text: trimmedText,
          };
          const assistantMessage: CaptureChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: exactExampleIntent.needsClarification
              ? t("capture.message.exampleNeedInfo")
              : t("capture.message.exampleReady"),
            sourceText: trimmedText,
            intent: exactExampleIntent,
          };
          setMessages((current) => [...current, userMessage, assistantMessage]);
          setIntentResult(exactExampleIntent);
          setSessionState(stateFromIntent(exactExampleIntent));
          setText("");
          setPhotoFileName("");
          setOriginalPhotoFile(null);
          setCompressedImage(null);
          if (
            exactExampleIntent.intent === "memory" &&
            exactExampleIntent.shouldAutoExecute &&
            messages.length === 0
          ) {
            await confirmCapture(exactExampleIntent);
          }
          return;
        }
      }

      if (!compressedImage) {
        const localResolution = resolveCaptureInput({
          input: trimmedText,
          state: resolverStateFromSession(),
        });
        const localIntentMatchesLock =
          !engineOptions.intentLock ||
          localResolution.allowLLM ||
          intentKeyFromResolution(localResolution) === engineOptions.intentLock;
        if (!localResolution.allowLLM && localIntentMatchesLock) {
          await applyLocalResolution(trimmedText, localResolution);
          return;
        }
      }

      const detectedResult = await detectCaptureIntent({
        tripId: selectedTripId,
        text:
          trimmedText || (compressedImage ? t("capture.photo.imageAttachment") : ""),
        engineOptions: {
          ...engineOptions,
          lockedContext: {
            ...(engineOptions.lockedContext ?? {}),
            journeyId: selectedTripId,
          },
        },
        sessionContext: captureSessionContext(),
        inputTypes: [
          ...(text.trim() ? (["text"] as const) : []),
          ...(compressedImage ? (["image"] as const) : []),
        ],
      });
      const result = withSourceTextOnMemoryIntent(detectedResult, trimmedText);
      const userMessage: CaptureChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmedText || t("capture.photo.imageAttachment"),
        attachmentName: photoFileName || undefined,
      };
      const assistantMessage: CaptureChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.needsClarification
          ? t("capture.message.broadNeedInfo")
          : t("capture.message.ready"),
        sourceText: trimmedText || t("capture.photo.imageAttachment"),
        intent: result,
      };
      setMessages((current) => [...current, userMessage, assistantMessage]);
      setIntentResult(result);
      setSessionState(stateFromIntent(result));
      if (result.intent === "memory" && result.shouldAutoExecute && messages.length === 0) {
        await confirmCapture(result);
        return;
      }
      setText("");
      setPhotoFileName("");
      setOriginalPhotoFile(null);
      setCompressedImage(null);
    } catch (detectError) {
      setError(getErrorMessage(detectError, t("capture.error.detectIntent")));
    } finally {
      setIsDetectingIntent(false);
    }
  }

  async function confirmCapture(resultOverride?: CaptureIntentDetection) {
    if (!selectedTripId) return;

    setIsSubmitting(true);
    setError(null);
    let progressTimer: number | null = null;
    if (compressedImage) {
      setSinglePhotoProgress(8);
      progressTimer = window.setInterval(() => {
        setSinglePhotoProgress((current) =>
          current === null ? 8 : Math.min(92, current + 12),
        );
      }, 450);
    }

    try {
      const selectedIntent = resultOverride ?? intentResult;
      const captureText = sourceTextForIntent(selectedIntent);
      await executeCaptureAction({
        tripId: selectedTripId,
        text: captureText || text,
        intent: selectedIntent,
        engineOptions: {
          ...engineOptions,
          lockedContext: {
            ...(engineOptions.lockedContext ?? {}),
            journeyId: selectedTripId,
          },
        },
        compressedImage,
        originalPhotoFile,
        photoFileName,
      });
      if (compressedImage) {
        setSinglePhotoProgress(100);
      }
      if (selectedIntent) {
        setSessionState((current) => ({
          ...(current ?? stateFromIntent(selectedIntent, "completed")),
          status: "completed",
          completedActions: [
            ...((current ?? sessionState)?.completedActions ?? []),
            {
              intent: selectedIntent.intent,
              actionGraph: selectedIntent.actionGraph,
              completedAt: new Date().toISOString(),
            },
          ],
        }));
      }
      setMessages([]);
      setSessionState(null);
      setIntentResult(null);
      setText("");
      setPhotoFileName("");
      setOriginalPhotoFile(null);
      setCompressedImage(null);
      setIsDebugOpen(false);
      closeCapture();
    } catch (submitError) {
      setError(getErrorMessage(submitError, t("capture.error.complete")));
    } finally {
      if (progressTimer !== null) window.clearInterval(progressTimer);
      window.setTimeout(() => setSinglePhotoProgress(null), 600);
      setIsSubmitting(false);
    }
  }

  function openCaptureParserUpgrade(
    intentOverride?: CaptureIntentDetection,
    messageId?: string,
  ) {
    const targetIntent = intentOverride ?? intentResult;
    if (!targetIntent) return;
    const userMessages = messages.filter((message) => message.role === "user");
    const assistantIndex = messageId
      ? messages.findIndex((message) => message.id === messageId)
      : -1;
    const previousUserText =
      assistantIndex > -1
        ? [...messages]
            .slice(0, assistantIndex)
            .reverse()
            .find((message) => message.role === "user")
            ?.text?.trim()
        : undefined;
    const conversationText = userMessages
      .map((message) => message.text)
      .join("\n")
      .trim();
    const latestUserText =
      userMessages[userMessages.length - 1]?.text?.trim() || text.trim();
    const originalText = previousUserText || latestUserText || conversationText;
    const languageText = originalText || conversationText;
    const displayConversationText = messages
      .filter((message) => message.role === "user")
      .map((message) => message.text)
      .join("\n")
      .trim();

    window.sessionStorage.setItem(
      "otr:parser-upgrade:draft",
      JSON.stringify({
        source: "capture",
        journeyId: selectedTripId || null,
        originalText,
        currentParseResult: targetIntent,
        returnTo:
          pathname || (selectedTripId ? `/trips/${selectedTripId}/planner` : "/trips"),
        language: /[\u4e00-\u9fff]/.test(languageText) ? "zh" : "en",
        contextSnapshot: {
          selectedTrip,
          members,
          engineOptions,
          sessionState,
          conversationText: displayConversationText,
        },
      }),
    );
    closeCapture();
    router.push("/parser-upgrade?source=capture");
  }

  function renderCaptureInputForm(isImmersive: boolean) {
    const canSubmit =
      !isSubmitting &&
      !isTranscribing &&
      !isDetectingIntent &&
      Boolean(selectedTripId) &&
      Boolean(text.trim() || compressedImage);

    return (
      <form
        onSubmit={reviewCapture}
        className={
          isImmersive
            ? "border-t border-white/40 bg-[#e4f4ef]/95 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-2 shadow-[0_-12px_30px_rgba(0,0,0,0.08)] backdrop-blur"
            : "rounded-3xl border border-stone-200 bg-white p-2 shadow-sm"
        }
      >
        {compressedImage ? (
          <div className="mb-2 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={compressedImage.previewUrl}
              alt={t("capture.photo.previewAlt")}
              className="max-h-40 w-full object-cover"
            />
            <div className="flex flex-wrap gap-3 border-t border-stone-200 bg-white p-2 text-xs font-semibold text-stone-600">
              <span>{photoFileName}</span>
              <span>{compressedImage.width} x {compressedImage.height}</span>
              <span>{Math.round(compressedImage.blob.size / 1024)} KB</span>
            </div>
            {singlePhotoProgress !== null ? (
              <div className="border-t border-stone-200 bg-white px-2 py-2">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
                  <span>{t("capture.status.uploadingPhoto")}</span>
                  <span>{singlePhotoProgress}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-emerald-700 transition-all"
                    style={{ width: `${singlePhotoProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handlePhotoChange}
          className="sr-only"
        />
        <div className="flex items-end gap-2">
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() =>
              recorder.isRecording ? recorder.stop() : void recorder.start()
            }
            disabled={isTranscribing || isSubmitting || !selectedTripId}
            className={`grid size-11 shrink-0 place-items-center rounded-2xl shadow-sm transition active:scale-95 disabled:text-stone-300 md:rounded-full ${
              recorder.isRecording
                ? "bg-red-600 text-white"
                : isTranscribing
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-stone-100 text-stone-600"
            }`}
            title={t("capture.action.voice")}
            aria-label={t("capture.action.voice")}
          >
            {isTranscribing ? (
              <span className="text-xs font-bold">...</span>
            ) : (
              <MicrophoneIcon className="size-5" />
            )}
          </button>
          <textarea
            value={text}
            onFocus={isImmersive ? undefined : focusCaptureInput}
            onChange={(event) => setText(event.target.value)}
            rows={1}
            enterKeyHint="enter"
            autoFocus={isImmersive}
            placeholder={capturePlaceholder}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-base font-semibold leading-7 text-stone-950 placeholder:text-stone-500 shadow-sm outline-none focus:border-emerald-600 md:rounded-2xl md:text-sm md:leading-5"
          />
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (isMobileCaptureViewport()) setIsImmersiveInputOpen(true);
              setShowCaptureEmoji((current) => !current);
            }}
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-stone-100 text-2xl font-black text-emerald-800 shadow-sm transition active:scale-95 md:rounded-full"
            aria-label="表情"
          >
            ☺
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => photoInputRef.current?.click()}
            disabled={isPhotoPreparing || isSubmitting}
            className="grid size-11 shrink-0 place-items-center rounded-2xl bg-stone-100 text-3xl font-black text-emerald-800 shadow-sm transition active:scale-95 disabled:text-stone-300 md:rounded-full"
            title={t("capture.action.attach")}
          >
            {isPhotoPreparing ? "..." : "+"}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="h-11 shrink-0 rounded-xl bg-emerald-700 px-3 text-sm font-black text-white disabled:hidden md:rounded-full md:px-4"
          >
            {isDetectingIntent ? "..." : t("capture.action.send")}
          </button>
        </div>
      </form>
    );
  }

  function renderQuickRecordForm() {
    if (!isQuickRecordOpen || !quickRecordType) return null;
    const isExpense = quickRecordType === "expense";
    const isSchedule = quickRecordType === "schedule";
    const isReservation = !isExpense && !isSchedule;
    const effectiveReservationType = quickRecordReservationType(
      quickRecordType,
      quickRecordForm.reservationType,
    );
    const reservationCopy = reservationFormCopy(effectiveReservationType);
    const formHeading = isSchedule
      ? "单条行程"
      : isExpense
        ? "费用支出"
        : reservationCopy.heading;
    const titleLabel = isSchedule
      ? "日程标题"
      : isExpense
        ? "支出标题"
        : reservationCopy.titleLabel;
    const locationLabel = isSchedule
      ? "地点"
      : isExpense
        ? "消费地点"
        : reservationCopy.locationLabel;
    const startLabel = isSchedule ? "开始时间" : reservationCopy.startLabel;
    const endLabel = isSchedule ? "结束时间" : reservationCopy.endLabel;

    return (
      <div className="fixed inset-0 z-[2147483200] bg-stone-950/35 px-3 py-6 backdrop-blur-sm md:grid md:place-items-center">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitQuickRecord(false);
          }}
          className="mx-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-[#fffdf8] shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">
                快速记录
              </p>
              <h3 className="mt-1 text-xl font-black text-stone-950">
                {formHeading}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setQuickRecordType("");
                setIsQuickRecordOpen(false);
              }}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-stone-100 text-xl font-black text-stone-600"
              aria-label={t("capture.action.close")}
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-bold text-stone-600">
                  {titleLabel}
                </span>
                <input
                  value={quickRecordForm.title}
                  onChange={(event) =>
                    updateQuickRecordForm({ title: event.target.value })
                  }
                  className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-stone-600">
                  {isExpense ? "支出日期" : "开始日期"}
                </span>
                <input
                  type="date"
                  value={quickRecordForm.date}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    updateQuickRecordForm({
                      date: nextDate,
                      ...(!isExpense
                        ? {
                            endDate:
                              effectiveReservationType === "hotel"
                                ? addQuickRecordDateDays(nextDate, 1)
                                : nextDate,
                          }
                        : {}),
                    });
                  }}
                  className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                />
              </label>
              {!isExpense ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-600">
                      {startLabel}
                    </span>
                    <input
                      type="time"
                      value={quickRecordForm.startTime}
                      onChange={(event) =>
                        updateQuickRecordForm({ startTime: event.target.value })
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-white px-3 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-600">
                      {endLabel}
                    </span>
                    <input
                      type="time"
                      value={quickRecordForm.endTime}
                      onChange={(event) =>
                        updateQuickRecordForm({ endTime: event.target.value })
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-white px-3 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                    />
                  </label>
                </div>
              ) : null}
              {!isExpense ? (
                <label className="space-y-1">
                  <span className="text-xs font-bold text-stone-600">
                    {endLabel}日期
                  </span>
                  <input
                    type="date"
                    value={quickRecordForm.endDate}
                    onChange={(event) =>
                      updateQuickRecordForm({ endDate: event.target.value })
                    }
                    className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                  />
                </label>
              ) : null}
              {isSchedule ? (
                <label className="space-y-1">
                  <span className="text-xs font-bold text-stone-600">类型</span>
                  <select
                    value={quickRecordForm.eventType}
                    onChange={(event) =>
                      updateQuickRecordForm({
                        eventType: event.target.value as ItineraryEventType,
                      })
                    }
                    className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                  >
                    {captureEventTypes.map((type) => (
                      <option key={type} value={type}>
                        {captureEventTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {isReservation && quickRecordType === "reservation" ? (
                <label className="space-y-1">
                  <span className="text-xs font-bold text-stone-600">预订类型</span>
                  <select
                    value={quickRecordForm.reservationType}
                    onChange={(event) => {
                      const nextType = event.target
                        .value as ItineraryReservationType;
                      const defaults = reservationDefaultsForType(
                        nextType,
                        quickRecordForm.date,
                      );
                      updateQuickRecordForm({
                        reservationType: nextType,
                        ...defaults,
                      });
                    }}
                    className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                  >
                    {captureReservationTypes.map((type) => (
                      <option key={type} value={type}>
                        {captureReservationTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {isExpense ? (
                <>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-600">金额</span>
                    <input
                      inputMode="decimal"
                      value={quickRecordForm.amount}
                      onChange={(event) =>
                        updateQuickRecordForm({ amount: event.target.value })
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-600">币种</span>
                    <input
                      value={quickRecordForm.currency}
                      onChange={(event) =>
                        updateQuickRecordForm({
                          currency: event.target.value.toUpperCase(),
                        })
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-600">类别</span>
                    <select
                      value={quickRecordForm.category}
                      onChange={(event) =>
                        updateQuickRecordForm({
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
                    <span className="text-xs font-bold text-stone-600">付款人</span>
                    <select
                      value={quickRecordForm.payerMemberId}
                      onChange={(event) =>
                        updateQuickRecordForm({ payerMemberId: event.target.value })
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                    >
                      <option value="">未选择</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-600">记账方式</span>
                    <select
                      value={quickRecordForm.accountingMode}
                      onChange={(event) =>
                        updateQuickRecordForm({
                          accountingMode: event.target.value as LedgerAccountingMode,
                        })
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                    >
                      <option value="shared">共同分摊</option>
                      <option value="stats_only">只统计</option>
                    </select>
                  </label>
                </>
              ) : null}
              {!isExpense ? (
                <>
                  {isReservation ? (
                    <>
                      <label className="space-y-1">
                        <span className="text-xs font-bold text-stone-600">
                          {reservationCopy.providerLabel}
                        </span>
                        <input
                          value={quickRecordForm.provider}
                          onChange={(event) =>
                            updateQuickRecordForm({ provider: event.target.value })
                          }
                          placeholder={reservationCopy.providerLabel}
                          className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-bold text-stone-600">
                          {reservationCopy.codeLabel}
                        </span>
                        <input
                          value={quickRecordForm.confirmationCode}
                          onChange={(event) =>
                            updateQuickRecordForm({
                              confirmationCode: event.target.value,
                            })
                          }
                          placeholder={reservationCopy.codeLabel}
                          className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                        />
                      </label>
                    </>
                  ) : null}
                </>
              ) : null}
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-bold text-stone-600">
                  {locationLabel}
                </span>
                <input
                  value={quickRecordForm.locationName}
                  onChange={(event) =>
                    updateQuickRecordForm({ locationName: event.target.value })
                  }
                  placeholder={locationLabel}
                  className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                />
              </label>
              {isReservation ? (
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-bold text-stone-600">
                    {reservationCopy.urlLabel}
                  </span>
                  <input
                    value={quickRecordForm.url}
                    onChange={(event) =>
                      updateQuickRecordForm({ url: event.target.value })
                    }
                    placeholder={reservationCopy.urlLabel}
                    className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-500"
                  />
                </label>
              ) : null}
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-bold text-stone-600">备注</span>
                <textarea
                  value={quickRecordForm.description}
                  onChange={(event) =>
                    updateQuickRecordForm({ description: event.target.value })
                  }
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base leading-6 text-stone-950 outline-none focus:border-emerald-500"
                />
              </label>
            </div>
          </div>
          <div className="grid gap-2 border-t border-stone-100 p-4 sm:grid-cols-2">
            {quickRecordError ? (
              <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 sm:col-span-2">
                {quickRecordError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void submitQuickRecord(true)}
              disabled={isQuickRecordSaving}
              className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800 disabled:text-stone-400"
            >
              {isQuickRecordSaving ? "保存中..." : "确定并添加下一条"}
            </button>
            <button
              type="submit"
              disabled={isQuickRecordSaving}
              className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:bg-stone-300"
            >
              {isQuickRecordSaving ? "保存中..." : "确定添加并关闭"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const immersiveInputPortal =
    isOpen && isImmersiveInputOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[2147483100] flex flex-col bg-[#dcefe9] md:hidden">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-[env(safe-area-inset-top,0px)]">
              <div className="mx-auto max-w-3xl py-3">
                <div className="rounded-3xl border border-emerald-100 bg-white/95 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">
                        {t("capture.eyebrow")}
                      </p>
                      <h3 className="mt-1 text-lg font-black text-stone-950">
                        {captureTitle}
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-stone-500">
                        {captureContextLine}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeImmersiveInput}
                      className="grid size-10 shrink-0 place-items-center rounded-full bg-stone-100 text-xl font-black text-stone-600"
                      aria-label={t("capture.action.close")}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="mt-3 rounded-3xl bg-white/60 p-3">
                  {messages.length === 0 ? (
                    <div className="rounded-3xl bg-emerald-50 px-4 py-3 text-sm font-semibold leading-6 text-emerald-950">
                      {captureIntro}
                    </div>
                  ) : (
                    <CaptureMessageList
                      messages={messages}
                      members={members}
                      onQuickAction={handleQuickAction}
                      onActionUpdate={handleActionUpdate}
                    />
                  )}
                </div>
              </div>
            </div>
            {showCaptureEmoji ? (
              <div className="border-t border-emerald-900/5 bg-[#dcefeb] px-4 py-3">
                <div className="mx-auto grid max-w-3xl grid-cols-6 gap-3">
                  {captureQuickEmojis.map((emoji, index) => (
                    <button
                      key={`${emoji}-${index}`}
                      type="button"
                      onClick={() => appendCaptureEmoji(emoji)}
                      className="text-3xl leading-none"
                      aria-label={`输入表情 ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {renderCaptureInputForm(true)}
          </div>,
          document.body,
        )
      : null;

  return (
    <CaptureModalContext.Provider value={{ openCapture }}>
      {children}
      {isOpen ? (
        <div className="fixed inset-0 z-[2147483000]">
          <button
            type="button"
            aria-label={t("capture.action.close")}
            className="absolute inset-0 bg-stone-950/35 backdrop-blur-sm"
            onClick={closeCapture}
          />
          <section className="absolute inset-x-0 bottom-0 z-[1] flex max-h-[92vh] flex-col rounded-t-[30px] bg-[#fffdf8] p-4 shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[86vh] md:w-[640px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:p-5">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-200 md:hidden" />
            <div className="mt-4 flex items-start justify-between gap-4 md:mt-0">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                  {t("capture.eyebrow")}
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-stone-950">
                  {captureTitle}
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  {captureContextLine}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={clearCaptureSession}
                  className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
                >
                  {t("capture.action.clear")}
                </button>
                <button
                  type="button"
                  onClick={closeCapture}
                  className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
                >
                  {t("capture.action.close")}
                </button>
              </div>
            </div>

            {isLoadingTrips ? (
              <div className="mt-5 rounded-2xl bg-white p-4 text-sm font-semibold text-stone-600">
                {t("capture.status.loadingJourneys")}
              </div>
            ) : null}

            {!isLoadingTrips && trips.length > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <select
                  value={selectedTripId}
                  onChange={(event) => void changeSelectedTrip(event.target.value)}
                  disabled={messages.length > 0}
                  className="min-w-0 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-sm font-bold text-stone-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 disabled:text-stone-500"
                >
                  {Object.entries(groupedTrips).map(([status, group]) =>
                    group.length > 0 ? (
                      <optgroup
                        key={status}
                        label={
                          status === "active"
                            ? t("trips.group.active")
                            : status === "upcoming"
                              ? t("trips.group.upcoming")
                              : t("trips.group.completed")
                        }
                      >
                        {group.map((trip) => (
                          <option key={trip.id} value={trip.id}>
                            {trip.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null,
                  )}
                </select>
                <select
                  value={quickRecordType}
                  onChange={(event) =>
                    handleQuickRecordSelect(event.target.value as QuickRecordType)
                  }
                  disabled={!selectedTripId}
                  className="min-w-0 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-sm font-bold text-stone-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 disabled:text-stone-500"
                >
                  <option value="">—快速记录—</option>
                  <option value="schedule">一条日程</option>
                  <option value="expense">费用支出</option>
                  <option value="hotel">酒店预订</option>
                  <option value="flight">航班信息</option>
                  <option value="reservation">预订信息</option>
                </select>
              </div>
            ) : null}

            <div
              ref={messageScrollerRef}
              className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-3xl bg-[#faf7ef] p-3"
            >
              {messages.length === 0 ? (
                <div className="flex items-start gap-3">
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-emerald-700 text-xs font-black text-white">
                    O
                  </div>
                  <div className="max-w-[92%] rounded-3xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
                    {captureIntro}
                  </div>
                </div>
              ) : (
                <CaptureMessageList
                  messages={messages}
                  members={members}
                  onQuickAction={handleQuickAction}
                  onActionUpdate={handleActionUpdate}
                />
              )}
            </div>

            <div className="mt-3 space-y-3">
              <CaptureConfirmCard
                intent={intentResult}
                isSubmitting={isSubmitting}
                confirmLabel={confirmLabel}
                onConfirm={() => void confirmCapture()}
              />

              {intentResult ? (
                <div className="rounded-2xl border border-stone-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setIsDebugOpen((current) => !current)}
                      className="text-xs font-black uppercase tracking-[0.14em] text-stone-500"
                    >
                      {isDebugOpen ? t("capture.debug.hide") : t("capture.debug.show")}
                    </button>
                    <button
                      type="button"
                      onClick={() => openCaptureParserUpgrade()}
                      className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"
                    >
                      {t("capture.debug.train")}
                    </button>
                  </div>
                  {isDebugOpen ? (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-50">
                      {JSON.stringify(
                        {
                          status: intentResult.needsClarification
                            ? "need_more_info"
                            : "ready_to_confirm",
                          intentType: intentResult.intent,
                          confidence: intentResult.confidence,
                          extractedFields: intentResult.actionGraph,
                          missingFields: intentResult.missingInformation,
                          suggestedQuestions: intentResult.clarificationQuestions,
                          provider: intentResult.provider,
                          model: intentResult.model,
                          reason: intentResult.reason,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  ) : null}
                </div>
              ) : null}

              {showCaptureEmoji && !isImmersiveInputOpen ? (
                <div className="grid grid-cols-6 gap-2 rounded-3xl bg-emerald-50 p-3">
                  {captureQuickEmojis.map((emoji, index) => (
                    <button
                      key={`${emoji}-${index}`}
                      type="button"
                      onClick={() => appendCaptureEmoji(emoji)}
                      className="text-2xl leading-none"
                      aria-label={`输入表情 ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
              {renderCaptureInputForm(false)}
            </div>

            {error ? (
              <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </p>
            ) : null}
          </section>
          {immersiveInputPortal}
          {renderQuickRecordForm()}
        </div>
      ) : null}
    </CaptureModalContext.Provider>
  );
}
