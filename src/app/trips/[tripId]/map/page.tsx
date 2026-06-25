"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { LiveLocationToggle } from "@/components/LiveLocationToggle";
import { useI18n } from "@/components/I18nProvider";
import {
  type Coordinates,
  distanceMeters,
  formatDistance,
  navigationHref,
} from "@/lib/geo";
import { getErrorMessage } from "@/lib/errors";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import {
  getJourneyLiveLocations,
  getJourneyMapObjects,
} from "@/lib/supabase/map";
import { getPlannerV2, type PlannerV2Day } from "@/lib/supabase/planner-v2";
import { getTrip } from "@/lib/supabase/trips";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type {
  JourneyLiveLocation,
  JourneyMapObject,
  JourneyMember,
  Trip,
} from "@/types";

type MapMode = "live" | "route" | "day" | "memories" | "places";

type MemberLocation = {
  member: JourneyMember;
  location: JourneyLiveLocation | null;
  status: "live" | "stale" | "offline";
  distance: number | null;
};

const mapModes: MapMode[] = ["live", "route", "day", "memories", "places"];
const mapModeLabelKeys: Record<MapMode, TranslationKey> = {
  live: "map.live",
  route: "map.route",
  day: "map.day",
  memories: "map.memories",
  places: "map.places",
};

function getCoordinates(
  value: JourneyLiveLocation | JourneyMapObject | null,
): Coordinates | null {
  if (value?.latitude === null || value?.latitude === undefined) return null;
  if (value.longitude === null || value.longitude === undefined) return null;
  return {
    latitude: value.latitude,
    longitude: value.longitude,
  };
}

function getLiveStatus(location: JourneyLiveLocation | null) {
  if (!location?.isLiveEnabled || !location.recordedAt) return "offline";

  const ageMs = Date.now() - new Date(location.recordedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 30 * 60_000) return "offline";
  if (ageMs > 10 * 60_000) return "stale";
  return "live";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function markerStyle(index: number, total: number) {
  if (total <= 1) return { left: "50%", top: "50%" };

  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const radius = 30;
  return {
    left: `${50 + Math.cos(angle) * radius}%`,
    top: `${50 + Math.sin(angle) * radius}%`,
  };
}

function relativeLabel(
  value: string | null,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (!value) return t("map.memberStatusOffline");

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return t("map.memberStatusOffline");

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return t("map.justNow");

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("map.minutesAgo", { count: minutes });

  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("map.hoursAgo", { count: hours });

  return t("map.daysAgo", { count: Math.round(hours / 24) });
}

function statusLabel(
  status: MemberLocation["status"],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (status === "live") return t("map.memberStatusLive");
  if (status === "stale") return t("map.memberStatusStale");
  return t("map.memberStatusOffline");
}

function locationTextFromDay(day: PlannerV2Day) {
  const reservationLocation = day.reservations.find(
    (reservation) => reservation.locationName,
  )?.locationName;
  const activityLocation = day.activities.find(
    (activity) => activity.locationName,
  )?.locationName;
  return reservationLocation || activityLocation || "";
}

function JourneyMapContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const { t } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [liveLocations, setLiveLocations] = useState<JourneyLiveLocation[]>([]);
  const [mapObjects, setMapObjects] = useState<JourneyMapObject[]>([]);
  const [days, setDays] = useState<PlannerV2Day[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<MapMode>("live");
  const [selectedDayId, setSelectedDayId] = useState<string>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshLiveLocations = useCallback(async () => {
    const locations = await getJourneyLiveLocations(tripId);
    setLiveLocations(locations);
  }, [tripId]);

  useEffect(() => {
    let isMounted = true;

    async function loadMapData() {
      setIsLoading(true);
      try {
        const user = await getCurrentUser();
        const journey = await getTrip(tripId);
        const [journeyMembers, locations, objects, planner] = await Promise.all([
          getJourneyMembers(tripId),
          getJourneyLiveLocations(tripId),
          getJourneyMapObjects(tripId),
          getPlannerV2(journey),
        ]);

        if (!isMounted) return;
        setCurrentUserId(user?.id ?? null);
        setTrip(journey);
        setMembers(journeyMembers);
        setLiveLocations(locations);
        setMapObjects(objects);
        setDays(planner.days);
        setSelectedDayId(planner.days[0]?.day.id ?? "all");
        setError(null);
      } catch (mapError) {
        if (isMounted) {
          setError(getErrorMessage(mapError, t("map.loadError")));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadMapData();
    return () => {
      isMounted = false;
    };
  }, [t, tripId]);

  const liveByUserId = useMemo(
    () => new Map(liveLocations.map((location) => [location.userId, location])),
    [liveLocations],
  );

  const ownCoordinates = useMemo(() => {
    const ownLocation = currentUserId ? liveByUserId.get(currentUserId) : null;
    return getCoordinates(ownLocation ?? null);
  }, [currentUserId, liveByUserId]);

  const memberLocations = useMemo<MemberLocation[]>(() => {
    return members
      .filter((member) => member.status !== "invite_pending")
      .map((member) => {
        const location = member.userId ? liveByUserId.get(member.userId) ?? null : null;
        const coordinates = getCoordinates(location);
        const distance =
          ownCoordinates && coordinates ? distanceMeters(ownCoordinates, coordinates) : null;

        return {
          member,
          location,
          status: getLiveStatus(location),
          distance,
        };
      });
  }, [liveByUserId, members, ownCoordinates]);

  const selectedMemberLocation = useMemo(
    () =>
      memberLocations.find(
        (memberLocation) => memberLocation.member.userId === selectedUserId,
      ) ?? null,
    [memberLocations, selectedUserId],
  );

  const activeDay = useMemo(() => {
    if (selectedDayId === "all") return null;
    return days.find((day) => day.day.id === selectedDayId) ?? null;
  }, [days, selectedDayId]);

  const relevantObjects = useMemo(() => {
    if (mode === "memories") {
      return mapObjects.filter((object) => object.type === "memory");
    }
    if (mode === "places") {
      return mapObjects.filter((object) =>
        ["hotel", "restaurant", "parking", "fuel", "toilet", "trailhead", "poi", "emergency"].includes(
          object.type,
        ),
      );
    }
    if (mode === "day" && activeDay) {
      const date = activeDay.day.dayDate;
      return mapObjects.filter((object) => object.timestamp?.slice(0, 10) === date);
    }
    return mapObjects;
  }, [activeDay, mapObjects, mode]);

  const visibleMarkers = useMemo(() => {
    if (mode === "live") {
      return memberLocations
        .filter((memberLocation) => getCoordinates(memberLocation.location))
        .map((memberLocation) => ({
          id: memberLocation.member.id,
          label: memberLocation.member.displayName,
          status: memberLocation.status,
          userId: memberLocation.member.userId,
        }));
    }

    return relevantObjects
      .filter((object) => getCoordinates(object))
      .map((object) => ({
        id: object.id,
        label: object.title,
        status: "live" as const,
        userId: null,
      }));
  }, [memberLocations, mode, relevantObjects]);

  function handleLocationSaved(location: JourneyLiveLocation) {
    setLiveLocations((current) => {
      const next = current.filter(
        (item) =>
          item.journeyId !== location.journeyId || item.userId !== location.userId,
      );
      return [location, ...next];
    });
    refreshLiveLocations().catch(() => undefined);
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-emerald-800">{t("map.title")}</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {trip?.name || t("nav.map")}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          {mode === "live"
            ? t("map.enableNote")
            : mode === "route"
              ? t("map.routeDescription")
              : mode === "day"
                ? t("map.dayDescription")
                : mode === "memories"
                  ? t("map.memoriesDescription")
                  : t("map.placesDescription")}
        </p>
        {error ? (
          <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <div className="sticky top-16 z-10 -mx-4 border-y border-emerald-100 bg-[#fffdf8]/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-[24px] md:border md:bg-white">
        <div className="flex gap-2 overflow-x-auto">
          {mapModes.map((mapMode) => (
            <button
              key={mapMode}
              type="button"
              onClick={() => setMode(mapMode)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
                mode === mapMode
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "bg-white text-stone-600 ring-1 ring-stone-200"
              }`}
            >
              {t(mapModeLabelKeys[mapMode])}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <div className="overflow-hidden rounded-[30px] border border-stone-200 bg-white shadow-sm">
          <div className="relative min-h-[360px] bg-[radial-gradient(circle_at_18%_18%,#d1fae5,transparent_24%),radial-gradient(circle_at_78%_28%,#fef3c7,transparent_22%),linear-gradient(135deg,#ecfdf5,#f8fafc_48%,#f5efe3)]">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(16,185,129,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(16,185,129,0.12)_1px,transparent_1px)] bg-[size:44px_44px]" />
            <div className="absolute left-5 top-5 rounded-2xl bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
                {t("map.placeholder")}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-stone-500">
                {t("map.mapNote")}
              </p>
            </div>
            {isLoading ? (
              <div className="absolute inset-0 grid place-items-center">
                <p className="rounded-full bg-white px-4 py-2 text-sm font-bold text-stone-600 shadow-sm">
                  {t("map.loading")}
                </p>
              </div>
            ) : null}
            {visibleMarkers.map((marker, index) => (
              <button
                key={marker.id}
                type="button"
                onClick={() => marker.userId && setSelectedUserId(marker.userId)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-3 py-2 text-xs font-black shadow-lg ring-2 ring-white ${
                  marker.status === "offline"
                    ? "bg-stone-300 text-stone-700"
                    : marker.status === "stale"
                      ? "bg-amber-400 text-amber-950"
                      : "bg-emerald-700 text-white"
                }`}
                style={markerStyle(index, visibleMarkers.length)}
              >
                {marker.label}
              </button>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          {mode === "live" ? (
            <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
                    {t("map.live")}
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold text-stone-950">
                    {t("map.memberLocations")}
                  </h2>
                </div>
                <LiveLocationToggle
                  tripId={tripId}
                  onLocationSaved={handleLocationSaved}
                />
              </div>
            </div>
          ) : null}

          {mode === "day" ? (
            <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
                {t("map.selectedDay")}
              </label>
              <select
                value={selectedDayId}
                onChange={(event) => setSelectedDayId(event.target.value)}
                className="mt-3 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold text-stone-700"
              >
                <option value="all">{t("map.allDays")}</option>
                {days.map((day) => (
                  <option key={day.day.id} value={day.day.id}>
                    D{day.dayNumber} · {day.day.dayDate}
                  </option>
                ))}
              </select>
              {activeDay ? (
                <p className="mt-3 text-sm leading-6 text-stone-600">
                  {activeDay.day.title || locationTextFromDay(activeDay) || activeDay.day.dayDate}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
              {mode === "live" ? t("map.memberList") : t("map.objects")}
            </p>

            {mode === "live" ? (
              <div className="mt-4 grid gap-3">
                {memberLocations.length ? (
                  memberLocations.map((memberLocation) => {
                    const coordinates = getCoordinates(memberLocation.location);
                    const isMe = memberLocation.member.userId === currentUserId;

                    return (
                      <button
                        key={memberLocation.member.id}
                        type="button"
                        onClick={() =>
                          memberLocation.member.userId &&
                          setSelectedUserId(memberLocation.member.userId)
                        }
                        className="rounded-3xl bg-stone-50 p-4 text-left transition hover:bg-emerald-50"
                      >
                        <div className="flex items-center gap-3">
                          {memberLocation.member.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={memberLocation.member.avatarUrl}
                              alt=""
                              className="size-11 rounded-full object-cover"
                            />
                          ) : (
                            <span className="grid size-11 place-items-center rounded-full bg-emerald-100 text-sm font-black text-emerald-900">
                              {initials(memberLocation.member.displayName)}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-stone-950">
                              {memberLocation.member.displayName}
                              {isMe ? ` · ${t("map.currentUser")}` : ""}
                            </p>
                            <p className="mt-1 text-xs font-bold text-stone-500">
                              {statusLabel(memberLocation.status, t)} ·{" "}
                              {relativeLabel(memberLocation.location?.recordedAt ?? null, t)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-black ${
                              memberLocation.status === "live"
                                ? "bg-emerald-100 text-emerald-800"
                                : memberLocation.status === "stale"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-stone-100 text-stone-500"
                            }`}
                          >
                            {statusLabel(memberLocation.status, t)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-stone-500">
                          <span className="rounded-2xl bg-white px-3 py-2">
                            {memberLocation.distance === null
                              ? t("map.distanceUnavailable")
                              : formatDistance(memberLocation.distance)}
                          </span>
                          <span className="rounded-2xl bg-white px-3 py-2">
                            {coordinates
                              ? `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`
                              : t("map.noCoordinates")}
                          </span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className="rounded-3xl bg-stone-50 p-4 text-sm font-semibold text-stone-500">
                    {t("map.noLiveMembers")}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {relevantObjects.length ? (
                  relevantObjects.map((object) => {
                    const coordinates = getCoordinates(object);
                    return (
                      <div key={object.id} className="rounded-3xl bg-stone-50 p-4">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">
                          {object.type}
                        </p>
                        <h3 className="mt-1 text-base font-black text-stone-950">
                          {object.title}
                        </h3>
                        {object.description ? (
                          <p className="mt-2 text-sm leading-6 text-stone-600">
                            {object.description}
                          </p>
                        ) : null}
                        {coordinates ? (
                          <a
                            href={navigationHref(coordinates, object.title)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex rounded-full bg-emerald-700 px-4 py-2 text-xs font-black text-white"
                          >
                            {t("map.openNavigation")}
                          </a>
                        ) : (
                          <p className="mt-3 text-xs font-bold text-stone-400">
                            {t("map.noCoordinates")}
                          </p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="rounded-3xl bg-stone-50 p-4 text-sm font-semibold text-stone-500">
                    {t("map.noObjects")}
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {selectedMemberLocation ? (
        <div className="fixed inset-x-4 bottom-24 z-30 rounded-[28px] border border-emerald-100 bg-white p-5 shadow-2xl md:bottom-6 md:left-auto md:right-6 md:w-96">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
                {statusLabel(selectedMemberLocation.status, t)}
              </p>
              <h2 className="mt-1 text-xl font-black text-stone-950">
                {selectedMemberLocation.member.displayName}
              </h2>
              <p className="mt-2 text-sm font-semibold text-stone-500">
                {t("map.lastUpdate")}:{" "}
                {relativeLabel(selectedMemberLocation.location?.recordedAt ?? null, t)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedUserId(null)}
              className="rounded-full bg-stone-100 px-4 py-2 text-sm font-black text-stone-600"
            >
              {t("common.close")}
            </button>
          </div>
          {selectedMemberLocation.location?.accuracy ? (
            <p className="mt-3 text-sm font-semibold text-stone-500">
              {t("map.accuracy")}: {Math.round(selectedMemberLocation.location.accuracy)} m
            </p>
          ) : null}
          {getCoordinates(selectedMemberLocation.location) ? (
            <a
              href={navigationHref(
                getCoordinates(selectedMemberLocation.location) as Coordinates,
                selectedMemberLocation.member.displayName,
              )}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-full bg-emerald-700 px-5 py-3 text-sm font-black text-white"
            >
              {t("map.openNavigation")}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function JourneyMapPage() {
  return <AuthGate>{() => <JourneyMapContent />}</AuthGate>;
}
