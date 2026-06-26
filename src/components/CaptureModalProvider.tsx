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
import { executeCaptureAction } from "@/lib/capture-ai/actions";
import { detectCaptureIntent } from "@/lib/capture-ai/client";
import type {
  CaptureEngineOptions,
  CaptureIntentDetection,
} from "@/lib/capture-ai/types";
import { getErrorMessage } from "@/lib/errors";
import { compressImageFile, type CompressedImage } from "@/lib/images";
import { getJourneyStatus } from "@/lib/journeys/status";
import { requestVoiceTranscription } from "@/lib/supabase/media-assets";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

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

function visibleActionFacts(action: CaptureIntentDetection["actionGraph"]["nodes"][number]) {
  const facts = action.facts?.length
    ? action.facts
    : action.details.map((detail) => ({
        key: `${detail.label}-${detail.value}`,
        label: detail.label,
        value: detail.value,
        source: detail.source ?? ("explicit" as const),
        evidence: detail.evidence,
      }));

  return facts.filter((fact) => fact.source !== "inferred");
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
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<"input" | "review">("input");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const [text, setText] = useState("");
  const [photoFileName, setPhotoFileName] = useState("");
  const [originalPhotoFile, setOriginalPhotoFile] = useState<File | null>(null);
  const [compressedImage, setCompressedImage] = useState<CompressedImage | null>(
    null,
  );
  const [isPhotoPreparing, setIsPhotoPreparing] = useState(false);
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
      active: trips.filter((trip) => getJourneyStatus(trip) === "active"),
      upcoming: trips.filter((trip) => getJourneyStatus(trip) === "upcoming"),
      completed: trips.filter((trip) => getJourneyStatus(trip) === "completed"),
    }),
    [trips],
  );

  function resetCaptureState() {
    if (compressedImage?.previewUrl) {
      URL.revokeObjectURL(compressedImage.previewUrl);
    }
    setPhase("input");
    setText("");
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
    resetCaptureState();
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
    resetCaptureState();
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
    setIsOpen(true);
    void loadTrips(options?.tripId ?? activeTripId);
  }

  async function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setIsPhotoPreparing(true);

    try {
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
      if (engineOptions.entryPoint === "planner_import") {
        const importText = text.trim();
        window.localStorage.setItem(
          `otr:planner-import-draft:${selectedTripId}`,
          importText,
        );
        closeCapture();
        router.push(`/trips/${selectedTripId}/planner/import`);
        return;
      }

      const result = await detectCaptureIntent({
        tripId: selectedTripId,
        text: text.trim() || (compressedImage ? "Uploaded image attachment" : ""),
        engineOptions: {
          ...engineOptions,
          lockedContext: {
            ...(engineOptions.lockedContext ?? {}),
            journeyId: selectedTripId,
          },
        },
        inputTypes: [
          ...(text.trim() ? (["text"] as const) : []),
          ...(compressedImage ? (["image"] as const) : []),
        ],
      });
      setIntentResult(result);
      if (result.intent === "memory" && result.shouldAutoExecute) {
        await confirmCapture(result);
        return;
      }
      setPhase("review");
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

    try {
      const selectedIntent = resultOverride ?? intentResult;
      await executeCaptureAction({
        tripId: selectedTripId,
        text,
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
      closeCapture();
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Could not complete capture."));
    } finally {
      setIsSubmitting(false);
    }
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
          <section className="absolute inset-x-0 bottom-0 z-[1] max-h-[92vh] overflow-y-auto rounded-t-[30px] bg-[#fffdf8] p-4 shadow-2xl md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[86vh] md:w-[640px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:p-5">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-200 md:hidden" />
            <div className="mt-4 flex items-start justify-between gap-4 md:mt-0">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                  Capture
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-stone-950">
                  {phase === "input"
                    ? "What happened?"
                    : "我准备帮你完成下面的操作"}
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  {selectedTrip?.name || "Choose a journey"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeCapture}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
              >
                Close
              </button>
            </div>

            {isLoadingTrips ? (
              <div className="mt-5 rounded-2xl bg-white p-4 text-sm font-semibold text-stone-600">
                Loading journeys...
              </div>
            ) : null}

            {!isLoadingTrips && trips.length > 0 ? (
              <select
                value={selectedTripId}
                onChange={(event) => setSelectedTripId(event.target.value)}
                disabled={phase === "review"}
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

            {phase === "input" ? (
              <form onSubmit={reviewCapture} className="mt-4">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={7}
                  placeholder="Describe what happened..."
                  className="w-full resize-none rounded-2xl border border-stone-200 bg-white p-4 text-base leading-7 text-stone-950 placeholder:text-stone-500 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
                />

                {compressedImage ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={compressedImage.previewUrl}
                      alt="Attachment preview"
                      className="max-h-[300px] w-full object-cover"
                    />
                    <div className="flex flex-wrap gap-3 border-t border-stone-200 bg-white p-3 text-xs font-semibold text-stone-600">
                      <span>{photoFileName}</span>
                      <span>{compressedImage.width} x {compressedImage.height}</span>
                      <span>{Math.round(compressedImage.blob.size / 1024)} KB</span>
                    </div>
                  </div>
                ) : null}

                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="sr-only"
                />
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={isPhotoPreparing || isSubmitting}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-stone-100 text-xl font-bold text-stone-600 disabled:text-stone-300"
                    title="Attach"
                  >
                    {isPhotoPreparing ? "..." : "+"}
                  </button>
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
                    className="ml-auto rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {isDetectingIntent ? "Detecting..." : "Continue"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl bg-emerald-50 p-4">
                  <p className="text-sm font-semibold text-emerald-950">
                    我理解你的意思是：
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-stone-900">
                    {text.trim() || "你上传了一个附件。"}
                  </p>
                </div>

                {intentResult?.needsClarification ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">
                      还需要补充的信息
                    </p>
                    <div className="mt-3 space-y-3">
                      {intentResult.clarificationQuestions.map((question) => (
                        <div key={question.id} className="rounded-2xl bg-white p-3">
                          <p className="font-semibold text-stone-950">
                            {question.question}
                          </p>
                          {question.options?.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {question.options.map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900"
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {intentResult.missingInformation.length > 0 ? (
                      <p className="mt-3 text-xs font-semibold text-amber-900">
                        Missing: {intentResult.missingInformation.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  null
                )}

                <div className="space-y-2">
                  {intentResult?.actionGraph.nodes.map((action) => (
                    <div
                      key={action.id}
                      className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-xl">
                          {action.icon || "✓"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-stone-950">
                            {action.title}
                          </h3>
                          <p className="mt-1 text-sm leading-6 text-stone-600">
                            {action.summary}
                          </p>
                          {visibleActionFacts(action).length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {visibleActionFacts(action).map((detail) => (
                                <span
                                  key={`${action.id}-${detail.key}-${detail.value}`}
                                  className="rounded-full bg-stone-50 px-2.5 py-1 text-xs font-bold text-stone-700"
                                >
                                  {detail.label}: {detail.value}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${
                            action.mandatoryMissing.length === 0
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {action.type === "hotel_stay"
                            ? "Add to Planner"
                            : action.intent === "expense"
                              ? "Record Expense"
                              : action.intent === "navigation"
                                ? "Open Map"
                                : action.intent === "assistant"
                                  ? "Assistant"
                                  : "Will Create"}
                        </span>
                      </div>
                    </div>
                  ))}
                  {intentResult?.actionGraph.relations.map((relation) => (
                    <div
                      key={`${relation.from}-${relation.type}-${relation.to}`}
                      className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
                    >
                      {relation.label}
                    </div>
                  ))}
                </div>

                {intentResult ? (
                  <div className="rounded-2xl border border-stone-200 bg-white p-3">
                    <button
                      type="button"
                      onClick={() => setIsDebugOpen((current) => !current)}
                      className="text-xs font-black uppercase tracking-[0.14em] text-stone-500"
                    >
                      {isDebugOpen ? "Hide Debug" : "Capture AI Debug"}
                    </button>
                    {isDebugOpen ? (
                      <div className="mt-3 rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-50">
                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <p className="font-bold uppercase tracking-[0.14em] text-stone-400">
                              Intent
                            </p>
                            <p className="mt-1">{intentResult.intent}</p>
                          </div>
                          <div>
                            <p className="font-bold uppercase tracking-[0.14em] text-stone-400">
                              Confidence
                            </p>
                            <p className="mt-1">
                              {Math.round(intentResult.confidence * 100)}%
                            </p>
                          </div>
                          <div>
                            <p className="font-bold uppercase tracking-[0.14em] text-stone-400">
                              Handler
                            </p>
                            <p className="mt-1">{intentResult.proposedAction.type}</p>
                          </div>
                        </div>
                        <p className="mt-4 font-bold uppercase tracking-[0.14em] text-stone-400">
                          Entities
                        </p>
                        <pre className="mt-2 overflow-x-auto">
                          {JSON.stringify(
                            {
                              entities: intentResult.entities,
                              actionGraph: intentResult.actionGraph,
                              missingInformation: intentResult.missingInformation,
                              clarificationQuestions:
                                intentResult.clarificationQuestions,
                              validation: intentResult.needsClarification
                                ? "Needs clarification"
                                : "Passed",
                              execution: intentResult.interactionLevel,
                              provider: intentResult.provider,
                              model: intentResult.model,
                            },
                            null,
                            2,
                          )}
                        </pre>
                        <p className="mt-3 font-bold uppercase tracking-[0.14em] text-stone-400">
                          Reason
                        </p>
                        <p className="mt-2 whitespace-pre-wrap">
                          {intentResult.reason}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={closeCapture}
                    disabled={isSubmitting}
                    className="rounded-full bg-stone-100 px-4 py-3 text-sm font-bold text-stone-700 disabled:text-stone-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhase("input")}
                    disabled={isSubmitting}
                    className="rounded-full bg-stone-100 px-4 py-3 text-sm font-bold text-stone-700 disabled:text-stone-300"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhase("input")}
                    disabled={isSubmitting}
                    className="rounded-full bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 disabled:text-stone-300"
                  >
                    Continue Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmCapture()}
                    disabled={isSubmitting || Boolean(intentResult?.needsClarification)}
                    className="ml-auto rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
                  >
                    {isSubmitting
                      ? "Saving..."
                      : intentResult?.needsClarification
                        ? "请先补充信息"
                        : confirmLabel}
                  </button>
                </div>
              </div>
            )}

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
