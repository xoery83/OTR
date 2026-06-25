"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase/client";
import {
  disconnectJourneyStorage,
  getJourneyStorageConnection,
} from "@/lib/supabase/storage-connections";
import { getTrip, updateTripSettings } from "@/lib/supabase/trips";
import type {
  JourneyStorageConnection,
  PhotoStorageProvider,
  Trip,
} from "@/types";

const storageProviders: {
  value: PhotoStorageProvider;
  label: string;
  description: string;
}[] = [
  {
    value: "google_drive",
    label: "Google Drive",
    description: "Original photos stay in the journey owner's Google Drive.",
  },
  {
    value: "onedrive",
    label: "Microsoft OneDrive",
    description: "Original photos stay in the journey owner's OneDrive.",
  },
];

function SettingsContent() {
  const params = useParams<{ tripId: string }>();
  const searchParams = useSearchParams();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [storageConnection, setStorageConnection] =
    useState<JourneyStorageConnection | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [storageProvider, setStorageProvider] =
    useState<PhotoStorageProvider | "">("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingCover, setIsSavingCover] = useState(false);
  const [isSavingStorage, setIsSavingStorage] = useState(false);
  const [isConnectingStorage, setIsConnectingStorage] = useState(false);
  const [isDisconnectingStorage, setIsDisconnectingStorage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const [tripData, connectionData] = await Promise.all([
          getTrip(tripId),
          getJourneyStorageConnection(tripId, "google_drive").catch(() => null),
        ]);
        if (!isMounted) return;
        setTrip(tripData);
        setStorageConnection(connectionData);
        setCoverImageUrl(tripData.coverImageUrl ?? "");
        setStorageProvider(
          tripData.photoStorageProvider === "google_drive" ||
            tripData.photoStorageProvider === "onedrive"
            ? tripData.photoStorageProvider
            : "",
        );
        if (searchParams.get("drive") === "connected") {
          setNotice("Google Drive connected. Journey folders are ready.");
        }
        const driveError = searchParams.get("drive_error");
        if (driveError) {
          setError(driveError);
        }
      } catch (settingsError) {
        if (isMounted) {
          setError(getErrorMessage(settingsError, "Could not load settings."));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadSettings();
    return () => {
      isMounted = false;
    };
  }, [searchParams, tripId]);

  async function saveCover() {
    setIsSavingCover(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateTripSettings({
        tripId,
        coverImageUrl: coverImageUrl.trim() || null,
      });
      setTrip(updated);
      setNotice("Cover image saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save cover image."));
    } finally {
      setIsSavingCover(false);
    }
  }

  async function saveStoragePreference() {
    setIsSavingStorage(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateTripSettings({
        tripId,
        photoStorageProvider: storageProvider || null,
      });
      setTrip(updated);
      setNotice("Storage preference saved. OAuth connection comes next.");
    } catch (saveError) {
      setError(
        getErrorMessage(
          saveError,
          "Could not save storage preference. Run the latest storage migrations first.",
        ),
      );
    } finally {
      setIsSavingStorage(false);
    }
  }

  async function startGoogleDriveConnection() {
    setError(null);
    setNotice(null);
    setIsConnectingStorage(true);

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (!accessToken) {
        throw new Error("You must be logged in to connect Google Drive.");
      }

      const response = await fetch("/api/google-drive/connect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tripId }),
      });
      const payload = (await response.json()) as {
        authUrl?: string;
        error?: string;
      };

      if (!response.ok || !payload.authUrl) {
        throw new Error(payload.error || "Could not start Google Drive connection.");
      }

      window.location.href = payload.authUrl;
    } catch (connectError) {
      setIsConnectingStorage(false);
      setError(
        getErrorMessage(connectError, "Could not start Google Drive connection."),
      );
    }
  }

  async function disconnectGoogleDrive() {
    if (!window.confirm("Disconnect Google Drive from this journey?")) {
      return;
    }

    setError(null);
    setNotice(null);
    setIsDisconnectingStorage(true);

    try {
      await disconnectJourneyStorage(tripId, "google_drive");
      const [updatedTrip, connectionData] = await Promise.all([
        getTrip(tripId),
        getJourneyStorageConnection(tripId, "google_drive"),
      ]);
      setTrip(updatedTrip);
      setStorageConnection(connectionData);
      setNotice(
        "Google Drive disconnected from OTR. Existing Drive folders were not deleted.",
      );
    } catch (disconnectError) {
      setError(getErrorMessage(disconnectError, "Could not disconnect storage."));
    } finally {
      setIsDisconnectingStorage(false);
    }
  }

  if (isLoading) {
    return <div className="rounded-2xl bg-white p-5">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-semibold text-emerald-700">
          Journey Settings
        </p>
        <h1 className="text-3xl font-semibold text-stone-950">
          {trip?.name || "Journey"}
        </h1>
        <p className="text-base leading-7 text-stone-600">
          Manage the cover image, photo storage direction, and core journey
          configuration.
        </p>
      </section>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
          {notice}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-3xl bg-white shadow-sm">
        <div
          className="h-48 bg-cover bg-center"
          style={{
            backgroundImage: `url(${
              coverImageUrl ||
              trip?.coverImageUrl ||
              "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80"
            })`,
          }}
        />
        <div className="space-y-4 p-5">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">Cover image</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Use an image URL for now. Uploading and choosing from journey
              photos can come later.
            </p>
          </div>
          <input
            value={coverImageUrl}
            onChange={(event) => setCoverImageUrl(event.target.value)}
            placeholder="https://..."
            className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-600"
          />
          <button
            type="button"
            onClick={saveCover}
            disabled={isSavingCover}
            className="w-full rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {isSavingCover ? "Saving..." : "Save cover"}
          </button>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Photo storage
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Journey will index photos, while original files stay in the
              selected cloud provider.
            </p>
          </div>
          <span className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600">
            {trip?.photoStorageStatus ?? "not_connected"}
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {storageProviders.map((provider) => {
            const selected = storageProvider === provider.value;
            return (
              <button
                key={provider.value}
                type="button"
                onClick={() => setStorageProvider(provider.value)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-emerald-600 bg-emerald-50"
                    : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <span className="text-base font-bold text-stone-950">
                  {provider.label}
                </span>
                <span className="mt-1 block text-sm leading-6 text-stone-600">
                  {provider.description}
                </span>
              </button>
            );
          })}
        </div>

        {storageConnection?.status === "connected" ? (
          <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
              Connected account
            </p>
            <p className="mt-2 text-base font-semibold text-stone-950">
              {storageConnection.accountLabel || "Google Drive"}
            </p>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Folder:{" "}
              {typeof storageConnection.metadata.journeyFolderName === "string"
                ? storageConnection.metadata.journeyFolderName
                : trip?.name || "Journey"}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {typeof storageConnection.metadata.journeyFolderUrl === "string" ? (
                <a
                  href={storageConnection.metadata.journeyFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl bg-emerald-700 px-5 py-3 text-center text-sm font-bold text-white"
                >
                  Open Journey Folder
                </a>
              ) : null}
              <button
                type="button"
                onClick={disconnectGoogleDrive}
                disabled={isDisconnectingStorage}
                className="rounded-2xl bg-stone-100 px-5 py-3 text-sm font-bold text-stone-700 disabled:cursor-not-allowed disabled:text-stone-400"
              >
                {isDisconnectingStorage ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={saveStoragePreference}
            disabled={isSavingStorage}
            className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {isSavingStorage ? "Saving..." : "Save storage preference"}
          </button>
          {storageProvider === "google_drive" ? (
            <button
              type="button"
              onClick={startGoogleDriveConnection}
              disabled={isConnectingStorage}
              className="rounded-2xl bg-stone-950 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isConnectingStorage
                ? "Connecting..."
                : storageConnection?.status === "connected"
                  ? "Reconnect Google Drive"
                  : "Connect Google Drive"}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="rounded-2xl bg-stone-100 px-5 py-3 text-sm font-bold text-stone-400"
            >
              OneDrive soon
            </button>
          )}
        </div>

        <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          Current photo upload still uses Capture and the existing compressed
          image flow. Google Drive connection creates folders now; original-photo
          streaming comes next.
        </p>
      </section>

      <Link
        href={`/trips/${tripId}`}
        className="block rounded-2xl bg-emerald-50 px-5 py-3 text-center text-sm font-bold text-emerald-900"
      >
        Back to journey
      </Link>
    </div>
  );
}

export default function JourneySettingsPage() {
  return <AuthGate>{() => <SettingsContent />}</AuthGate>;
}
