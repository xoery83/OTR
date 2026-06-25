"use client";

import { useParams } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { MemoryCard } from "@/components/MemoryCard";
import { getErrorMessage } from "@/lib/errors";
import { getDefaultCapturedAt } from "@/lib/format";
import { compressImageFile, type CompressedImage } from "@/lib/images";
import {
  createPhotoMemory,
  createTextMemory,
  getTripMemories,
  getSignedMemoryImageUrls,
} from "@/lib/supabase/memories";
import { getTrip } from "@/lib/supabase/trips";
import type { MemoryEntry, Trip } from "@/types";

function getInitialCapturedAt() {
  if (typeof window === "undefined") {
    return getDefaultCapturedAt();
  }

  const date = new URLSearchParams(window.location.search).get("date");
  return getDefaultCapturedAt(date);
}

function CaptureContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [content, setContent] = useState("");
  const [textCapturedAt, setTextCapturedAt] = useState(getInitialCapturedAt);
  const [textLocationName, setTextLocationName] = useState("");
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoCapturedAt, setPhotoCapturedAt] = useState(getInitialCapturedAt);
  const [photoLocationName, setPhotoLocationName] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [selectedOriginalFile, setSelectedOriginalFile] = useState<File | null>(
    null,
  );
  const [compressedImage, setCompressedImage] = useState<CompressedImage | null>(
    null,
  );
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPhotoPreparing, setIsPhotoPreparing] = useState(false);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
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

  async function addTextNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();

    if (!trimmed) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const memory = await createTextMemory(tripId, trimmed, {
        capturedAt: textCapturedAt,
        locationName: textLocationName,
      });
      setEntries((current) => [memory, ...current]);
      setContent("");
      setTextLocationName("");
    } catch (memoryError) {
      setError(getErrorMessage(memoryError, "Could not save memory."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setError(null);
    setIsPhotoPreparing(true);

    try {
      const compressed = await compressImageFile(file);

      if (compressedImage?.previewUrl) {
        URL.revokeObjectURL(compressedImage.previewUrl);
      }

      setSelectedFileName(file.name);
      setSelectedOriginalFile(file);
      setCompressedImage(compressed);
    } catch (photoError) {
      setSelectedFileName("");
      setSelectedOriginalFile(null);
      setCompressedImage(null);
      setError(getErrorMessage(photoError, "Could not prepare this photo."));
    } finally {
      setIsPhotoPreparing(false);
      event.target.value = "";
    }
  }

  async function uploadPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!compressedImage) {
      setError("Choose a photo first.");
      return;
    }

    setError(null);
    setIsPhotoUploading(true);

    try {
      const memory = await createPhotoMemory(
        tripId,
        compressedImage,
        selectedFileName,
        photoCaption,
        {
          capturedAt: photoCapturedAt,
          locationName: photoLocationName,
        },
        trip?.photoStorageStatus === "connected" ? selectedOriginalFile : null,
      );
      const signedUrls = await getSignedMemoryImageUrls([memory]);
      setEntries((current) => [memory, ...current]);
      setImageUrls((current) => ({
        ...current,
        ...signedUrls,
      }));
      setPhotoCaption("");
      setPhotoLocationName("");
      setSelectedFileName("");
      setSelectedOriginalFile(null);
      setCompressedImage(null);
    } catch (photoError) {
      setError(getErrorMessage(photoError, "Could not upload photo."));
    } finally {
      setIsPhotoUploading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading capture page...
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
          Add memory
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Add a text note or photo. Compressed images power the timeline; if
          Google Drive is connected, originals are saved there.
        </p>
      </section>

      <form
        onSubmit={addTextNote}
        className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
      >
        <label
          htmlFor="memory-content"
          className="text-sm font-bold text-stone-800"
        >
          What happened?
        </label>
        <textarea
          id="memory-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={6}
          placeholder="Write the tiny detail you do not want the group to forget."
          className="mt-3 w-full resize-none rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 text-base leading-7 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="text-captured-at"
              className="text-sm font-bold text-stone-800"
            >
              When did this happen?
            </label>
            <input
              id="text-captured-at"
              type="datetime-local"
              value={textCapturedAt}
              onChange={(event) => setTextCapturedAt(event.target.value)}
              required
              className="mt-3 w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <div>
            <label
              htmlFor="text-location"
              className="text-sm font-bold text-stone-800"
            >
              Where was this?
            </label>
            <input
              id="text-location"
              value={textLocationName}
              onChange={(event) => setTextLocationName(event.target.value)}
              placeholder="Blue Lagoon"
              className="mt-3 w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="submit"
            className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            disabled={isSubmitting || !content.trim()}
          >
            Add text note
          </button>
          <a
            href="#photo-upload"
            className="rounded-2xl bg-emerald-100 px-4 py-3 text-center text-sm font-bold text-emerald-900"
          >
            Upload compressed photo
          </a>
          <button
            type="button"
            disabled
            className="rounded-2xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-500"
          >
            Record voice placeholder
          </button>
          <button
            type="button"
            disabled
            className="rounded-2xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-500"
          >
            Add location placeholder
          </button>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </form>

      <form
        id="photo-upload"
        onSubmit={uploadPhoto}
        className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Photo memory
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Images are compressed to JPEG for fast display. Connected journeys
              also preserve the original in Google Drive.
            </p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
            4A
          </span>
        </div>

        <label
          htmlFor="photo-file"
          className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-[#fffdf8] px-4 py-8 text-center transition hover:border-emerald-400 hover:bg-emerald-50"
        >
          <span className="text-sm font-bold text-stone-900">
            Choose photo
          </span>
          <span className="mt-1 text-xs text-stone-600">
            JPEG, PNG, HEIC if supported by your browser. Max 20MB.
          </span>
        </label>
        <input
          id="photo-file"
          type="file"
          accept="image/*"
          onChange={handlePhotoChange}
          className="sr-only"
        />

        {isPhotoPreparing ? (
          <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            Compressing photo...
          </p>
        ) : null}

        {compressedImage ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={compressedImage.previewUrl}
              alt="Compressed preview"
              className="h-auto max-h-[420px] w-full object-cover"
            />
            <div className="grid gap-2 border-t border-stone-200 bg-white p-4 text-sm text-stone-600 sm:grid-cols-3">
              <span>{compressedImage.width} x {compressedImage.height}</span>
              <span>{Math.round(compressedImage.blob.size / 1024)} KB</span>
              <span>
                {trip?.photoStorageStatus === "connected"
                  ? "Original goes to Drive"
                  : "JPEG compressed"}
              </span>
            </div>
          </div>
        ) : null}

        <label
          htmlFor="photo-caption"
          className="mt-4 block text-sm font-bold text-stone-800"
        >
          Caption
        </label>
        <textarea
          id="photo-caption"
          value={photoCaption}
          onChange={(event) => setPhotoCaption(event.target.value)}
          rows={3}
          placeholder="Optional caption for this photo."
          className="mt-3 w-full resize-none rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 text-base leading-7 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="photo-captured-at"
              className="text-sm font-bold text-stone-800"
            >
              When did this happen?
            </label>
            <input
              id="photo-captured-at"
              type="datetime-local"
              value={photoCapturedAt}
              onChange={(event) => setPhotoCapturedAt(event.target.value)}
              required
              className="mt-3 w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <div>
            <label
              htmlFor="photo-location"
              className="text-sm font-bold text-stone-800"
            >
              Where was this?
            </label>
            <input
              id="photo-location"
              value={photoLocationName}
              onChange={(event) => setPhotoLocationName(event.target.value)}
              placeholder="Road to Vik"
              className="mt-3 w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!compressedImage || isPhotoPreparing || isPhotoUploading}
          className="mt-4 w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {isPhotoUploading ? "Uploading photo..." : "Upload photo"}
        </button>
      </form>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-stone-950">
          Recent memories
        </h2>
        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-5 text-sm leading-6 text-stone-600">
            No memories yet. Add a text note to start the timeline.
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
