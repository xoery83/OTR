"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { invalidateJourneyResource } from "@/hooks/useJourneyCachedResource";
import { getErrorMessage } from "@/lib/errors";
import { journeyResourceKey } from "@/lib/journey-resources";
import { getCurrentUser } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import {
  disconnectJourneyStorage,
  getJourneyStorageConnection,
} from "@/lib/supabase/storage-connections";
import {
  ensureJourneyExchangeRate,
  getJourneyExchangeRates,
  getLedgerData,
  refreshJourneyExchangeRatesOnce,
} from "@/lib/supabase/ledger";
import { deleteTrip, getTrip, updateTripSettings } from "@/lib/supabase/trips";
import type {
  JourneyExchangeRate,
  JourneyLedger,
  JourneyStorageConnection,
  JourneyMember,
  PhotoStorageProvider,
  Trip,
} from "@/types";

const storageProviders: {
  value: PhotoStorageProvider;
  label: string;
  descriptionKey:
    | "journeySettings.storage.google.description"
    | "journeySettings.storage.onedrive.description";
}[] = [
  {
    value: "google_drive",
    label: "Google Drive",
    descriptionKey: "journeySettings.storage.google.description",
  },
  {
    value: "onedrive",
    label: "Microsoft OneDrive",
    descriptionKey: "journeySettings.storage.onedrive.description",
  },
];

function SettingsDisclosure({
  title,
  description,
  toggleOpenLabel,
  toggleCloseLabel,
  aside,
  tone = "default",
  children,
}: {
  title: string;
  description: string;
  toggleOpenLabel: string;
  toggleCloseLabel: string;
  aside?: ReactNode;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const isDanger = tone === "danger";

  return (
    <details
      className={`group rounded-3xl p-5 shadow-sm ${
        isDanger ? "border border-red-200 bg-red-50" : "bg-white"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            className={`text-xl font-semibold ${
              isDanger ? "text-red-900" : "text-stone-950"
            }`}
          >
            {title}
          </h2>
          <p
            className={`mt-1 text-sm leading-6 ${
              isDanger ? "text-red-800" : "text-stone-600"
            }`}
          >
            {description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {aside}
          <span
            className={`rounded-full px-3 py-2 text-xs font-bold ${
              isDanger
                ? "bg-red-100 text-red-800"
                : "bg-stone-100 text-stone-600"
            } group-open:hidden`}
          >
            {toggleOpenLabel}
          </span>
          <span
            className={`hidden rounded-full px-3 py-2 text-xs font-bold ${
              isDanger
                ? "bg-red-100 text-red-800"
                : "bg-stone-100 text-stone-600"
            } group-open:inline-flex`}
          >
            {toggleCloseLabel}
          </span>
        </div>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}

function SettingsContent() {
  const { t } = useI18n();
  const params = useParams<{ tripId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [storageConnection, setStorageConnection] =
    useState<JourneyStorageConnection | null>(null);
  const [ledger, setLedger] = useState<JourneyLedger | null>(null);
  const [exchangeRates, setExchangeRates] = useState<JourneyExchangeRate[]>([]);
  const [journeyName, setJourneyName] = useState("");
  const [journeyStartDate, setJourneyStartDate] = useState("");
  const [journeyEndDate, setJourneyEndDate] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [storageProvider, setStorageProvider] =
    useState<PhotoStorageProvider | "">("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingDates, setIsSavingDates] = useState(false);
  const [isSavingCover, setIsSavingCover] = useState(false);
  const [isSavingStorage, setIsSavingStorage] = useState(false);
  const [isConnectingStorage, setIsConnectingStorage] = useState(false);
  const [isDisconnectingStorage, setIsDisconnectingStorage] = useState(false);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      try {
        const [tripData, memberData, user, connectionData, ledgerData] =
          await Promise.all([
          getTrip(tripId),
          getJourneyMembers(tripId),
          getCurrentUser(),
          getJourneyStorageConnection(tripId, "google_drive").catch(() => null),
          getLedgerData(tripId),
        ]);
        const usedCurrencies = [
          ...new Set([
            ledgerData.ledger.baseCurrency,
            ...ledgerData.entries.map((entry) => entry.originalCurrency),
          ]),
        ];
        await Promise.allSettled(
          usedCurrencies.map((currency) =>
            ensureJourneyExchangeRate(
              tripId,
              currency,
              ledgerData.ledger.baseCurrency,
            ),
          ),
        );
        const rates = await getJourneyExchangeRates(tripId);
        if (!isMounted) return;
        setTrip(tripData);
        setMembers(memberData);
        setCurrentUserId(user?.id ?? null);
        setStorageConnection(connectionData);
        setLedger(ledgerData.ledger);
        setExchangeRates(rates);
        setJourneyName(tripData.name);
        setJourneyStartDate(tripData.startDate ?? "");
        setJourneyEndDate(tripData.endDate ?? "");
        setCoverImageUrl(tripData.coverImageUrl ?? "");
        setStorageProvider(
          tripData.photoStorageProvider === "google_drive" ||
            tripData.photoStorageProvider === "onedrive"
            ? tripData.photoStorageProvider
            : "",
        );
        if (searchParams.get("drive") === "connected") {
          setNotice(t("journeySettings.storage.connected"));
        }
        const driveError = searchParams.get("drive_error");
        if (driveError) {
          setError(driveError);
        }
      } catch (settingsError) {
        if (isMounted) {
          setError(getErrorMessage(settingsError, t("journeySettings.error.load")));
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

  const currentMember = members.find((member) => member.userId === currentUserId);
  const canManageJourney =
    currentMember?.role === "owner" || trip?.createdBy === currentUserId;

  async function saveJourneyName() {
    const nextName = journeyName.trim();
    if (!nextName || !canManageJourney) return;

    if (nextName === (trip?.name ?? "")) {
      setError(null);
      setNotice(t("journeySettings.nameUnchanged"));
      return;
    }

    setIsSavingName(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateTripSettings({
        tripId,
        name: nextName,
      });
      setTrip(updated);
      setJourneyName(updated.name);
      setNotice(t("journeySettings.nameSaved"));
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("journeySettings.nameSaveError")));
    } finally {
      setIsSavingName(false);
    }
  }

  async function saveJourneyDates() {
    if (!canManageJourney) return;

    const nextStartDate = journeyStartDate || null;
    const nextEndDate = journeyEndDate || null;

    if (nextStartDate && nextEndDate && nextEndDate < nextStartDate) {
      setNotice(null);
      setError(t("journeySettings.datesInvalid"));
      return;
    }

    if (
      nextStartDate === (trip?.startDate ?? null) &&
      nextEndDate === (trip?.endDate ?? null)
    ) {
      setError(null);
      setNotice(t("journeySettings.datesUnchanged"));
      return;
    }

    setIsSavingDates(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateTripSettings({
        tripId,
        startDate: nextStartDate,
        endDate: nextEndDate,
      });
      setTrip(updated);
      setJourneyStartDate(updated.startDate ?? "");
      setJourneyEndDate(updated.endDate ?? "");
      invalidateJourneyResource(journeyResourceKey.trip(tripId));
      invalidateJourneyResource(journeyResourceKey.trips());
      invalidateJourneyResource(journeyResourceKey.tripsBase());
      invalidateJourneyResource(journeyResourceKey.planner(tripId));
      invalidateJourneyResource(journeyResourceKey.map(tripId));
      setNotice(t("journeySettings.datesSaved"));
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("journeySettings.datesSaveError")));
    } finally {
      setIsSavingDates(false);
    }
  }

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
      setNotice(t("journeySettings.coverSaved"));
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("journeySettings.coverSaveError")));
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
      setNotice(t("journeySettings.storageSaved"));
    } catch (saveError) {
      setError(
        getErrorMessage(
          saveError,
          t("journeySettings.storageSaveError"),
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
        throw new Error(t("journeySettings.storage.connectLogin"));
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
        throw new Error(payload.error || t("journeySettings.storage.connectError"));
      }

      window.location.href = payload.authUrl;
    } catch (connectError) {
      setIsConnectingStorage(false);
      setError(
        getErrorMessage(connectError, t("journeySettings.storage.connectError")),
      );
    }
  }

  async function disconnectGoogleDrive() {
    if (!window.confirm(t("journeySettings.storage.disconnectConfirm"))) {
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
      setNotice(t("journeySettings.storage.disconnected"));
    } catch (disconnectError) {
      setError(getErrorMessage(disconnectError, t("journeySettings.storage.disconnectError")));
    } finally {
      setIsDisconnectingStorage(false);
    }
  }

  async function refreshExchangeRates() {
    if (!canManageJourney || !ledger || ledger.exchangeRatesRefreshCount > 0) {
      return;
    }

    setIsRefreshingRates(true);
    setError(null);
    setNotice(null);
    try {
      const result = await refreshJourneyExchangeRatesOnce(tripId);
      setLedger(result.ledger);
      setExchangeRates(await getJourneyExchangeRates(tripId));
      setNotice(t("journeySettings.exchangeRefreshed"));
    } catch (refreshError) {
      setError(getErrorMessage(refreshError, t("journeySettings.exchangeRefreshError")));
    } finally {
      setIsRefreshingRates(false);
    }
  }

  async function handleDeleteJourney() {
    if (!trip || !canManageJourney) return;

    if (deleteConfirmation !== trip.name) {
      setError(t("journeySettings.deleteNameError"));
      setNotice(null);
      return;
    }

    setIsDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await deleteTrip(trip.id);
      invalidateJourneyResource(journeyResourceKey.trips());
      invalidateJourneyResource(journeyResourceKey.tripsBase());
      router.replace("/trips");
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t("journeySettings.deleteError")));
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white p-5">
        {t("journeySettings.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold text-stone-950">
          {t("journeySettings.title")}
        </h1>
        <p className="text-base leading-7 text-stone-600">
          {t("journeySettings.description")}
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

      {canManageJourney ? (
        <SettingsDisclosure
          title={t("journeySettings.nameTitle")}
          description={t("journeySettings.nameDescription")}
          toggleOpenLabel={t("journeySettings.section.open")}
          toggleCloseLabel={t("journeySettings.section.close")}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={journeyName}
              onChange={(event) => setJourneyName(event.target.value)}
              placeholder={t("journeySettings.namePlaceholder")}
              className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-600"
            />
            <button
              type="button"
              onClick={saveJourneyName}
              disabled={isSavingName || !journeyName.trim()}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isSavingName
                ? t("common.saving")
                : t("journeySettings.saveName")}
            </button>
          </div>
        </SettingsDisclosure>
      ) : null}

      {canManageJourney ? (
        <SettingsDisclosure
          title={t("journeySettings.datesTitle")}
          description={t("journeySettings.datesDescription")}
          toggleOpenLabel={t("journeySettings.section.open")}
          toggleCloseLabel={t("journeySettings.section.close")}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-black uppercase tracking-wide text-stone-500">
                {t("journeySettings.startDate")}
              </span>
              <input
                type="date"
                value={journeyStartDate}
                onChange={(event) => setJourneyStartDate(event.target.value)}
                className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-600"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-black uppercase tracking-wide text-stone-500">
                {t("journeySettings.endDate")}
              </span>
              <input
                type="date"
                value={journeyEndDate}
                min={journeyStartDate || undefined}
                onChange={(event) => setJourneyEndDate(event.target.value)}
                className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-950 outline-none focus:border-emerald-600"
              />
            </label>
          </div>
          <p className="mt-3 rounded-2xl bg-stone-50 p-3 text-sm leading-6 text-stone-600">
            {t("journeySettings.datesNote")}
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={saveJourneyDates}
              disabled={isSavingDates}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isSavingDates
                ? t("common.saving")
                : t("journeySettings.saveDates")}
            </button>
          </div>
        </SettingsDisclosure>
      ) : null}

      {canManageJourney ? (
        <SettingsDisclosure
          title={t("journeySettings.coverTitle")}
          description={t("journeySettings.coverDescription")}
          toggleOpenLabel={t("journeySettings.section.open")}
          toggleCloseLabel={t("journeySettings.section.close")}
        >
          <div className="overflow-hidden rounded-2xl border border-stone-100 bg-stone-100">
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
          </div>
          <div className="mt-4 space-y-4">
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
              {isSavingCover
                ? t("common.saving")
                : t("journeySettings.saveCover")}
            </button>
          </div>
        </SettingsDisclosure>
      ) : null}

      <SettingsDisclosure
        title={t("journeySettings.storageTitle")}
        description={t("journeySettings.storageDescription")}
        toggleOpenLabel={t("journeySettings.section.open")}
        toggleCloseLabel={t("journeySettings.section.close")}
        aside={
          <span className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600">
            {trip?.photoStorageStatus === "connected"
              ? t("journeySettings.storage.status.connected")
              : t("journeySettings.storage.status.notConnected")}
          </span>
        }
      >
        <div className="mb-5 rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">
            Google Drive{" "}
            {trip?.photoStorageStatus === "connected" ? "Connected" : "Not Connected"}
          </p>
          <p className="mt-2 text-base font-bold text-stone-950">
            Current image storage: Google Drive
          </p>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Your photos are stored in your own Google Drive. OTR only stores metadata.
          </p>
        </div>

        <div className="grid gap-3">
          {storageProviders.map((provider) => {
            const selected = storageProvider === provider.value;
            return (
              <button
                key={provider.value}
                type="button"
                onClick={() => {
                  if (canManageJourney) setStorageProvider(provider.value);
                }}
                disabled={!canManageJourney}
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
                  {t(provider.descriptionKey)}
                </span>
              </button>
            );
          })}
        </div>

        {storageConnection?.status === "connected" ? (
          <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
              {t("journeySettings.storage.connectedAccount")}
            </p>
            <p className="mt-2 text-base font-semibold text-stone-950">
              {storageConnection.accountLabel || "Google Drive"}
            </p>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              {t("journeySettings.storage.folder")}{" "}
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
                  {t("journeySettings.storage.openFolder")}
                </a>
              ) : null}
              {canManageJourney ? (
                <button
                  type="button"
                  onClick={disconnectGoogleDrive}
                  disabled={isDisconnectingStorage}
                  className="rounded-2xl bg-stone-100 px-5 py-3 text-sm font-bold text-stone-700 disabled:cursor-not-allowed disabled:text-stone-400"
                >
                  {isDisconnectingStorage
                    ? t("journeySettings.storage.disconnecting")
                    : t("journeySettings.storage.disconnect")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {canManageJourney ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={saveStoragePreference}
              disabled={isSavingStorage}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isSavingStorage
                ? t("journeySettings.storageSaving")
                : t("journeySettings.storageSave")}
            </button>
            {storageProvider === "google_drive" ? (
              <button
                type="button"
                onClick={startGoogleDriveConnection}
                disabled={isConnectingStorage}
                className="rounded-2xl bg-stone-950 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                {isConnectingStorage
                  ? t("journeySettings.storage.connecting")
                  : storageConnection?.status === "connected"
                    ? t("journeySettings.storage.reconnect")
                    : t("journeySettings.storage.connect")}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="rounded-2xl bg-stone-100 px-5 py-3 text-sm font-bold text-stone-400"
              >
                {t("journeySettings.storage.onedriveSoon")}
              </button>
            )}
          </div>
        ) : (
          <p className="mt-5 rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-600">
            {t("journeySettings.storage.ownerOnly")}
          </p>
        )}

        <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {t("journeySettings.storage.nextStep")}
        </p>
      </SettingsDisclosure>

      <SettingsDisclosure
        title={t("journeySettings.exchangeTitle")}
        description={t("journeySettings.exchangeDescription", {
          baseCurrency: ledger?.baseCurrency ?? "base",
        })}
        toggleOpenLabel={t("journeySettings.section.open")}
        toggleCloseLabel={t("journeySettings.section.close")}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold text-stone-500">
              {t("journeySettings.exchangeSnapshot")}{" "}
              {ledger?.exchangeRatesSnapshotDate ?? "-"} ·{" "}
              {ledger?.exchangeRatesSnapshotSource ?? "default_at_creation"}
            </p>
          </div>
          {canManageJourney ? (
            <button
              type="button"
              onClick={refreshExchangeRates}
              disabled={
                isRefreshingRates || (ledger?.exchangeRatesRefreshCount ?? 0) > 0
              }
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isRefreshingRates
                ? t("journeySettings.exchangeRefreshing")
                : (ledger?.exchangeRatesRefreshCount ?? 0) > 0
                  ? t("journeySettings.exchangeRefreshUsed")
                  : t("journeySettings.exchangeRefresh")}
            </button>
          ) : null}
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-stone-100">
          {exchangeRates.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">
              {t("journeySettings.exchangeEmpty")}
            </p>
          ) : (
            exchangeRates.map((rate) => (
              <div
                key={rate.id}
                className="grid grid-cols-[1fr_auto] gap-3 border-b border-stone-100 px-4 py-3 last:border-b-0"
              >
                <div>
                  <p className="text-sm font-black text-stone-950">
                    1 {rate.quoteCurrency} = {rate.rateToBase.toFixed(4)}{" "}
                    {rate.baseCurrency}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {rate.rateDate} · {rate.source}
                  </p>
                </div>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
                  {rate.quoteCurrency}
                </span>
              </div>
            ))
          )}
        </div>
      </SettingsDisclosure>

      {canManageJourney ? (
        <SettingsDisclosure
          title={t("journeySettings.deleteTitle")}
          description={t("journeySettings.deleteDescription")}
          toggleOpenLabel={t("journeySettings.section.open")}
          toggleCloseLabel={t("journeySettings.section.close")}
          tone="danger"
        >
          <label
            htmlFor="delete-journey-confirm"
            className="block text-sm font-bold text-red-900"
          >
            {t("journeySettings.deleteConfirmLabel", {
              name: trip?.name ?? "",
            })}
          </label>
          <input
            id="delete-journey-confirm"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            className="mt-3 w-full rounded-2xl border border-red-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
          />
          <button
            type="button"
            onClick={handleDeleteJourney}
            disabled={isDeleting || deleteConfirmation !== trip?.name}
            className="mt-4 w-full rounded-2xl bg-red-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-red-200 disabled:text-red-500"
          >
            {isDeleting
              ? t("journeySettings.deleting")
              : t("journeySettings.deleteButton")}
          </button>
        </SettingsDisclosure>
      ) : null}

      <Link
        href={`/trips/${tripId}/capture2`}
        className="block rounded-3xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50"
      >
        <p className="text-sm font-semibold text-emerald-700">
          {t("journeySettings.captureReviewEyebrow")}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-stone-950">
          {t("journeySettings.captureReviewTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {t("journeySettings.captureReviewDescription")}
        </p>
      </Link>

      <Link
        href={`/trips/${tripId}/planner`}
        className="block rounded-2xl bg-emerald-50 px-5 py-3 text-center text-sm font-bold text-emerald-900"
      >
        {t("journeySettings.backToPlanner")}
      </Link>
    </div>
  );
}

export default function JourneySettingsPage() {
  return <AuthGate>{() => <SettingsContent />}</AuthGate>;
}
