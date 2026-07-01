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
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useCaptureModal } from "@/components/CaptureModalProvider";
import { useI18n } from "@/components/I18nProvider";
import { compressImageFile } from "@/lib/images";
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
import { createPhotoMemory, createTextMemory } from "@/lib/supabase/memories";
import { requestVoiceTranscription } from "@/lib/supabase/media-assets";
import { startPhotoUploadBatch } from "@/lib/uploads/photo-upload-manager";

type Capture2OpenOptions = {
  tripId?: string | null;
  memoryDateKey?: string | null;
  memoryContextLabel?: string | null;
};

type Capture2ContextValue = {
  openCapture2: (options?: Capture2OpenOptions) => void;
};

type Capture2Mode = "home" | "text";
type Capture2TextDestination = "inbox" | "memory";

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
  queryAnswer?: string | null;
  transcriptionProvider?: string | null;
  transcriptionModel?: string | null;
};

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
  const classicCapture = useCaptureModal();
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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lastAudioFile, setLastAudioFile] = useState<File | null>(null);
  const [lastMediaFiles, setLastMediaFiles] = useState<File[]>([]);
  const [uploadItems, setUploadItems] = useState<Capture2UploadItem[]>([]);
  const [interpretation, setInterpretation] = useState<Capture2Interpretation | null>(
    null,
  );
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(false);

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
    setStatus(null);
    setError(null);
    setUploadItems([]);
    setInterpretation(null);
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
    setUploadItems([]);
    setInterpretation(null);
    setMemoryContext({ dateKey: localDateKey(), source: "today" });
    setJourneyMemoryContext(null);
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
      closeCapture2();
      classicCapture.openCapture({
        tripId: activeTripId,
        quickRecordType: "expense",
        quickRecordPrefill: {
          title: classification.extracted.title || t("capture2.prefill.expenseTitle"),
          amount: classification.extracted.amount ?? "",
          currency: classification.extracted.currency || "NZD",
          category: (classification.extracted.category ?? "other") as never,
          date: todayDate(),
        },
      });
      return;
    }

    if (classification.action === "open_planner_form") {
      const reservationType = classification.extracted.reservationType;
      const quickRecordType =
        reservationType === "hotel"
          ? "hotel"
          : reservationType === "flight"
            ? "flight"
            : reservationType === "reservation"
              ? "reservation"
              : "schedule";
      closeCapture2();
      classicCapture.openCapture({
        tripId: activeTripId,
        quickRecordType,
        quickRecordPrefill: {
          title: classification.extracted.title || value,
          eventType: (classification.extracted.eventType ?? "activity") as never,
          reservationType: (reservationType ?? "other") as never,
          date: todayDate(),
          endDate: todayDate(),
          description: value,
        },
      });
    }
  }

  async function classifyAndRouteText(input: {
    value: string;
    source: "text" | "voice";
    shouldSaveRawEvent: boolean;
    transcriptionProvider?: string | null;
    transcriptionModel?: string | null;
  }) {
    const activeTripId = tripId;
    const classification = classifyCapture2SafeIntent(input.value);
    let queryAnswer: string | null = null;
    if (input.shouldSaveRawEvent) {
      await saveRawText({
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
      queryAnswer,
      transcriptionProvider: input.transcriptionProvider ?? null,
      transcriptionModel: input.transcriptionModel ?? null,
    });
  }

  async function submitText() {
    setError(null);
    setStatus(null);
    setIsSaving(true);
    try {
      const activeTripId = tripId;
      const value = text.trim();
      if (textDestination === "memory") {
        if (!activeTripId) throw new Error(t("capture2.error.noJourney"));
        const memory = await saveTextMemory(value);
        setStatus(t("capture2.status.memorySaved"));
        setInterpretation(null);
        closeCapture2();
        router.push(
          `/trips/${activeTripId}/timeline?view=timeline&memory=${encodeURIComponent(memory.id)}`,
        );
        return;
      } else {
        await classifyAndRouteText({
          value,
          source: "text",
          shouldSaveRawEvent: true,
        });
      }
      setText("");
      setMode("home");
      setTextDestination("inbox");
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
      closeCapture2();
      classicCapture.openCapture({
        tripId: activeTripId,
        quickRecordType: "expense",
      });
      return;
    }
    if (kind === "planner") {
      closeCapture2();
      classicCapture.openCapture({
        tripId: activeTripId,
        quickRecordType: "schedule",
      });
      return;
    }
    closeCapture2();
    router.push(`/trips/${activeTripId}/planner/import`);
  }

  const canUseJourney = Boolean(tripId);
  const isBusy = isSaving || isUploading || isTranscribing;
  const todayContext = todayMemoryContext();

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
                {interpretation ? (
                  <div
                    data-capture2-panel
                    className="rounded-none bg-stone-950/70 p-4 text-white shadow-xl shadow-stone-950/20 backdrop-blur-sm md:rounded-2xl"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">
                          {t("capture2.safeMode.analysis")}
                        </p>
                        <h3 className="mt-1 text-lg font-black">
                          {intentLabel(interpretation.classification.intent)}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
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
                          className={`rounded-full px-3 py-1 text-xs font-black ${
                            isSpeechEnabled
                              ? "bg-emerald-400 text-stone-950"
                              : "bg-white/10 text-white"
                          }`}
                        >
                          {isSpeechEnabled
                            ? t("capture2.speech.on")
                            : t("capture2.speech.off")}
                        </button>
                        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-black text-white">
                          {Math.round(interpretation.classification.confidence * 100)}%
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="rounded-none bg-white/10 px-4 py-3 md:rounded-2xl">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-300">
                          {t("capture2.safeMode.userSaid")}
                        </p>
                        <p className="mt-1 text-2xl font-semibold leading-snug text-white">
                          {interpretation.value}
                        </p>
                        {interpretation.source === "voice" ? (
                          <p className="mt-2 text-xs font-bold text-stone-300">
                            STT: {interpretation.transcriptionProvider ?? "unknown"} ·{" "}
                            {interpretation.transcriptionModel ?? "unknown"}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-none bg-white/10 px-4 py-3 md:rounded-2xl">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-300">
                              {t("capture2.safeMode.systemUnderstood")}
                            </p>
                            <p className="mt-1 text-lg font-black text-emerald-200">
                              {translatedActionLabel(interpretation.classification.action)}
                            </p>
                            <p className="mt-1 text-sm font-bold leading-6 text-stone-100">
                              Intent: {interpretation.classification.intent} ·{" "}
                              {interpretation.classification.reason}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => speakInterpretation(interpretation)}
                            className="grid h-12 shrink-0 place-items-center rounded-full bg-white/10 px-4 text-sm font-black text-white"
                            aria-label={t("capture2.action.play")}
                          >
                            {t("capture2.action.play")}
                          </button>
                        </div>
                      </div>
                      {Object.keys(interpretation.classification.extracted).length > 0 ? (
                        <pre className="max-h-28 overflow-auto rounded-none bg-black/35 px-4 py-3 text-xs leading-5 text-stone-100 md:rounded-2xl">
                          {JSON.stringify(
                            interpretation.classification.extracted,
                            null,
                            2,
                          )}
                        </pre>
                      ) : null}
                      {interpretation.queryAnswer ? (
                        <div className="rounded-none bg-emerald-400/15 px-4 py-3 text-sm font-black leading-6 text-emerald-50 md:rounded-2xl">
                          {interpretation.queryAnswer}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setInterpretation(null)}
                        className="rounded-none bg-white/10 px-4 py-3 text-sm font-black text-white md:rounded-2xl"
                      >
                        {t("capture2.action.skip")}
                      </button>
                      {interpretation.classification.action === "defer" ? (
                        <button
                          type="button"
                          disabled
                          className="rounded-none bg-emerald-900/60 px-4 py-3 text-sm font-black text-emerald-100 md:rounded-2xl"
                        >
                          {t("capture2.action.keepInbox")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            openClassifiedAction(
                              interpretation.value,
                              interpretation.classification,
                            )
                          }
                          className="rounded-none bg-emerald-400 px-4 py-3 text-sm font-black text-stone-950 md:rounded-2xl"
                        >
                          {translatedActionLabel(interpretation.classification.action)}
                        </button>
                      )}
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

                  {mode === "text" ? (
                    <div className="mt-5">
                      {textDestination === "memory" ? (
                        <div className="mb-3 rounded-2xl bg-emerald-50/80 p-2 ring-1 ring-emerald-100">
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
                      ) : null}
                      <textarea
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        rows={11}
                        autoFocus
                        placeholder={
                          textDestination === "memory"
                            ? t("capture2.text.memoryPlaceholder")
                            : t("capture2.text.placeholder")
                        }
                        className="w-full resize-none rounded-2xl border border-stone-200 bg-white p-4 text-base font-semibold leading-7 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                      />
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setMode("home");
                            setTextDestination("inbox");
                          }}
                          className="rounded-2xl bg-stone-100 px-4 py-3 text-sm font-black text-stone-700"
                        >
                          {t("capture2.action.back")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void submitText()}
                          disabled={isBusy || !text.trim() || !canUseJourney}
                          className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-black text-white shadow-lg shadow-emerald-900/20 disabled:cursor-not-allowed disabled:bg-stone-300"
                        >
                          {isSaving
                            ? t("capture2.status.saving")
                            : textDestination === "memory"
                              ? t("capture2.action.saveMemory")
                              : t("capture2.action.saveInbox")}
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
