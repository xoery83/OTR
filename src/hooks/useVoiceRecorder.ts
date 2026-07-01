"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UseVoiceRecorderOptions = {
  onRecordingComplete: (file: File) => void;
  onError: (error: Error) => void;
  onNoSpeech?: () => void;
  maxDurationMs?: number;
  silenceMs?: number;
  volumeThreshold?: number;
};

export function useVoiceRecorder({
  onRecordingComplete,
  onError,
  onNoSpeech,
  maxDurationMs = 60_000,
  silenceMs = 1400,
  volumeThreshold = 0.035,
}: UseVoiceRecorderOptions) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const maxRecordingTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const heardSpeechRef = useRef(false);
  const isStartingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const shouldStopAfterStartRef = useRef(false);
  const hasQueuedRecordingRef = useRef(false);
  const onRecordingCompleteRef = useRef(onRecordingComplete);
  const onErrorRef = useRef(onError);
  const onNoSpeechRef = useRef(onNoSpeech);
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    onRecordingCompleteRef.current = onRecordingComplete;
    onErrorRef.current = onError;
    onNoSpeechRef.current = onNoSpeech;
  }, [onRecordingComplete, onError, onNoSpeech]);

  const cleanup = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxRecordingTimerRef.current) {
      window.clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
    mediaRecorderRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    heardSpeechRef.current = false;
    isStartingRef.current = false;
    isStoppingRef.current = false;
    shouldStopAfterStartRef.current = false;
  }, []);

  const stop = useCallback(() => {
    if (isStoppingRef.current) return;

    if (isStartingRef.current && !mediaRecorderRef.current) {
      shouldStopAfterStartRef.current = true;
      setIsRecording(false);
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      isStoppingRef.current = true;
      recorder.stop();
      return;
    }

    cleanup();
    setIsRecording(false);
  }, [cleanup]);

  const startSilenceDetection = useCallback(
    (stream: MediaStream) => {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;

      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      const data = new Uint8Array(analyser.fftSize);
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = audioContext;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const volume = Math.sqrt(sum / data.length);

        if (volume > volumeThreshold) {
          heardSpeechRef.current = true;
          if (silenceTimerRef.current) {
            window.clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (heardSpeechRef.current && !silenceTimerRef.current) {
          silenceTimerRef.current = window.setTimeout(() => stop(), silenceMs);
        }

        animationFrameRef.current = window.requestAnimationFrame(tick);
      };

      tick();
    },
    [silenceMs, stop, volumeThreshold],
  );

  const start = useCallback(async () => {
    if (isStartingRef.current || isRecording) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onErrorRef.current(new Error("Voice recording is not supported in this browser."));
      return;
    }

    isStartingRef.current = true;
    shouldStopAfterStartRef.current = false;
    hasQueuedRecordingRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (shouldStopAfterStartRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        cleanup();
        setIsRecording(false);
        return;
      }

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined,
      });
      mediaRecorderRef.current = recorder;
      audioStreamRef.current = stream;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const heardSpeech = heardSpeechRef.current;
        cleanup();
        setIsRecording(false);

        if (!heardSpeech) {
          onNoSpeechRef.current?.();
          return;
        }

        if (blob.size > 0 && !hasQueuedRecordingRef.current) {
          hasQueuedRecordingRef.current = true;
          onRecordingCompleteRef.current(
            new File([blob], `capture-${Date.now()}.webm`, {
              type: blob.type || "audio/webm",
            }),
          );
        }
      };

      recorder.start();
      setIsRecording(true);
      isStartingRef.current = false;
      startSilenceDetection(stream);
      maxRecordingTimerRef.current = window.setTimeout(() => stop(), maxDurationMs);
    } catch (error) {
      cleanup();
      setIsRecording(false);
      onErrorRef.current(
        error instanceof Error ? error : new Error("Could not start recording."),
      );
    }
  }, [cleanup, isRecording, maxDurationMs, startSilenceDetection, stop]);

  useEffect(() => cleanup, [cleanup]);

  return {
    isRecording,
    start,
    stop,
  };
}
