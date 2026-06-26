"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { getErrorMessage } from "@/lib/errors";
import {
  canShareJourneyLiveLocation,
  getOwnLiveLocation,
  setLiveLocationEnabled,
  upsertLiveLocation,
} from "@/lib/supabase/map";
import type { JourneyLiveLocation } from "@/types";

type LiveLocationToggleProps = {
  tripId: string;
  compact?: boolean;
  onLocationSaved?: (location: JourneyLiveLocation) => void;
  className?: string;
};

const saveIntervalMs = 30_000;

function geolocationErrorMessage(
  error: GeolocationPositionError,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (error.code === error.PERMISSION_DENIED) return t("map.locationDenied");
  if (error.code === error.POSITION_UNAVAILABLE) {
    return t("map.locationUnavailable");
  }
  if (error.code === error.TIMEOUT) return t("map.locationTimeout");
  return error.message || t("map.permissionError");
}

export function LiveLocationToggle({
  tripId,
  compact = false,
  onLocationSaved,
  className = "",
}: LiveLocationToggleProps) {
  const { t } = useI18n();
  const [isEnabled, setIsEnabled] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSavedAtRef = useRef(0);

  useEffect(() => {
    let isMounted = true;

    async function loadOwnLiveLocation() {
      try {
        const eligible = await canShareJourneyLiveLocation(tripId);
        if (!isMounted) return;
        setCanShare(eligible);
        if (!eligible) {
          setIsEnabled(false);
          return;
        }

        const location = await getOwnLiveLocation(tripId);
        if (!isMounted) return;
        setIsEnabled(Boolean(location?.isLiveEnabled));
        if (location) onLocationSaved?.(location);
      } catch (liveError) {
        if (isMounted) {
          setError(getErrorMessage(liveError, t("map.permissionError")));
        }
      }
    }

    loadOwnLiveLocation();
    return () => {
      isMounted = false;
      if (watchIdRef.current !== null) {
        window.navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [onLocationSaved, t, tripId]);

  async function savePosition(position: GeolocationPosition, force = false) {
    const now = Date.now();
    if (!force && now - lastSavedAtRef.current < saveIntervalMs) return;
    lastSavedAtRef.current = now;

    const location = await upsertLiveLocation({
      journeyId: tripId,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : null,
      recordedAt: new Date(position.timestamp || Date.now()).toISOString(),
    });

    onLocationSaved?.(location);
  }

  function startWatching() {
    if (!("geolocation" in window.navigator)) {
      setError(t("map.unsupported"));
      return;
    }

    watchIdRef.current = window.navigator.geolocation.watchPosition(
      (position) => {
        savePosition(position).catch((liveError) => {
          setError(getErrorMessage(liveError, t("map.permissionError")));
        });
      },
      (positionError) => {
        setError(geolocationErrorMessage(positionError, t));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 20_000,
        timeout: 20_000,
      },
    );
  }

  async function handleToggle() {
    setError(null);
    setIsBusy(true);

    try {
      if (isEnabled) {
        if (watchIdRef.current !== null) {
          window.navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        const location = await setLiveLocationEnabled(tripId, false);
        setIsEnabled(false);
        onLocationSaved?.(location);
        return;
      }

      if (!("geolocation" in window.navigator)) {
        setError(t("map.unsupported"));
        return;
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        window.navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 10_000,
          timeout: 20_000,
        });
      });

      await savePosition(position, true);
      setIsEnabled(true);
      startWatching();
    } catch (liveError) {
      if (
        liveError &&
        typeof liveError === "object" &&
        "code" in liveError &&
        typeof (liveError as GeolocationPositionError).code === "number"
      ) {
        setError(geolocationErrorMessage(liveError as GeolocationPositionError, t));
        return;
      }
      setError(getErrorMessage(liveError, t("map.permissionError")));
    } finally {
      setIsBusy(false);
    }
  }

  if (!canShare) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isBusy}
        className={`inline-flex items-center justify-center gap-2 rounded-full font-bold shadow-sm transition ${
          compact
            ? "px-3 py-2 text-xs"
            : "px-5 py-3 text-sm"
        } ${
          isEnabled
            ? "bg-emerald-700 text-white"
            : "bg-white text-emerald-800 ring-1 ring-emerald-100"
        } ${isBusy ? "opacity-65" : ""}`}
        title={t("map.enableNote")}
      >
        <span
          className={`size-2 rounded-full ${
            isEnabled ? "bg-emerald-200" : "bg-stone-300"
          }`}
        />
        {compact
          ? t("map.liveShort")
          : isBusy
            ? t("map.updating")
            : isEnabled
              ? t("map.turnLiveOff")
              : t("map.turnLiveOn")}
      </button>
      {!compact ? (
        <p className="mt-2 text-xs leading-5 text-stone-500">{t("map.enableNote")}</p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
