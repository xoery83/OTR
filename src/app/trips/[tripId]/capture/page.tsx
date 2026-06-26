"use client";

import { useParams } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { MemoryCard } from "@/components/MemoryCard";
import { getErrorMessage } from "@/lib/errors";
import { getDefaultCapturedAt } from "@/lib/format";
import { compressImageFile, type CompressedImage } from "@/lib/images";
import { createRawCaptureEvent } from "@/lib/supabase/capture-events";
import {
  requestVoiceTranscription,
} from "@/lib/supabase/media-assets";
import {
  createPhotoMemory,
  createTextMemory,
  getSignedMemoryImageUrls,
  getTripMemories,
} from "@/lib/supabase/memories";
import { getTrip } from "@/lib/supabase/trips";
import type { MemoryEntry, Trip } from "@/types";

function CaptureContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const voiceInputRef = useRef<HTMLInputElement | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [text, setText] = useState("");
  const [photoFileName, setPhotoFileName] = useState("");
  const [originalPhotoFile, setOriginalPhotoFile] = useState<File | null>(null);
  const [compressedImage, setCompressedImage] = useState<CompressedImage | null>(
    null,
  );
  const [voiceFileName, setVoiceFileName] = useState("");
  const [transcriptionModel, setTranscriptionModel] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPhotoPreparing, setIsPhotoPreparing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCapturePage() {
      try {
        const [tripData, memoryData] = await Promise.all([
          getTrip(tripId),
          getTripMemories(tripId),
        ]);
        const signedUrls = await getSignedMemoryImageUrls(memoryData);

        if (isMounted) {
          setTrip(tripData);
          setEntries(memoryData);
          setImageUrls(signedUrls);
        }
      } catch (captureError) {
        if (isMounted) {
          setError(
            captureError instanceof Error
              ? captureError.message
              : "Could not load capture page.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadCapturePage();

    return () => {
      isMounted = false;
    };
  }, [tripId]);

  useEffect(() => {
    return () => {
      if (compressedImage?.previewUrl) {
        URL.revokeObjectURL(compressedImage.previewUrl);
      }
    };
  }, [compressedImage]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
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
      setPhotoFileName("");
      setOriginalPhotoFile(null);
      setCompressedImage(null);
      setError(getErrorMessage(photoError, "Could not prepare this photo."));
    } finally {
      setIsPhotoPreparing(false);
      event.target.value = "";
    }
  }

  async function handleVoiceChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsTranscribing(true);
    setVoiceFileName(file.name);
    setTranscriptionModel(null);

    try {
      const result = await requestVoiceTranscription({ tripId, audio: file });
      setText((current) =>
        [current.trim(), result.transcript].filter(Boolean).join("\n"),
      );
      setTranscriptionModel(result.model);
    } catch (voiceError) {
      setVoiceFileName("");
      setError(getErrorMessage(voiceError, "Could not transcribe voice."));
    } finally {
      setIsTranscribing(false);
      event.target.value = "";
    }
  }

  async function submitCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();

    if (!trimmed && !compressedImage) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const created: MemoryEntry[] = [];
      const capturedAt = getDefaultCapturedAt();

      if (trimmed) {
        await createRawCaptureEvent({
          tripId,
          inputType: "text",
          originalInput: trimmed,
          capturedAt,
        });
        const memory = await createTextMemory(tripId, trimmed, {
          capturedAt,
          locationName: "",
        });
        created.push(memory);
      }

      if (compressedImage) {
        await createRawCaptureEvent({
          tripId,
          inputType: "photo",
          originalInput: trimmed || null,
          capturedAt,
          metadata: {
            fileName: photoFileName,
            compressedSize: compressedImage.blob.size,
            width: compressedImage.width,
            height: compressedImage.height,
          },
        });
        const memory = await createPhotoMemory(
          tripId,
          compressedImage,
          photoFileName,
          trimmed,
          {
            capturedAt,
            locationName: "",
          },
          trip?.photoStorageStatus === "connected" ? originalPhotoFile : null,
        );
        const signedUrls = await getSignedMemoryImageUrls([memory]);
        setImageUrls((current) => ({ ...current, ...signedUrls }));
        created.push(memory);
      }

      setEntries((current) => [...created.reverse(), ...current]);
      setText("");
      setPhotoFileName("");
      setOriginalPhotoFile(null);
      setCompressedImage(null);
      setVoiceFileName("");
      setTranscriptionModel(null);
    } catch (captureError) {
      setError(getErrorMessage(captureError, "Could not save capture."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading capture...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name || "Trip"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Capture
        </h1>
      </section>

      <form
        onSubmit={submitCapture}
        className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm"
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={7}
          placeholder="Describe what happened..."
          className="w-full resize-none rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 text-base leading-7 text-stone-950 placeholder:text-stone-500 outline-none focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
        />

        {compressedImage ? (
          <div className="mt-3 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={compressedImage.previewUrl}
              alt="Attachment preview"
              className="max-h-[340px] w-full object-cover"
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
        <input
          ref={voiceInputRef}
          type="file"
          accept="audio/*,.m4a,.mp3,.mp4,.mpeg,.mpga,.wav,.webm"
          onChange={handleVoiceChange}
          className="sr-only"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={isPhotoPreparing || isSubmitting}
            className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-800 disabled:text-stone-400"
          >
            {isPhotoPreparing ? "Preparing..." : "Attach"}
          </button>
          <button
            type="button"
            onClick={() => voiceInputRef.current?.click()}
            disabled={isTranscribing || isSubmitting}
            className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-800 disabled:text-stone-400"
          >
            {isTranscribing ? "Transcribing..." : "Voice"}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || isTranscribing || (!text.trim() && !compressedImage)}
            className="ml-auto rounded-full bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:bg-stone-300"
          >
            {isSubmitting ? "Saving..." : "Capture"}
          </button>
        </div>

        {voiceFileName || transcriptionModel ? (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900">
            {voiceFileName ? `Voice: ${voiceFileName}` : ""}
            {transcriptionModel ? ` · Transcribed by ${transcriptionModel}` : ""}
          </p>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </form>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-stone-950">
          Recent captures
        </h2>
        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
            No captures yet.
          </div>
        ) : (
          entries.slice(0, 5).map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              displayUrl={memory.mediaUrl ? imageUrls[memory.mediaUrl] : undefined}
            />
          ))
        )}
      </section>
    </div>
  );
}

export default function CapturePage() {
  return <AuthGate>{() => <CaptureContent />}</AuthGate>;
}
