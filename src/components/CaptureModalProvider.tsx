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
import { usePathname, useRouter } from "next/navigation";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import {
  CaptureConfirmCard,
  CaptureMessageList,
  type CaptureChatMessage,
  type CaptureQuickAction,
} from "@/components/capture/CaptureChatWindow";
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
import {
  compareTripsByStartDateAsc,
  getJourneyStatus,
} from "@/lib/journeys/status";
import { getLedgerData } from "@/lib/supabase/ledger";
import { getPlannerV2, type PlannerV2Day } from "@/lib/supabase/planner-v2";
import { requestVoiceTranscription } from "@/lib/supabase/media-assets";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import { startPhotoUploadBatch } from "@/lib/uploads/photo-upload-manager";
import type { ItineraryReservation, JourneyMember, Trip } from "@/types";

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

const CaptureModalContext = createContext<CaptureModalContextValue | null>(null);

function getActiveTripId(pathname: string) {
  const match = pathname.match(/^\/trips\/([^/]+)/);
  return match?.[1] ?? null;
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
  const [error, setError] = useState<string | null>(null);
  const [engineOptions, setEngineOptions] = useState<CaptureEngineOptions>({
    entryPoint: "global_capture",
  });

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? null;
  const confirmLabel = intentResult?.intent === "planner_update"
    ? "添加行程"
    : intentResult?.intent === "expense"
      ? "记录消费"
      : intentResult?.intent === "navigation"
        ? "开始导航"
        : intentResult?.intent === "assistant"
          ? "继续"
          : "保存回忆";

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
    ? "希望在当天的行程中增加什么？"
    : "What happened?";
  const captureIntro = isDayPlannerAdd
    ? "告诉我时间、地点和要做的事，我会先整理成当天行程，确认后再添加。"
    : "直接告诉我发生了什么。我会一步步补齐信息，确认后再写入 Journey。";
  const capturePlaceholder = isDayPlannerAdd
    ? "例如：18:00 从酒店出发去第一个景点"
    : "继续告诉我更多细节...";
  const captureContextLine = isDayPlannerAdd
    ? `${selectedTrip?.name || "Choose a journey"} · 当天行程${
        lockedDayDate ? ` · ${lockedDayDate}` : ""
      }`
    : `${selectedTrip?.name || "Choose a journey"}${
        sessionId ? ` · session ${sessionId.slice(0, 8)}` : ""
      }`;

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
    setError(null);
    setEngineOptions({ entryPoint: "global_capture" });
  }

  function closeCapture() {
    setIsOpen(false);
    setError(null);
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
      setError(getErrorMessage(loadError, "Could not load journeys."));
    } finally {
      setIsLoadingTrips(false);
    }
  }

  const recorder = useVoiceRecorder({
    onRecordingComplete: async (file) => {
      if (!selectedTripId) {
        setError("Choose a journey before recording.");
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
        setError(getErrorMessage(voiceError, "Could not transcribe voice."));
      } finally {
        setIsTranscribing(false);
      }
    },
    onError: (recordError) => {
      setError(getErrorMessage(recordError, "Could not start recording."));
    },
  });

  useEffect(() => {
    return () => {
      if (compressedImage?.previewUrl) {
        URL.revokeObjectURL(compressedImage.previewUrl);
      }
    };
  }, [compressedImage]);

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
      setEngineOptions({
        entryPoint: options?.entryPoint ?? "global_capture",
        intentBias: options?.intentBias,
        intentLock: options?.intentLock,
        mode: options?.mode ?? "single_action",
        lockedContext: {
          ...(options?.lockedContext ?? {}),
          ...(options?.tripId ? { journeyId: options.tripId } : {}),
        },
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
      setError("Choose a journey first.");
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
            text: `Uploaded ${files.length} photos`,
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `已开始后台上传 ${files.length} 张照片。你可以关闭 Capture 或切换页面，上传会继续进行。`,
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
      setError(getErrorMessage(photoError, "Could not prepare this photo."));
    } finally {
      setIsPhotoPreparing(false);
    }
  }

  function isAssistantWithIntent(
    message: CaptureChatMessage,
  ): message is Extract<CaptureChatMessage, { role: "assistant" }> & {
    intent: CaptureIntentDetection;
  } {
    return message.role === "assistant" && Boolean(message.intent);
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
                    label: "付款人",
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
              label: "分摊",
              value: "全员人均摊",
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
              label: "记账模式",
              value: "只统计不分摊",
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

  function resolveSessionInputLocally(nextText: string) {
    const currentIntent = latestIntent();
    if (!currentIntent) return false;

    const normalizedText = nextText.trim().toLocaleLowerCase();
    if (!normalizedText) return false;

    const timeUpdate = parseLocalTimeUpdate(nextText);
    if (timeUpdate && currentIntent.actionGraph.nodes.some((node) => node.intent === "planner_update")) {
      const nextIntent = applyPlannerTimeUpdate(currentIntent, timeUpdate);
      if (nextIntent) {
        const userMessage: CaptureChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text: nextText,
        };
        const assistantMessage: CaptureChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "收到，我已经把时间补到上一项安排里。",
          intent: nextIntent,
        };
        setMessages((current) => [...current, userMessage, assistantMessage]);
        setIntentResult(nextIntent);
        setSessionState(stateFromIntent(nextIntent));
        setText("");
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
        ? "收到，我已经更新了这项信息，还差下面这些。"
        : "收到，信息已经补齐，可以确认执行。",
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

    const planner = await getPlannerV2(selectedTrip);
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
            ? "谁支付的？"
            : field === "splitMembers"
              ? "这笔费用怎么分摊？"
              : field === "targetPlannerItem"
                ? "要修改哪一个行程？"
              : `还需要补充 ${field}`,
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
    const result = detectionFromLocalResolution(resolution, answerText);
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
          ? answerText || "我先用本地 Capture State Machine 理解了这个查询。"
          : result.needsClarification
            ? "我理解了，还差一点必要信息。"
            : "我准备帮你完成下面的操作。",
      intent: result,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setSessionState(stateFromLocalResolution(resolution));
    setIntentResult(resolution.action === "answer" ? null : result);
    setText("");
  }

  async function reviewCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTripId) {
      setError("Choose a journey first.");
      return;
    }
    if (!text.trim() && !compressedImage) {
      setError("Capture needs text, voice, or an attachment.");
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
        if (exactExampleResult) {
          const userMessage: CaptureChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            text: trimmedText,
          };
          const assistantMessage: CaptureChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: exactExampleResult.needsClarification
              ? "我按你教过的解析方式理解了，还差一点必要信息。"
              : "我按你教过的解析方式准备好了下面的操作。",
            intent: exactExampleResult,
          };
          setMessages((current) => [...current, userMessage, assistantMessage]);
          setIntentResult(exactExampleResult);
          setSessionState(stateFromIntent(exactExampleResult));
          setText("");
          setPhotoFileName("");
          setOriginalPhotoFile(null);
          setCompressedImage(null);
          if (
            exactExampleResult.intent === "memory" &&
            exactExampleResult.shouldAutoExecute &&
            messages.length === 0
          ) {
            await confirmCapture(exactExampleResult);
          }
          return;
        }
      }

      if (!compressedImage && resolveSessionInputLocally(trimmedText)) {
        return;
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

      const result = await detectCaptureIntent({
        tripId: selectedTripId,
        text:
          trimmedText || (compressedImage ? "Uploaded image attachment" : ""),
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
      const userMessage: CaptureChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmedText || "Uploaded image attachment",
        attachmentName: photoFileName || undefined,
      };
      const assistantMessage: CaptureChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.needsClarification
          ? "我理解了大方向，还差一点必要信息。"
          : "我准备帮你完成下面的操作。",
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
      setError(getErrorMessage(detectError, "Could not detect capture intent."));
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
      const captureText = messages
        .filter((message) => message.role === "user")
        .map((message) => message.text)
        .join("\n");
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
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "已完成。我保留了这段对话，后面可以直接继续补充。",
        },
      ]);
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
      setIntentResult(null);
      setIsDebugOpen(false);
      closeCapture();
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Could not complete capture."));
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

  return (
    <CaptureModalContext.Provider value={{ openCapture }}>
      {children}
      {isOpen ? (
        <div className="fixed inset-0 z-[2147483000]">
          <button
            type="button"
            aria-label="Close Capture"
            className="absolute inset-0 bg-stone-950/35 backdrop-blur-sm"
            onClick={closeCapture}
          />
          <section className="absolute inset-x-0 bottom-0 z-[1] flex max-h-[92vh] flex-col rounded-t-[30px] bg-[#fffdf8] p-4 shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[86vh] md:w-[640px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:p-5">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-200 md:hidden" />
            <div className="mt-4 flex items-start justify-between gap-4 md:mt-0">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                  Capture
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
                  Clear
                </button>
                <button
                  type="button"
                  onClick={closeCapture}
                  className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
                >
                  Close
                </button>
              </div>
            </div>

            {isLoadingTrips ? (
              <div className="mt-5 rounded-2xl bg-white p-4 text-sm font-semibold text-stone-600">
                Loading journeys...
              </div>
            ) : null}

            {!isLoadingTrips && trips.length > 0 ? (
              <select
                value={selectedTripId}
                onChange={(event) => void changeSelectedTrip(event.target.value)}
                disabled={messages.length > 0}
                className="mt-4 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 disabled:text-stone-500"
              >
                {Object.entries(groupedTrips).map(([status, group]) =>
                  group.length > 0 ? (
                    <optgroup key={status} label={status}>
                      {group.map((trip) => (
                        <option key={trip.id} value={trip.id}>
                          {trip.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </select>
            ) : null}

            <div
              ref={messageScrollerRef}
              className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-3xl bg-[#faf7ef] p-3"
            >
              {messages.length === 0 ? (
                <div className="rounded-3xl bg-white p-4 text-sm leading-6 text-stone-600 shadow-sm">
                  {captureIntro}
                </div>
              ) : (
                <CaptureMessageList
                  messages={messages}
                  members={members}
                  onQuickAction={handleQuickAction}
                  onUpgradeParser={(messageId, intent) =>
                    openCaptureParserUpgrade(intent, messageId)
                  }
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
                      {isDebugOpen ? "Hide Debug" : "Capture AI Debug"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openCaptureParserUpgrade()}
                      className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"
                    >
                      解析不对？教它一次
                    </button>
                  </div>
                  {isDebugOpen ? (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-50">
                      {JSON.stringify(
                        {
                          sessionId,
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

              <form onSubmit={reviewCapture} className="rounded-3xl border border-stone-200 bg-white p-2 shadow-sm">
                {compressedImage ? (
                  <div className="mb-2 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={compressedImage.previewUrl}
                      alt="Attachment preview"
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
                          <span>Uploading photo</span>
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
                    onClick={() => photoInputRef.current?.click()}
                    disabled={isPhotoPreparing || isSubmitting}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-stone-100 text-xl font-bold text-stone-600 disabled:text-stone-300"
                    title="Attach"
                  >
                    {isPhotoPreparing ? "..." : "+"}
                  </button>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={1}
                    placeholder={capturePlaceholder}
                    className="min-h-11 flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm leading-5 text-stone-950 placeholder:text-stone-500 outline-none focus:border-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      recorder.isRecording ? recorder.stop() : void recorder.start()
                    }
                    disabled={isTranscribing || isSubmitting || !selectedTripId}
                    className={`grid size-11 shrink-0 place-items-center rounded-full disabled:text-stone-300 ${
                      recorder.isRecording
                        ? "bg-red-600 text-white"
                        : isTranscribing
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-stone-100 text-stone-600"
                    }`}
                    title="Voice"
                    aria-label="Voice"
                  >
                    {isTranscribing ? (
                      <span className="text-xs font-bold">...</span>
                    ) : (
                      <MicrophoneIcon />
                    )}
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      isTranscribing ||
                      isDetectingIntent ||
                      !selectedTripId ||
                      (!text.trim() && !compressedImage)
                    }
                    className="rounded-full bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {isDetectingIntent ? "..." : "Send"}
                  </button>
                </div>
              </form>
            </div>

            {error ? (
              <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </CaptureModalContext.Provider>
  );
}
