"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import {
  LeafletMapCanvas,
  type LeafletMapMarker,
  type LeafletMapRoute,
} from "@/components/LeafletMapCanvas";
import { LiveLocationToggle } from "@/components/LiveLocationToggle";
import { useI18n } from "@/components/I18nProvider";
import { TranslatedText } from "@/components/TranslatedText";
import {
  readTodayScopedValue,
  writeTodayScopedValue,
} from "@/lib/day-view-storage";
import {
  type Coordinates,
  distanceMeters,
  formatDistance,
  navigationHref,
} from "@/lib/geo";
import { getErrorMessage } from "@/lib/errors";
import { formatJourneyTime, journeyDateKey } from "@/lib/format";
import { useJourneyCachedResource } from "@/hooks/useJourneyCachedResource";
import {
  journeyResourceKey,
  loadJourneyMapResource,
} from "@/lib/journey-resources";
import {
  manualPinLocationClient,
  resolveJourneyLocationsClient,
  resolveLocationItemClient,
  type ResolveJourneyLocationsSummary,
} from "@/lib/place-service/client";
import { getActiveJourneyMembers } from "@/lib/journeys/stats";
import {
  getJourneyLiveLocations,
  getJourneyMapObjects,
} from "@/lib/supabase/map";
import {
  type PlannerV2Data,
  type PlannerV2Day,
} from "@/lib/supabase/planner-v2";
import { getSignedMemoryImageUrls } from "@/lib/supabase/memories";
import type {
  ItineraryEvent,
  ItineraryReservation,
  JourneyLiveLocation,
  JourneyMapObject,
  JourneyMember,
  MemoryEntry,
  Trip,
} from "@/types";

type MemberLocation = {
  member: JourneyMember;
  location: JourneyLiveLocation | null;
  status: "live" | "stale" | "offline";
  distanceFromMe: number | null;
};

type MapStop = {
  id: string;
  label: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  coordinates: Coordinates;
  kind: LeafletMapMarker["kind"];
  icon: LeafletMapMarker["icon"];
  date: string | null;
  sourceType: string | null;
  sourceId: string | null;
  memoryCount?: number;
  thumbnailUrl?: string | null;
  memories?: MemoryEntry[];
};

const DEFAULT_ROUTING_BASE_URL = "https://router.project-osrm.org";

type CoordinateLookup = Record<string, Coordinates>;

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

function dedupeRouteCoordinates(coordinates: Coordinates[]) {
  return coordinates.filter((coordinate, index) => {
    const previous = coordinates[index - 1];
    if (!previous) return true;
    return (
      Math.abs(previous.latitude - coordinate.latitude) > 0.00001 ||
      Math.abs(previous.longitude - coordinate.longitude) > 0.00001
    );
  });
}

async function fetchRoadRoute(
  coordinates: Coordinates[],
  signal: AbortSignal,
): Promise<Coordinates[]> {
  const routeCoordinates = dedupeRouteCoordinates(coordinates);
  if (routeCoordinates.length < 2) return routeCoordinates;

  const baseUrl =
    process.env.NEXT_PUBLIC_ROUTING_BASE_URL ?? DEFAULT_ROUTING_BASE_URL;
  const coordinatePath = routeCoordinates
    .map((coordinate) => `${coordinate.longitude},${coordinate.latitude}`)
    .join(";");
  const url = `${baseUrl.replace(/\/$/, "")}/route/v1/driving/${coordinatePath}?overview=full&geometries=geojson&steps=false`;

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Road route request failed.");

  const payload = (await response.json()) as {
    routes?: Array<{
      geometry?: {
        coordinates?: Array<[number, number]>;
      };
    }>;
  };
  const routedCoordinates = payload.routes?.[0]?.geometry?.coordinates;
  if (!routedCoordinates?.length) throw new Error("Road route was empty.");

  return routedCoordinates.map(([longitude, latitude]) => ({
    latitude,
    longitude,
  }));
}

function getLiveStatus(location: JourneyLiveLocation | null) {
  if (!location?.isLiveEnabled || !location.recordedAt) return "offline";

  const ageMs = Date.now() - new Date(location.recordedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 30 * 60_000) return "offline";
  if (ageMs > 10 * 60_000) return "stale";
  return "live";
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

function liveLocationDescription(
  memberLocation: MemberLocation,
  currentUserId: string | null,
  t: ReturnType<typeof useI18n>["t"],
) {
  const status = statusLabel(memberLocation.status, t);
  const updatedAt = relativeLabel(memberLocation.location?.recordedAt ?? null, t);
  if (memberLocation.member.userId === currentUserId) {
    return `${status} · ${t("map.myLiveLocation")} · ${updatedAt}`;
  }
  const distance =
    memberLocation.distanceFromMe === null
      ? t("map.distanceUnavailable")
      : formatDistance(memberLocation.distanceFromMe);
  return `${status} · ${t("map.memberDistanceFromMe", {
    name: memberLocation.member.displayName,
    distance,
  })} · ${updatedAt}`;
}

function dateKey(value: string | null | undefined) {
  return journeyDateKey(value);
}

function plannerDateKey(value: string | null | undefined) {
  return journeyDateKey(value);
}

function timeLabel(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function plannerTimeLabel(value: string | null | undefined) {
  return value ? formatJourneyTime(value) : "";
}

function compactDate(value: string, t: ReturnType<typeof useI18n>["t"]) {
  if (value === "unscheduled") return t("planner.anytime");
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function isOfficialTripDay(value: string, trip: Trip | null) {
  if (value === "unscheduled" || !trip?.startDate || !trip.endDate) {
    return false;
  }
  return value >= trip.startDate && value <= trip.endDate;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

function getDefaultDayId(days: PlannerV2Data["days"]) {
  if (days.length === 0) return "journey";

  const today = todayKey();
  const exact = days.find((day) => day.day.dayDate === today);
  if (exact) return exact.day.id;

  const datedDays = days.filter((day) => day.day.dayDate !== "unscheduled");
  if (datedDays.length === 0) return days[0]?.day.id ?? "journey";

  const todayTime = new Date(`${today}T00:00:00`).getTime();
  const closest = datedDays.reduce((best, day) => {
    const bestDistance = Math.abs(
      new Date(`${best.day.dayDate}T00:00:00`).getTime() - todayTime,
    );
    const dayDistance = Math.abs(
      new Date(`${day.day.dayDate}T00:00:00`).getTime() - todayTime,
    );

    return dayDistance < bestDistance ? day : best;
  });

  return closest.day.id;
}

function getStoredMapViewId(tripId: string, days: PlannerV2Data["days"]) {
  const storedValue = readTodayScopedValue(`otr:map-view:${tripId}`);
  if (!storedValue) return null;
  if (storedValue === "journey") return "journey";
  return days.find((day) => day.day.dayDate === storedValue)?.day.id ?? null;
}

function getQueryMapViewId(date: string | null, days: PlannerV2Data["days"]) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return days.find((day) => day.day.dayDate === date)?.day.id ?? null;
}

function shouldShowScheduleStopOnDay(
  dayDate: string,
  startValue: string | null | undefined,
  endValue: string | null | undefined,
) {
  if (dayDate === "unscheduled") return true;

  const startDate = plannerDateKey(startValue);
  const endDate = plannerDateKey(endValue);

  if (startDate && endDate && startDate !== endDate) {
    return dayDate === startDate || dayDate === endDate;
  }

  return true;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function objectThumbnail(object: JourneyMapObject) {
  const metadata = object.metadata ?? {};
  const candidates = [
    metadata.thumbnailUrl,
    metadata.providerThumbnailUrl,
    metadata.displayUrl,
    metadata.imageUrl,
  ];
  return candidates.find((value): value is string => typeof value === "string") ?? null;
}

function findObjectForSource(
  objects: JourneyMapObject[],
  sourceType: string,
  sourceId: string | null,
  title: string,
  locationName: string | null,
) {
  if (sourceId) {
    const exact = objects.find(
      (object) => object.sourceType === sourceType && object.sourceId === sourceId,
    );
    if (exact) return exact;
  }

  const titleKey = normalizeText(title);
  const locationKey = normalizeText(locationName);
  return objects.find((object) => {
    const objectTitle = normalizeText(object.title);
    return (
      (titleKey && objectTitle === titleKey) ||
      (locationKey && objectTitle === locationKey)
    );
  });
}

function isCurrentPlannerMapObject(
  object: JourneyMapObject,
  currentPlanSourceKeys: Set<string>,
) {
  if (
    object.sourceType !== "itinerary_event" &&
    object.sourceType !== "itinerary_reservation"
  ) {
    return true;
  }
  if (!object.sourceId) return false;
  return currentPlanSourceKeys.has(`${object.sourceType}:${object.sourceId}`);
}

function coordinateLookupKey(
  sourceType: string,
  sourceId: string | null,
  title: string | null | undefined,
  locationName: string | null | undefined,
) {
  if (sourceId) return `${sourceType}:${sourceId}`;
  return `${sourceType}:${normalizeText(`${title ?? ""} ${locationName ?? ""}`)}`;
}

function coordinateLookupValue(
  lookup: CoordinateLookup,
  sourceType: string,
  sourceId: string | null,
  title: string | null | undefined,
  locationName: string | null | undefined,
) {
  return lookup[coordinateLookupKey(sourceType, sourceId, title, locationName)] ?? null;
}

function hasPlannerLocation(locationName: string | null | undefined) {
  return Boolean(locationName?.trim());
}

function isFlightReservation(reservation: ItineraryReservation) {
  return reservation.reservationType === "flight";
}

function isFlightEvent(event: ItineraryEvent) {
  return event.eventType === "flight";
}

function reservationStop(
  reservation: ItineraryReservation,
  day: PlannerV2Day,
  objects: JourneyMapObject[],
  label: string,
  kind: LeafletMapMarker["kind"],
  geocodedCoordinates: CoordinateLookup,
): MapStop | null {
  if (isFlightReservation(reservation)) return null;
  if (!hasPlannerLocation(reservation.locationName)) return null;

  const object = findObjectForSource(
    objects,
    "itinerary_reservation",
    reservation.id,
    reservation.title,
    reservation.locationName,
  );
  const coordinates =
    getCoordinates(object ?? null) ??
    coordinateLookupValue(
      geocodedCoordinates,
      "itinerary_reservation",
      reservation.id,
      reservation.title,
      reservation.locationName,
    );
  if (!coordinates) return null;
  const reservationDetails = [
    reservation.sourceText,
    reservation.provider,
    reservation.confirmationCode
      ? `#${reservation.confirmationCode}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id: `reservation-${reservation.id}-${day.day.id}`,
    label,
    title: reservation.title,
    subtitle: reservation.locationName,
    description: reservationDetails || null,
    coordinates,
    kind,
    icon: reservationIcon(reservation.reservationType),
    date: day.day.dayDate,
    sourceType: "itinerary_reservation",
    sourceId: reservation.id,
  };
}

function eventStop(
  event: ItineraryEvent,
  day: PlannerV2Day,
  objects: JourneyMapObject[],
  geocodedCoordinates: CoordinateLookup,
): MapStop | null {
  if (isFlightEvent(event)) return null;
  if (!hasPlannerLocation(event.locationName)) return null;

  const object = findObjectForSource(
    objects,
    "itinerary_event",
    event.id,
    event.title,
    event.locationName,
  );
  const coordinates =
    getCoordinates(object ?? null) ??
    coordinateLookupValue(
      geocodedCoordinates,
      "itinerary_event",
      event.id,
      event.title,
      event.locationName,
    );
  if (!coordinates) return null;

  return {
    id: `event-${event.id}`,
    label: plannerTimeLabel(event.plannedStart) || event.title,
    title: event.title,
    subtitle: event.locationName,
    description: event.description,
    coordinates,
    kind: "plan",
    icon: eventIcon(event.eventType),
    date: day.day.dayDate,
    sourceType: "itinerary_event",
    sourceId: event.id,
  };
}

function linkedMemoryCoordinates(
  memory: MemoryEntry,
  days: PlannerV2Day[],
  objects: JourneyMapObject[],
  geocodedCoordinates: CoordinateLookup,
) {
  for (const day of days) {
    if (memory.itineraryReservationId) {
      const reservation = day.reservations.find(
        (item) => item.id === memory.itineraryReservationId,
      );
      if (reservation) {
        const stop = reservationStop(
          reservation,
          day,
          objects,
          plannerTimeLabel(reservation.startsAt) || reservation.title,
          reservation.reservationType === "hotel" ? "hotel" : "place",
          geocodedCoordinates,
        );
        if (stop?.coordinates) return stop.coordinates;
      }
    }

    if (memory.itineraryEventId) {
      const activity = day.activities.find(
        (item) => item.id === memory.itineraryEventId,
      );
      if (activity) {
        const stop = eventStop(activity, day, objects, geocodedCoordinates);
        if (stop?.coordinates) return stop.coordinates;
      }
    }
  }

  return null;
}

function memoryStop(
  memory: MemoryEntry,
  objects: JourneyMapObject[],
  days: PlannerV2Day[],
  geocodedCoordinates: CoordinateLookup,
  imageUrls: Record<string, string>,
): MapStop | null {
  if (memory.type !== "photo") return null;

  const object = findObjectForSource(
    objects,
    "memory",
    memory.id,
    memory.content,
    memory.locationName,
  );
  const coordinates =
    getCoordinates(object ?? null) ??
    linkedMemoryCoordinates(memory, days, objects, geocodedCoordinates) ??
    coordinateLookupValue(
      geocodedCoordinates,
      "memory",
      memory.id,
      memory.content,
      memory.locationName,
    );
  if (!coordinates) return null;
  const thumbnailUrl =
    (object ? objectThumbnail(object) : null) ??
    (memory.mediaUrl ? imageUrls[memory.mediaUrl] : null);
  if (!thumbnailUrl) return null;

  return {
    id: `memory-${memory.id}`,
    label: memory.type === "photo" ? "1" : "M",
    title: memory.content || memory.locationName || "Memory",
    subtitle: memory.locationName,
    description: memory.content,
    coordinates,
    kind: "memory",
    icon: "memory",
    date: dateKey(memory.capturedAt),
    sourceType: "memory",
    sourceId: memory.id,
    memoryCount: 1,
    thumbnailUrl,
    memories: [memory],
  };
}

function groupPhotoMemoryStops(stops: MapStop[]) {
  const groups = new Map<string, MapStop>();

  stops.forEach((stop) => {
    const key = `${stop.coordinates.latitude.toFixed(4)},${stop.coordinates.longitude.toFixed(4)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...stop, memories: stop.memories ?? [] });
      return;
    }

    groups.set(key, {
      ...existing,
      id: `${existing.id}-group`,
      label: `${(existing.memoryCount ?? 1) + (stop.memoryCount ?? 1)}`,
      title: existing.title,
      description:
        existing.description && stop.description
          ? `${existing.description}\n${stop.description}`
          : existing.description || stop.description,
      memoryCount: (existing.memoryCount ?? 1) + (stop.memoryCount ?? 1),
      memories: [...(existing.memories ?? []), ...(stop.memories ?? [])],
    });
  });

  return [...groups.values()];
}

function mapObjectKind(object: JourneyMapObject): LeafletMapMarker["kind"] {
  if (object.type === "hotel") return "hotel";
  if (object.type === "memory") return "memory";
  if (object.type === "plan_item" || object.type === "route_point") return "plan";
  return "place";
}

function reservationIcon(
  type: ItineraryReservation["reservationType"],
): LeafletMapMarker["icon"] {
  if (type === "flight") return "flight";
  if (type === "hotel") return "hotel";
  if (type === "car") return "car";
  if (type === "ferry") return "ferry";
  if (type === "restaurant") return "meal";
  if (type === "tour") return "tour";
  return "place";
}

function eventIcon(type: ItineraryEvent["eventType"]): LeafletMapMarker["icon"] {
  if (type === "flight") return "flight";
  if (type === "hotel") return "hotel";
  if (type === "car") return "car";
  if (type === "meal") return "meal";
  if (type === "shopping") return "shopping";
  if (type === "transport") return "transport";
  if (type === "note") return "note";
  if (type === "activity") return "activity";
  return "place";
}

function mapObjectIcon(object: JourneyMapObject): LeafletMapMarker["icon"] {
  if (object.type === "airport") return "flight";
  if (object.type === "hotel") return "hotel";
  if (object.type === "memory") return "memory";
  if (object.type === "restaurant") return "meal";
  if (object.type === "route_point") return "transport";
  if (object.type === "plan_item") return "activity";
  return "place";
}

function dayLocationTargets(plannerDay: PlannerV2Day) {
  const targets = [
    ...plannerDay.reservations
      .filter((reservation) => !isFlightReservation(reservation))
      .filter((reservation) => hasPlannerLocation(reservation.locationName))
      .map((reservation) => ({
        itemType: "itinerary_reservation",
        itemId: reservation.id,
      })),
    ...plannerDay.activities
      .filter((activity) => !isFlightEvent(activity))
      .filter((activity) => hasPlannerLocation(activity.locationName))
      .map((activity) => ({
        itemType: "itinerary_event",
        itemId: activity.id,
      })),
  ];
  return [
    ...new Map(
      targets.map((target) => [`${target.itemType}:${target.itemId}`, target]),
    ).values(),
  ];
}

function locationTargetKey(targets: ReturnType<typeof dayLocationTargets>) {
  return targets
    .map((target) => `${target.itemType}:${target.itemId}`)
    .sort()
    .join("|");
}

async function resolveDayLocations(
  journeyId: string,
  plannerDay: PlannerV2Day,
  force: boolean,
): Promise<ResolveJourneyLocationsSummary> {
  const uniqueTargets = dayLocationTargets(plannerDay);
  const results: NonNullable<ResolveJourneyLocationsSummary["results"]> = [];

  for (const target of uniqueTargets) {
    const result = await resolveLocationItemClient({
      journeyId,
      itemType: target.itemType,
      itemId: target.itemId,
      force,
    });
    results.push(result);
  }

  return {
    total: uniqueTargets.length,
    attempted: results.length,
    resolved: results.filter(
      (result) => result.status === "resolved" || result.status === "manual",
    ).length,
    failed: results.filter((result) => result.status === "failed").length,
    ambiguous: results.filter((result) => result.status === "ambiguous").length,
    skipped: uniqueTargets.length - results.length,
    results,
  };
}

function JourneyMapContent() {
  const params = useParams<{ tripId: string }>();
  const searchParams = useSearchParams();
  const tripId = params.tripId;
  const requestedDate = searchParams.get("date");
  const { t } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [liveLocations, setLiveLocations] = useState<JourneyLiveLocation[]>([]);
  const [mapObjects, setMapObjects] = useState<JourneyMapObject[]>([]);
  const [days, setDays] = useState<PlannerV2Day[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string>("journey");
  const [showMemories, setShowMemories] = useState(false);
  const [mapViewVersion, setMapViewVersion] = useState(0);
  const [selectedMarker, setSelectedMarker] = useState<LeafletMapMarker | null>(null);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [memoryImageUrls, setMemoryImageUrls] = useState<Record<string, string>>(
    {},
  );
  const [roadRoute, setRoadRoute] = useState<{
    key: string;
    coordinates: Coordinates[];
  } | null>(null);
  const geocodedCoordinates = useMemo<CoordinateLookup>(() => ({}), []);
  const [locationRepair, setLocationRepair] = useState<
    (ResolveJourneyLocationsSummary & { isResolving: boolean; error?: string | null }) | null
  >(null);
  const [manualPinTarget, setManualPinTarget] = useState<
    NonNullable<ResolveJourneyLocationsSummary["results"]>[number] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const dateStripRef = useRef<HTMLDivElement | null>(null);
  const locationRepairKeyRef = useRef<string | null>(null);
  const hydratedMapViewTripRef = useRef<string | null>(null);

  const refreshLiveLocations = useCallback(async () => {
    const locations = await getJourneyLiveLocations(tripId);
    setLiveLocations(locations);
  }, [tripId]);

  const refreshMapObjects = useCallback(async () => {
    const objects = await getJourneyMapObjects(tripId);
    setMapObjects(objects);
  }, [tripId]);

  const runLocationRepair = useCallback(
    async (
      force = false,
      options: { refitOnResolved?: boolean; silent?: boolean } = {},
    ) => {
      const silent = Boolean(options.silent);
      const scopedDay =
        selectedDayId !== "journey"
          ? days.find((plannerDay) => plannerDay.day.id === selectedDayId) ?? null
          : null;
      const resolvingTotal = scopedDay ? dayLocationTargets(scopedDay).length : 0;
      if (!silent) {
        setLocationRepair((current) => ({
          total: resolvingTotal,
          attempted: 0,
          resolved: 0,
          failed: 0,
          ambiguous: 0,
          skipped: current?.skipped ?? 0,
          isResolving: true,
          error: null,
        }));
      }
      try {
        const summary = scopedDay
          ? await resolveDayLocations(tripId, scopedDay, force)
          : await resolveJourneyLocationsClient(tripId, {
              force,
              limit: force ? 50 : 20,
            });
        setLocationRepair({ ...summary, isResolving: false, error: null });
        if (summary.resolved > 0) {
          await refreshMapObjects();
          if (options.refitOnResolved) {
            setMapViewVersion((version) => version + 1);
          }
        }
      } catch (repairError) {
        if (silent) return;
        setLocationRepair((current) => ({
          total: current?.total ?? 0,
          attempted: current?.attempted ?? 0,
          resolved: current?.resolved ?? 0,
          failed: current?.failed ?? 0,
          ambiguous: current?.ambiguous ?? 0,
          skipped: current?.skipped ?? 0,
          isResolving: false,
          error: getErrorMessage(repairError, t("map.repair.error")),
        }));
      }
    },
    [days, refreshMapObjects, selectedDayId, t, tripId],
  );

  const mapResource = useJourneyCachedResource({
    cacheKey: journeyResourceKey.map(tripId),
    loader: () => loadJourneyMapResource(tripId),
    ttl: 90_000,
    staleTime: 0,
    keepPreviousData: true,
    backgroundRefresh: true,
  });

  useEffect(() => {
    const data = mapResource.data;
    if (!data) return;
    setCurrentUserId(data.currentUserId);
    setTrip(data.trip);
    setMembers(data.members);
    setLiveLocations(data.liveLocations);
    setMapObjects(data.mapObjects);
    setDays(data.days);
    const requestedDayId = getQueryMapViewId(requestedDate, data.days);
    const storedDayId = getStoredMapViewId(tripId, data.days);
    const hasHydratedThisTrip = hydratedMapViewTripRef.current === tripId;
    setSelectedDayId((current) => {
      if (requestedDayId) return requestedDayId;
      if (!hasHydratedThisTrip && storedDayId) return storedDayId;
      if (
        hasHydratedThisTrip &&
        current &&
        (current === "journey" || data.days.some((day) => day.day.id === current))
      ) {
        return current;
      }
      return (
        storedDayId ??
        getDefaultDayId(data.days)
      );
    });
    hydratedMapViewTripRef.current = tripId;
    if (requestedDayId && requestedDate) {
      writeTodayScopedValue(`otr:map-view:${tripId}`, requestedDate);
      writeTodayScopedValue(`otr:planner-day:${tripId}`, requestedDate);
    }
    setError(null);
  }, [mapResource.data, requestedDate, tripId]);

  useEffect(() => {
    if (!mapResource.error || mapResource.data) return;
    setError(getErrorMessage(mapResource.error, t("map.loadError")));
  }, [mapResource.data, mapResource.error, t]);

  const selectedDay = useMemo(
    () => days.find((day) => day.day.id === selectedDayId) ?? null,
    [days, selectedDayId],
  );
  const currentPlanSourceKeys = useMemo(() => {
    const keys = new Set<string>();
    days.forEach((day) => {
      day.reservations.forEach((reservation) => {
        keys.add(`itinerary_reservation:${reservation.id}`);
      });
      day.activities.forEach((activity) => {
        keys.add(`itinerary_event:${activity.id}`);
      });
    });
    return keys;
  }, [days]);
  const selectedRepairTargetKey = useMemo(
    () => (selectedDay ? locationTargetKey(dayLocationTargets(selectedDay)) : "journey"),
    [selectedDay],
  );

  useEffect(() => {
    if (!selectedDayId || selectedDayId === "journey") return;
    const node = dateStripRef.current?.querySelector(
      `[data-map-day-id="${selectedDayId}"]`,
    );
    node?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedDayId]);

  const photoMemoryPathKey = useMemo(
    () =>
      days
        .flatMap((day) => day.memories)
        .filter((memory) => memory.type === "photo" && memory.mediaUrl)
        .map((memory) => memory.mediaUrl)
        .sort()
        .join("|"),
    [days],
  );

  useEffect(() => {
    const photoMemories = days
      .flatMap((day) => day.memories)
      .filter((memory) => memory.type === "photo" && memory.mediaUrl);
    if (!photoMemories.length) return;

    let isMounted = true;

    getSignedMemoryImageUrls(photoMemories)
      .then((urls) => {
        if (isMounted) setMemoryImageUrls(urls);
      })
      .catch(() => {
        if (isMounted) setMemoryImageUrls({});
      });

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoMemoryPathKey]);

  const hotelStops = useMemo(
    () =>
      days.flatMap((day) =>
        day.reservations
          .filter((reservation) => reservation.reservationType === "hotel")
          .flatMap((reservation) => {
            const stop = reservationStop(
              reservation,
              day,
              mapObjects,
              day.dayTag ?? `D${day.dayNumber}`,
              "hotel",
              geocodedCoordinates,
            );
            return stop ? [stop] : [];
          }),
      ),
    [days, geocodedCoordinates, mapObjects],
  );

  const hotelObjectStops = useMemo(
    () =>
      mapObjects.flatMap((object) => {
        if (!isCurrentPlannerMapObject(object, currentPlanSourceKeys)) return [];
        if (object.type !== "hotel") return [];
        const coordinates = getCoordinates(object);
        if (!coordinates) return [];

        return [
          {
            id: `map-object-${object.id}`,
            label: object.timestamp ? object.timestamp.slice(5, 10).replace("-", ".") : "Stay",
            title: object.title,
            subtitle: object.description,
            description: object.description,
            coordinates,
            kind: "hotel" as const,
            icon: mapObjectIcon(object),
            date: dateKey(object.timestamp),
            sourceType: object.sourceType,
            sourceId: object.sourceId,
          },
        ];
      }),
    [currentPlanSourceKeys, mapObjects],
  );

  const journeyDayStops = useMemo(
    () =>
      days.flatMap((day) => {
        const dayLabel = day.dayTag ?? `D${day.dayNumber}`;
        const stayStop =
          day.reservations
            .filter((reservation) => reservation.reservationType === "hotel")
            .map((reservation) =>
              reservationStop(
                reservation,
                day,
                mapObjects,
                dayLabel,
                "hotel",
                geocodedCoordinates,
              ),
            )
            .find((stop): stop is MapStop => Boolean(stop)) ?? null;

        if (stayStop) return [stayStop];

        const reservationStops = day.reservations.flatMap((reservation) => {
          if (reservation.reservationType === "hotel") return [];
          if (
            !shouldShowScheduleStopOnDay(
              day.day.dayDate,
              reservation.startsAt,
              reservation.endsAt,
            )
          ) {
            return [];
          }

          const stop = reservationStop(
            reservation,
            day,
            mapObjects,
            plannerTimeLabel(
              plannerDateKey(reservation.startsAt) === day.day.dayDate
                ? reservation.startsAt
                : reservation.endsAt,
            ) || reservation.title,
            reservation.reservationType === "car" ? "place" : "plan",
            geocodedCoordinates,
          );
          return stop ? [stop] : [];
        });
        const activityStops = day.activities.flatMap((activity) => {
          if (
            !shouldShowScheduleStopOnDay(
              day.day.dayDate,
              activity.plannedStart,
              activity.plannedEnd,
            )
          ) {
            return [];
          }

          const stop = eventStop(activity, day, mapObjects, geocodedCoordinates);
          return stop ? [stop] : [];
        });
        const firstLocatedStop = [...reservationStops, ...activityStops].sort(
          (first, second) => (first.label || "").localeCompare(second.label || ""),
        )[0];

        return firstLocatedStop
          ? [
              {
                ...firstLocatedStop,
                id: `journey-day-${day.day.id}-${firstLocatedStop.sourceId ?? firstLocatedStop.id}`,
                label: dayLabel,
                date: day.day.dayDate,
              },
            ]
          : [];
      }),
    [days, geocodedCoordinates, mapObjects],
  );

  const journeyObjectStops = useMemo(
    () =>
      mapObjects.flatMap((object) => {
        if (!isCurrentPlannerMapObject(object, currentPlanSourceKeys)) return [];
        if (object.type === "live_location" || object.type === "memory") return [];
        if (object.type === "hotel" && hotelStops.length) return [];
        const coordinates = getCoordinates(object);
        if (!coordinates) return [];

        return [
          {
            id: `map-object-${object.id}`,
            label: object.type === "hotel" ? "Stay" : object.title,
            title: object.title,
            subtitle: object.description,
            description: object.description,
            coordinates,
            kind: mapObjectKind(object),
            icon: mapObjectIcon(object),
            date: dateKey(object.timestamp),
            sourceType: object.sourceType,
            sourceId: object.sourceId,
          },
        ];
      }),
    [currentPlanSourceKeys, hotelStops.length, mapObjects],
  );

  const selectedDayStops = useMemo(() => {
    if (!selectedDay) return [];
    const selectedDayIndex = days.findIndex((day) => day.day.id === selectedDay.day.id);
    const previousDay = selectedDayIndex > 0 ? days[selectedDayIndex - 1] : null;
    const previousStay = previousDay?.reservations.find(
      (reservation) => reservation.reservationType === "hotel",
    );
    const startStop =
      previousDay && previousStay
        ? reservationStop(
            previousStay,
            previousDay,
            mapObjects,
            t("map.start"),
            "hotel",
            geocodedCoordinates,
          )
        : null;

    const reservationStops = selectedDay.reservations.flatMap((reservation) => {
      if (reservation.reservationType === "hotel") return [];
      if (
        !shouldShowScheduleStopOnDay(
          selectedDay.day.dayDate,
          reservation.startsAt,
          reservation.endsAt,
        )
      ) {
        return [];
      }
      const stop = reservationStop(
        reservation,
        selectedDay,
        mapObjects,
        plannerTimeLabel(
          plannerDateKey(reservation.startsAt) === selectedDay.day.dayDate
            ? reservation.startsAt
            : reservation.endsAt,
        ) || reservation.title,
        reservation.reservationType === "car" ? "place" : "plan",
        geocodedCoordinates,
      );
      return stop ? [stop] : [];
    });
    const activityStops = selectedDay.activities.flatMap((activity) => {
      if (
        !shouldShowScheduleStopOnDay(
          selectedDay.day.dayDate,
          activity.plannedStart,
          activity.plannedEnd,
        )
      ) {
        return [];
      }
      const stop = eventStop(
        activity,
        selectedDay,
        mapObjects,
        geocodedCoordinates,
      );
      return stop ? [stop] : [];
    });
    const tonightStayStop =
      selectedDay.reservations
        .filter((reservation) => reservation.reservationType === "hotel")
        .map((reservation) =>
          reservationStop(
            reservation,
            selectedDay,
            mapObjects,
            t("map.tonight"),
            "hotel",
            geocodedCoordinates,
          ),
        )
        .find((stop): stop is MapStop => Boolean(stop)) ?? null;

    const sortedStops = [...reservationStops, ...activityStops].sort((first, second) =>
      (first.label || "").localeCompare(second.label || ""),
    );
    const dayStops =
      tonightStayStop &&
      !sortedStops.some((stop) => stop.sourceId === tonightStayStop.sourceId)
        ? [...sortedStops, tonightStayStop]
        : sortedStops;
    return startStop
      ? [
          {
            ...startStop,
            id: `day-start-${selectedDay.day.id}-${startStop.sourceId ?? startStop.id}`,
            date: selectedDay.day.dayDate,
          },
          ...dayStops,
        ]
      : dayStops;
  }, [days, geocodedCoordinates, mapObjects, selectedDay, t]);

  const selectedDayObjectStops = useMemo(() => {
    if (!selectedDay) return [];
    const existingSources = new Set(
      selectedDayStops
        .map((stop) =>
          stop.sourceType && stop.sourceId
            ? `${stop.sourceType}:${stop.sourceId}`
            : null,
        )
        .filter((value): value is string => Boolean(value)),
    );

    return mapObjects.flatMap((object) => {
      if (!isCurrentPlannerMapObject(object, currentPlanSourceKeys)) return [];
      if (object.type === "live_location" || object.type === "memory") return [];
      if (dateKey(object.timestamp) !== selectedDay.day.dayDate) return [];
      const sourceKey =
        object.sourceType && object.sourceId
          ? `${object.sourceType}:${object.sourceId}`
          : null;
      if (sourceKey && existingSources.has(sourceKey)) return [];
      const coordinates = getCoordinates(object);
      if (!coordinates) return [];

      return [
        {
          id: `map-object-${object.id}`,
          label:
            plannerTimeLabel(object.timestamp) ||
            (object.type === "hotel" ? t("map.tonight") : object.title),
          title: object.title,
          subtitle: object.description,
          description: object.description,
          coordinates,
          kind: mapObjectKind(object),
          icon: mapObjectIcon(object),
          date: selectedDay.day.dayDate,
          sourceType: object.sourceType,
          sourceId: object.sourceId,
        },
      ];
    });
  }, [currentPlanSourceKeys, mapObjects, selectedDay, selectedDayStops, t]);

  const memoryStops = useMemo(
    () =>
      days.flatMap((day) =>
        day.memories.flatMap((memory) => {
          const stop = memoryStop(
            memory,
            mapObjects,
            days,
            geocodedCoordinates,
            memoryImageUrls,
          );
          return stop ? [stop] : [];
        }),
      ),
    [days, geocodedCoordinates, mapObjects, memoryImageUrls],
  );

  const visibleMemoryStops = useMemo(() => {
    if (!showMemories) return [];
    const scopedStops = selectedDay
      ? memoryStops.filter((stop) => stop.date === selectedDay.day.dayDate)
      : memoryStops;
    return groupPhotoMemoryStops(scopedStops);
  }, [memoryStops, selectedDay, showMemories]);

  const liveByUserId = useMemo(
    () => new Map(liveLocations.map((location) => [location.userId, location])),
    [liveLocations],
  );

  const liveEligibleMembers = useMemo(
    () =>
      getActiveJourneyMembers(members).filter(
        (member) => member.status === "linked" && Boolean(member.userId),
      ),
    [members],
  );

  const ownCoordinates = useMemo(() => {
    const ownLocation = currentUserId ? liveByUserId.get(currentUserId) : null;
    return getCoordinates(ownLocation ?? null);
  }, [currentUserId, liveByUserId]);

  const memberLocations = useMemo<MemberLocation[]>(() => {
    return liveEligibleMembers
      .map((member) => {
        const location = member.userId ? liveByUserId.get(member.userId) ?? null : null;
        const coordinates = getCoordinates(location);
        const distance =
          ownCoordinates && coordinates ? distanceMeters(ownCoordinates, coordinates) : null;

        return {
          member,
          location,
          status: getLiveStatus(location),
          distanceFromMe: distance,
        };
      });
  }, [liveByUserId, liveEligibleMembers, ownCoordinates]);

  const journeyStops = journeyDayStops.length ? journeyDayStops : hotelObjectStops;
  const journeyRouteCoordinates = useMemo(
    () => journeyStops.map((stop) => stop.coordinates),
    [journeyStops],
  );
  const fallbackCenter = useMemo<Coordinates>(
    () => ({ latitude: 0, longitude: 0 }),
    [],
  );
  const activePlanStops = useMemo(
    () =>
      selectedDay
        ? [...selectedDayStops, ...selectedDayObjectStops]
        : journeyStops.length
          ? journeyStops
          : journeyObjectStops,
    [
      journeyObjectStops,
      journeyStops,
      selectedDay,
      selectedDayObjectStops,
      selectedDayStops,
    ],
  );
  const focusCoordinates = useMemo(
    () =>
      activePlanStops.length
        ? activePlanStops.map((stop) => stop.coordinates)
        : [fallbackCenter],
    [activePlanStops, fallbackCenter],
  );

  useEffect(() => {
    if (!trip || !days.length) return;
    const key = `${tripId}:${selectedDayId}:${selectedRepairTargetKey}`;
    if (locationRepairKeyRef.current === key) return;
    locationRepairKeyRef.current = key;
    runLocationRepair(false, {
      refitOnResolved: activePlanStops.length === 0,
      silent: true,
    }).catch(() => undefined);
  }, [
    activePlanStops.length,
    days.length,
    runLocationRepair,
    selectedDayId,
    selectedRepairTargetKey,
    trip,
    tripId,
  ]);

  const liveMarkers = memberLocations.flatMap((memberLocation) => {
    const coordinates = getCoordinates(memberLocation.location);
    if (!coordinates || !memberLocation.member.userId) return [];

    return {
      id: `live-${memberLocation.member.userId}`,
      label: memberLocation.member.displayName,
      subtitle: liveLocationDescription(memberLocation, currentUserId, t),
      title:
        memberLocation.member.userId === currentUserId
          ? t("map.currentUser")
          : memberLocation.member.displayName,
      description: liveLocationDescription(memberLocation, currentUserId, t),
      coordinates,
      status: memberLocation.status,
      kind: "live" as const,
      icon: "live" as const,
    };
  });

  const planMarkers = activePlanStops.map((stop) => ({
    id: stop.id,
    label: stop.label,
    subtitle: stop.subtitle,
    title: stop.title,
    locationLabel: stop.subtitle,
    description: stop.description,
    coordinates: stop.coordinates,
    kind: stop.kind,
    icon: stop.icon,
  }));

  const memoryMarkers = visibleMemoryStops.map((stop) => ({
    id: stop.id,
    label: stop.memoryCount && stop.memoryCount > 1 ? `${stop.memoryCount}` : "",
    subtitle: stop.subtitle,
    title:
      stop.memoryCount && stop.memoryCount > 1
        ? t("map.photoGroupTitle", { count: stop.memoryCount })
        : stop.title,
    locationLabel: stop.subtitle,
    description: stop.description,
    coordinates: stop.coordinates,
    kind: "memory" as const,
    icon: stop.icon,
    thumbnailUrl: stop.thumbnailUrl,
    count: stop.memoryCount,
    memories: stop.memories,
  }));

  const mapMarkers: LeafletMapMarker[] = [
    ...planMarkers,
    ...memoryMarkers,
    ...liveMarkers,
  ];

  const routeBaseCoordinates = useMemo(
    () =>
      selectedDay
        ? [...selectedDayStops, ...selectedDayObjectStops].map((stop) => stop.coordinates)
        : journeyRouteCoordinates,
    [journeyRouteCoordinates, selectedDay, selectedDayObjectStops, selectedDayStops],
  );

  const routeRequestKey = useMemo(
    () =>
      routeBaseCoordinates
        .map(
          (coordinate) =>
            `${coordinate.latitude.toFixed(5)},${coordinate.longitude.toFixed(5)}`,
        )
        .join("|"),
    [routeBaseCoordinates],
  );

  useEffect(() => {
    const controller = new AbortController();

    if (routeBaseCoordinates.length < 2) {
      return () => controller.abort();
    }

    fetchRoadRoute(routeBaseCoordinates, controller.signal)
      .then((coordinates) => {
        setRoadRoute({
          key: routeRequestKey,
          coordinates: coordinates.length ? coordinates : routeBaseCoordinates,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRoadRoute({
            key: routeRequestKey,
            coordinates: routeBaseCoordinates,
          });
        }
      });

    return () => controller.abort();
  }, [routeBaseCoordinates, routeRequestKey]);

  const displayedRouteCoordinates =
    roadRoute?.key === routeRequestKey ? roadRoute.coordinates : routeBaseCoordinates;

  const mapRoutes: LeafletMapRoute[] = selectedDay
    ? [
        {
          id: "day-route",
          coordinates: displayedRouteCoordinates,
          color: "#047857",
        },
      ]
    : [
        {
          id: "hotel-route",
          coordinates: displayedRouteCoordinates,
          color: "#b45309",
        },
      ];

  const mappedStopCount =
    activePlanStops.length + visibleMemoryStops.length;
  const mapScopeLabel = selectedDay
    ? t("map.scopeDay", {
        day: selectedDay.dayTag ?? `D${selectedDay.dayNumber}`,
      })
    : t("map.scopeJourney");
  const unresolvedLocations = (locationRepair?.results ?? []).filter(
    (result) => result.status === "failed" || result.status === "ambiguous",
  );

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

  function handleMarkerClick(marker: LeafletMapMarker) {
    setSelectedMarker(marker);
    setSelectedMemoryId(marker.memories?.[0]?.id ?? null);
  }

  async function handleMapClick(coordinates: Coordinates) {
    if (!manualPinTarget?.locationText) return;
    const title = manualPinTarget.title || manualPinTarget.locationText;
    if (!window.confirm(t("map.repair.confirmPin", { title }))) return;

    try {
      await manualPinLocationClient({
        journeyId: tripId,
        itemType: manualPinTarget.itemType,
        itemId: manualPinTarget.itemId,
        locationText: manualPinTarget.locationText,
        title,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      });
      setManualPinTarget(null);
      await refreshMapObjects();
      setMapViewVersion((version) => version + 1);
    } catch (pinError) {
      setLocationRepair((current) => ({
        total: current?.total ?? 0,
        attempted: current?.attempted ?? 0,
        resolved: current?.resolved ?? 0,
        failed: current?.failed ?? 0,
        ambiguous: current?.ambiguous ?? 0,
        skipped: current?.skipped ?? 0,
        results: current?.results ?? [],
        isResolving: false,
        error: getErrorMessage(pinError, t("map.repair.manualPinError")),
      }));
    }
  }

  function selectMapView(dayId: string) {
    setSelectedDayId(dayId);
    setSelectedMarker(null);
    setSelectedMemoryId(null);
    setMapViewVersion((value) => value + 1);

    if (dayId === "journey") {
      writeTodayScopedValue(`otr:map-view:${tripId}`, "journey");
      return;
    }

    const day = days.find((plannerDay) => plannerDay.day.id === dayId);
    if (day) {
      writeTodayScopedValue(`otr:map-view:${tripId}`, day.day.dayDate);
      writeTodayScopedValue(`otr:planner-day:${tripId}`, day.day.dayDate);
      window.dispatchEvent(
        new CustomEvent("journey:workspace-day-change", {
          detail: { tripId, day: day.day.dayDate },
        }),
      );
    }
  }

  const selectedMemory =
    selectedMarker?.kind === "memory" && selectedMarker.memories?.length
      ? selectedMarker.memories.find((memory) => memory.id === selectedMemoryId) ??
        selectedMarker.memories[0]
      : null;
  const selectedMemoryImageUrl =
    selectedMemory?.mediaUrl && memoryImageUrls[selectedMemory.mediaUrl]
      ? memoryImageUrls[selectedMemory.mediaUrl]
      : selectedMarker?.thumbnailUrl;

  return (
    <section className="otr-journey-map fixed inset-0 z-10 bg-stone-100 md:left-[var(--otr-sidebar-width)]">
      {!mapResource.data && mapResource.isLoading ? (
        <div className="h-full w-full bg-gradient-to-br from-emerald-50 via-sky-50 to-stone-100" />
      ) : (
        <LeafletMapCanvas
          markers={mapMarkers}
          routes={mapRoutes}
          fitCoordinates={focusCoordinates}
          fitVersion={`${selectedDayId}-${mapViewVersion}-${showMemories ? "memories" : "base"}`}
          fallbackCenter={fallbackCenter}
          onMarkerClick={handleMarkerClick}
          onMapClick={handleMapClick}
        />
      )}

      <div className="pointer-events-none absolute left-16 right-2 top-2 z-[500] md:inset-x-0 md:top-0 md:p-5">
        <div className="pointer-events-auto rounded-2xl border border-white/60 bg-white/[0.62] p-2 shadow-lg backdrop-blur-md md:rounded-[28px] md:bg-white/[0.88] md:p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-emerald-900 md:tracking-[0.16em]">
                {trip?.name ? (
                  <TranslatedText
                    as="span"
                    className="block truncate"
                    showToggle={false}
                    sourceField="name"
                    sourceId={trip.id}
                    sourceType="trip"
                    text={trip.name}
                  />
                ) : (
                  t("map.title")
                )}
              </p>
              <p className="truncate text-[11px] font-bold text-stone-600">
                {selectedDay
                  ? `${selectedDay.dayTag ?? `D${selectedDay.dayNumber}`} · ${compactDate(selectedDay.day.dayDate, t)}`
                  : t("map.fullJourney")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <LiveLocationToggle
                tripId={tripId}
                compact
                onLocationSaved={handleLocationSaved}
              />
              <Link
                href={
                  selectedDay
                    ? `/trips/${tripId}/planner?date=${selectedDay.day.dayDate}`
                    : `/trips/${tripId}/planner`
                }
                className="grid size-9 place-items-center rounded-full bg-stone-100 text-stone-700 shadow-sm"
                title={t("map.openPlannerList")}
                aria-label={t("map.openPlannerList")}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                >
                  <path d="M8 6h13" />
                  <path d="M8 12h13" />
                  <path d="M8 18h13" />
                  <path d="M3 6h.01" />
                  <path d="M3 12h.01" />
                  <path d="M3 18h.01" />
                </svg>
              </Link>
              <button
                type="button"
                onClick={() => selectMapView("journey")}
                className={`rounded-full px-2.5 py-2 text-xs font-black shadow-sm ${
                  selectedDayId === "journey"
                    ? "bg-emerald-700 text-white"
                    : "bg-stone-100 text-stone-700"
                }`}
              >
                {t("map.fullJourney")}
              </button>
              <button
                type="button"
                onClick={() => setShowMemories((value) => !value)}
                className={`rounded-full px-2.5 py-2 text-xs font-black shadow-sm ${
                  showMemories
                    ? "bg-violet-700 text-white"
                    : "bg-stone-100 text-stone-700"
                }`}
              >
                {t("map.memoriesLayer")}
              </button>
              <button
                type="button"
                onClick={() =>
                  runLocationRepair(true, {
                    refitOnResolved: activePlanStops.length === 0,
                  })
                }
                disabled={locationRepair?.isResolving}
                className="rounded-full bg-white px-2.5 py-2 text-xs font-black text-emerald-800 shadow-sm disabled:opacity-60"
              >
                {locationRepair?.isResolving
                  ? t("map.repair.resolving")
                  : t("map.repair.action")}
              </button>
            </div>
          </div>

          {locationRepair ? (
            <p className="mt-2 truncate text-[11px] font-bold text-stone-600">
              {t("map.repair.visibleCount", {
                scope: mapScopeLabel,
                count: mappedStopCount,
              })}
              {locationRepair.isResolving
                ? ` · ${
                    locationRepair.total
                      ? t("map.repair.resolvingCount", {
                          count: locationRepair.total,
                        })
                      : t("map.repair.resolvingBackground")
                  }`
                : ` · ${t("map.repair.summary", {
                    resolved: locationRepair.resolved,
                    failed: locationRepair.failed,
                    ambiguous: locationRepair.ambiguous,
                  })}`}
              {locationRepair.error ? ` · ${locationRepair.error}` : ""}
              {manualPinTarget
                ? ` · ${t("map.repair.clickMap", {
                    title:
                      manualPinTarget.title ||
                      manualPinTarget.locationText ||
                      t("map.repair.unnamedLocation"),
                  })}`
                : ""}
            </p>
          ) : null}

          <div ref={dateStripRef} className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 md:gap-2">
            {days.map((day) => (
              (() => {
                const selected = selectedDayId === day.day.id;
                const isToday = day.day.dayDate === todayKey();
                const official = isOfficialTripDay(day.day.dayDate, trip);
                return (
                  <button
                    key={day.day.id}
                    data-map-day-id={day.day.id}
                    type="button"
                    onClick={() => selectMapView(day.day.id)}
                    className={`min-w-11 shrink-0 rounded-xl border px-2 py-1 text-center transition ${
                      selected
                        ? official
                          ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                          : "border-stone-500 bg-stone-700 text-white shadow-sm"
                        : isToday
                          ? "border-amber-300 bg-amber-50 text-amber-900 ring-2 ring-amber-200"
                        : official
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-dashed border-stone-200 bg-white/70 text-stone-400"
                    } ${selected && isToday ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-stone-50" : ""}`}
                    title={
                      official
                        ? t("planner.day.official")
                        : t("planner.day.buffer")
                    }
                  >
                    <p className="text-[11px] font-bold leading-tight">
                      {day.dayTag ??
                        t("planner.day.short", { number: day.dayNumber })}
                    </p>
                    <p className="text-[10px] leading-tight opacity-80">
                      {compactDate(day.day.dayDate, t)}
                    </p>
                  </button>
                );
              })()
            ))}
          </div>
        </div>

        {error ? (
          <p className="pointer-events-auto mt-3 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700 shadow-sm">
            {error}
          </p>
        ) : null}
        {mapResource.error && mapResource.data ? (
          <p className="pointer-events-auto mt-3 rounded-2xl bg-amber-50 p-3 text-xs font-bold text-amber-800 shadow-sm">
            {t("map.loadError")}
          </p>
        ) : null}
      </div>

      <div className="otr-mobile-map-floating-layer pointer-events-none absolute inset-x-0 z-[500] px-3 md:bottom-5 md:px-5">
        {!mapResource.data && mapResource.isLoading ? (
          <p className="pointer-events-auto mb-3 inline-flex h-11 items-center rounded-full bg-white px-4 text-sm font-black text-stone-600 shadow-lg">
            {t("map.loading")}
          </p>
        ) : null}

        {mapResource.data && mappedStopCount === 0 ? (
          <p className="pointer-events-auto mb-3 inline-flex h-11 items-center rounded-full bg-white px-4 text-sm font-black text-stone-600 shadow-lg">
            {t("map.noMappedStops")}
          </p>
        ) : null}

        {unresolvedLocations.length ? (
          <div className="pointer-events-auto mb-3 max-w-md rounded-2xl bg-white/95 p-3 text-sm shadow-lg backdrop-blur">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="font-black text-stone-900">
                {t("map.repair.unresolvedTitle")}
              </p>
              <button
                type="button"
                onClick={() =>
                  runLocationRepair(true, {
                    refitOnResolved: activePlanStops.length === 0,
                  })
                }
                className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-black text-white"
              >
                {t("map.repair.retry")}
              </button>
            </div>
            <div className="space-y-2">
              {unresolvedLocations.slice(0, 4).map((item) => (
                <div key={`${item.itemType}-${item.itemId}`} className="rounded-xl bg-stone-50 p-2">
                  <p className="line-clamp-1 font-bold text-stone-900">
                    {item.title || item.locationText ? (
                      <TranslatedText
                        as="span"
                        showToggle={false}
                        sourceField={item.title ? "title" : "location_text"}
                        sourceId={item.itemId}
                        sourceType="plan_item"
                        text={item.title || item.locationText}
                      />
                    ) : (
                      t("map.repair.unnamedLocation")
                    )}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="line-clamp-1 text-xs text-stone-600">
                      {item.locationText ? (
                        <TranslatedText
                          as="span"
                          showToggle={false}
                          sourceField="location_text"
                          sourceId={item.itemId}
                          sourceType="plan_item"
                          text={item.locationText}
                        />
                      ) : (
                        item.error || t("map.repair.needsManualConfirm")
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => setManualPinTarget(item)}
                      className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-black ${
                        manualPinTarget?.itemId === item.itemId
                          ? "bg-amber-100 text-amber-800"
                          : "bg-stone-200 text-stone-700"
                      }`}
                    >
                      {t("map.repair.manualPin")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {selectedMarker ? (
          <div className="pointer-events-auto rounded-[28px] border border-white/80 bg-white/95 p-4 shadow-2xl backdrop-blur md:max-w-md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                  {selectedMarker.kind === "memory"
                    ? t("map.memories")
                    : selectedMarker.kind === "hotel"
                      ? t("map.hotelRoute")
                      : selectedMarker.kind === "live"
                        ? t("map.live")
                        : t("map.dayRoute")}
                </p>
                <h2 className="mt-1 truncate text-xl font-black text-stone-950">
                  {selectedMarker.title || selectedMarker.label}
                </h2>
                {selectedMarker.label !== selectedMarker.title ? (
                  <p className="mt-1 text-sm font-black text-emerald-800">
                    {selectedMarker.label}
                  </p>
                ) : null}
                {selectedMarker.locationLabel || selectedMarker.subtitle ? (
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    {selectedMarker.locationLabel || selectedMarker.subtitle}
                  </p>
                ) : null}
                {selectedMarker.description ? (
                  <p className="mt-2 text-sm leading-6 text-stone-700">
                    {selectedMarker.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedMarker(null);
                  setSelectedMemoryId(null);
                }}
                className="rounded-full bg-stone-100 px-4 py-2 text-xs font-black text-stone-600"
              >
                {t("common.close")}
              </button>
            </div>
            {selectedMarker.kind === "memory" && selectedMemoryImageUrl ? (
              <div className="mt-4 overflow-hidden rounded-3xl bg-stone-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedMemoryImageUrl}
                  alt=""
                  className="max-h-72 w-full object-cover"
                />
                {selectedMarker.memories?.length ? (
                  <div className="grid grid-cols-4 gap-1 p-2">
                    {selectedMarker.memories.slice(0, 8).map((memory) => {
                      const imageUrl = memory.mediaUrl
                        ? memoryImageUrls[memory.mediaUrl]
                        : null;
                      return (
                        <button
                          type="button"
                          key={memory.id}
                          onClick={() => setSelectedMemoryId(memory.id)}
                          className={`relative aspect-square overflow-hidden rounded-xl bg-white text-left ring-offset-2 ${
                            selectedMemory?.id === memory.id
                              ? "ring-2 ring-emerald-700"
                              : "ring-0"
                          }`}
                        >
                          {imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imageUrl}
                              alt=""
                              className="size-full object-cover"
                            />
                          ) : null}
                          <span className="absolute left-1 top-1 rounded-full bg-white/85 px-1.5 py-0.5 text-[10px] font-black text-stone-700 shadow-sm">
                            {timeLabel(memory.capturedAt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={navigationHref(selectedMarker.coordinates, selectedMarker.label)}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-black text-white"
              >
                {t("map.openNavigation")}
              </a>
              {selectedMarker.kind === "memory" ? (
                <Link
                  href={`/trips/${tripId}/timeline${
                    selectedMarker.memories?.[0]
                      ? `?view=timeline&date=${dateKey(selectedMarker.memories[0].capturedAt)}`
                      : ""
                  }`}
                  className="rounded-full bg-stone-100 px-4 py-2 text-xs font-black text-stone-700"
                >
                  {t("map.openTimeline")}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

      </div>
    </section>
  );
}

export default function JourneyMapPage() {
  return <AuthGate>{() => <JourneyMapContent />}</AuthGate>;
}
