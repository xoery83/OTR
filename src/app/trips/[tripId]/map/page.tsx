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
import { geocodePlace } from "@/lib/geocoding";
import { getErrorMessage } from "@/lib/errors";
import { formatJourneyTime, journeyDateKey } from "@/lib/format";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getActiveJourneyMembers } from "@/lib/journeys/stats";
import {
  getJourneyLiveLocations,
  getJourneyMapObjects,
} from "@/lib/supabase/map";
import {
  getPlannerV2,
  type PlannerV2Data,
  type PlannerV2Day,
} from "@/lib/supabase/planner-v2";
import { getSignedMemoryImageUrls } from "@/lib/supabase/memories";
import { getTrip } from "@/lib/supabase/trips";
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

function memberInitial(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function dateKey(value: string | null | undefined) {
  return value?.slice(0, 10) ?? null;
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

function geocodeQuery(
  title: string | null | undefined,
  locationName: string | null | undefined,
) {
  const location = locationName?.trim();
  const name = title?.trim();
  if (location && name && !normalizeText(name).includes(normalizeText(location))) {
    return `${name}, ${location}`;
  }
  return location || name || "";
}

function shouldGeocodeQuery(query: string) {
  return /\d/.test(query) || query.includes(",");
}

function hasKnownCoordinates(
  objects: JourneyMapObject[],
  sourceType: string,
  sourceId: string | null,
  title: string | null | undefined,
  locationName: string | null | undefined,
  geocodedCoordinates: CoordinateLookup,
) {
  const object = findObjectForSource(
    objects,
    sourceType,
    sourceId,
    title ?? "",
    locationName ?? null,
  );
  return Boolean(
    getCoordinates(object ?? null) ??
      coordinateLookupValue(
        geocodedCoordinates,
        sourceType,
        sourceId,
        title,
        locationName,
      ),
  );
}

function approximatePlaceCoordinates(
  trip: Trip | null,
  title: string | null | undefined,
  locationName: string | null | undefined,
): Coordinates | null {
  const tripText = normalizeText(`${trip?.name ?? ""} ${trip?.destination ?? ""}`);
  const text = normalizeText(`${title ?? ""} ${locationName ?? ""}`);

  const aucklandPlaces: Array<{ keys: string[]; coordinates: Coordinates }> = [
    {
      keys: ["67 bell road", "bell road", "remuera"],
      coordinates: { latitude: -36.8799, longitude: 174.806 },
    },
    {
      keys: ["auckland airport", "akl airport"],
      coordinates: { latitude: -37.0082, longitude: 174.785 },
    },
    {
      keys: ["auckland", "newmarket"],
      coordinates: { latitude: -36.8485, longitude: 174.7633 },
    },
  ];

  if (
    tripText.includes("auckland") ||
    tripText.includes("new zealand") ||
    aucklandPlaces.some((place) =>
      place.keys.some((key) => text.includes(normalizeText(key))),
    )
  ) {
    const match = aucklandPlaces.find((place) =>
      place.keys.some((key) => text.includes(normalizeText(key))),
    );
    if (match) return match.coordinates;
  }

  const icelandPlaces: Array<{ keys: string[]; coordinates: Coordinates }> = [
    {
      keys: ["keflavik airport", "kef airport", "keflavik", "kef"],
      coordinates: { latitude: 63.985, longitude: -22.6056 },
    },
    {
      keys: ["blue lagoon"],
      coordinates: { latitude: 63.8804, longitude: -22.4495 },
    },
    {
      keys: ["reykjavik", "reykjavík"],
      coordinates: { latitude: 64.1466, longitude: -21.9426 },
    },
    {
      keys: ["gardavegur", "garðavegur", "hafnarfjordur", "hafnarfjörður"],
      coordinates: { latitude: 64.0671, longitude: -21.9377 },
    },
    {
      keys: ["costco", "bonus", "bonus supermarket"],
      coordinates: { latitude: 64.1016, longitude: -21.8837 },
    },
    {
      keys: ["stora mörk", "storamork", "stora-mork", "hvölsvollur", "hvolsvollur"],
      coordinates: { latitude: 63.7357, longitude: -20.2247 },
    },
    {
      keys: ["selfoss"],
      coordinates: { latitude: 63.9331, longitude: -20.9971 },
    },
    {
      keys: ["hella"],
      coordinates: { latitude: 63.8358, longitude: -20.4006 },
    },
    {
      keys: ["kirkjubaejarklaustur", "kirkjubæjarklaustur", "klaustur"],
      coordinates: { latitude: 63.7895, longitude: -18.058 },
    },
    {
      keys: ["skaftafell"],
      coordinates: { latitude: 64.0175, longitude: -16.9666 },
    },
    {
      keys: ["hofn", "höfn"],
      coordinates: { latitude: 64.2497, longitude: -15.202 },
    },
    {
      keys: ["egilsstadir", "egilsstaðir"],
      coordinates: { latitude: 65.2669, longitude: -14.3948 },
    },
    {
      keys: ["seyðisfjörður", "seydisfjordur"],
      coordinates: { latitude: 65.2609, longitude: -14.0108 },
    },
    {
      keys: ["myvatn", "mývatn", "lake myvatn"],
      coordinates: { latitude: 65.6039, longitude: -16.9961 },
    },
    {
      keys: ["akureyri"],
      coordinates: { latitude: 65.6885, longitude: -18.1262 },
    },
    {
      keys: ["husavik", "húsavík"],
      coordinates: { latitude: 66.0449, longitude: -17.3389 },
    },
    {
      keys: ["borgarnes"],
      coordinates: { latitude: 64.5383, longitude: -21.9206 },
    },
    {
      keys: ["stykkisholmur", "stykkishólmur"],
      coordinates: { latitude: 65.0757, longitude: -22.7298 },
    },
    {
      keys: ["grundarfjordur", "grundarfjörður", "kirkjufell"],
      coordinates: { latitude: 64.9243, longitude: -23.2631 },
    },
    {
      keys: ["golden circle", "thingvellir", "þingvellir", "geysir", "gullfoss"],
      coordinates: { latitude: 64.2559, longitude: -20.5193 },
    },
    {
      keys: ["seljalandsfoss"],
      coordinates: { latitude: 63.6156, longitude: -19.9886 },
    },
    {
      keys: ["skogafoss", "skógafoss"],
      coordinates: { latitude: 63.5321, longitude: -19.5114 },
    },
    {
      keys: ["vik", "vík"],
      coordinates: { latitude: 63.4186, longitude: -19.006 },
    },
    {
      keys: ["jokulsarlon", "jökulsárlón"],
      coordinates: { latitude: 64.0784, longitude: -16.2306 },
    },
    {
      keys: ["landmannalaugar"],
      coordinates: { latitude: 63.992, longitude: -19.061 },
    },
  ];

  if (
    !tripText.includes("iceland") &&
    !tripText.includes("reykjavik") &&
    !icelandPlaces.some((place) =>
      place.keys.some((key) => text.includes(normalizeText(key))),
    )
  ) {
    return null;
  }

  return (
    icelandPlaces.find((place) =>
      place.keys.some((key) => text.includes(normalizeText(key))),
    )?.coordinates ?? null
  );
}

function reservationStop(
  reservation: ItineraryReservation,
  day: PlannerV2Day,
  objects: JourneyMapObject[],
  label: string,
  kind: LeafletMapMarker["kind"],
  trip: Trip | null,
  geocodedCoordinates: CoordinateLookup,
): MapStop | null {
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
    ) ??
    approximatePlaceCoordinates(trip, reservation.title, reservation.locationName);
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
  trip: Trip | null,
  geocodedCoordinates: CoordinateLookup,
): MapStop | null {
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
    ) ??
    approximatePlaceCoordinates(trip, event.title, event.locationName);
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
  trip: Trip | null,
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
          trip,
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
        const stop = eventStop(activity, day, objects, trip, geocodedCoordinates);
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
  trip: Trip | null,
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
    linkedMemoryCoordinates(memory, days, objects, trip, geocodedCoordinates) ??
    coordinateLookupValue(
      geocodedCoordinates,
      "memory",
      memory.id,
      memory.content,
      memory.locationName,
    ) ??
    approximatePlaceCoordinates(trip, memory.content, memory.locationName);
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

function coordinatesBounds(coordinates: Coordinates[]) {
  if (!coordinates.length) return null;

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  return {
    minLat: Math.min(...latitudes),
    maxLat: Math.max(...latitudes),
    minLon: Math.min(...longitudes),
    maxLon: Math.max(...longitudes),
  };
}

function containsCoordinate(bounds: ReturnType<typeof coordinatesBounds>, coordinate: Coordinates) {
  if (!bounds) return true;

  const latPadding = Math.max(0.2, (bounds.maxLat - bounds.minLat) * 0.25);
  const lonPadding = Math.max(0.2, (bounds.maxLon - bounds.minLon) * 0.25);
  return (
    coordinate.latitude >= bounds.minLat - latPadding &&
    coordinate.latitude <= bounds.maxLat + latPadding &&
    coordinate.longitude >= bounds.minLon - lonPadding &&
    coordinate.longitude <= bounds.maxLon + lonPadding
  );
}

function destinationFallbackCenter(trip: Trip | null): Coordinates {
  const destination = normalizeText(`${trip?.name ?? ""} ${trip?.destination ?? ""}`);

  if (destination.includes("faroe")) return { latitude: 62.0079, longitude: -6.7909 };
  if (destination.includes("greenland")) return { latitude: 71.7069, longitude: -42.6043 };
  if (destination.includes("iceland") || destination.includes("reykjavik")) {
    return { latitude: 64.9631, longitude: -19.0208 };
  }
  if (destination.includes("auckland")) return { latitude: -36.8485, longitude: 174.7633 };
  if (destination.includes("new zealand")) return { latitude: -41.2865, longitude: 174.7762 };

  return { latitude: 64.9631, longitude: -19.0208 };
}

function destinationFallbackBounds(trip: Trip | null) {
  const destination = normalizeText(`${trip?.name ?? ""} ${trip?.destination ?? ""}`);

  if (destination.includes("faroe")) {
    return { minLat: 61.35, maxLat: 62.45, minLon: -7.8, maxLon: -6.1 };
  }
  if (destination.includes("greenland")) {
    return { minLat: 59.5, maxLat: 83.7, minLon: -73, maxLon: -11 };
  }
  if (destination.includes("iceland") || destination.includes("reykjavik")) {
    return { minLat: 63.0, maxLat: 67.2, minLon: -25.5, maxLon: -13.0 };
  }
  if (destination.includes("auckland")) {
    return { minLat: -37.2, maxLat: -36.55, minLon: 174.45, maxLon: 175.15 };
  }
  if (destination.includes("new zealand")) {
    return { minLat: -47.5, maxLat: -34.0, minLon: 166.0, maxLon: 179.0 };
  }

  return null;
}

function boundsToCoordinates(
  bounds: NonNullable<ReturnType<typeof coordinatesBounds>>,
): Coordinates[] {
  return [
    { latitude: bounds.minLat, longitude: bounds.minLon },
    { latitude: bounds.maxLat, longitude: bounds.maxLon },
  ];
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
  const [geocodedCoordinates, setGeocodedCoordinates] = useState<CoordinateLookup>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const dateStripRef = useRef<HTMLDivElement | null>(null);

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
        const requestedDayId = getQueryMapViewId(requestedDate, planner.days);
        const nextSelectedDayId =
          requestedDayId ??
          getStoredMapViewId(tripId, planner.days) ??
          getDefaultDayId(planner.days);
        setSelectedDayId(nextSelectedDayId);
        if (requestedDayId && requestedDate) {
          writeTodayScopedValue(`otr:map-view:${tripId}`, requestedDate);
          writeTodayScopedValue(`otr:planner-day:${tripId}`, requestedDate);
        }
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
  }, [requestedDate, t, tripId]);

  const selectedDay = useMemo(
    () => days.find((day) => day.day.id === selectedDayId) ?? null,
    [days, selectedDayId],
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

  const geocodeTargets = useMemo(() => {
    const targets = new Map<string, string>();

    days.forEach((day) => {
      day.reservations.forEach((reservation) => {
        const key = coordinateLookupKey(
          "itinerary_reservation",
          reservation.id,
          reservation.title,
          reservation.locationName,
        );
        if (
          hasKnownCoordinates(
            mapObjects,
            "itinerary_reservation",
            reservation.id,
            reservation.title,
            reservation.locationName,
            geocodedCoordinates,
          )
        ) {
          return;
        }

        const query = geocodeQuery(reservation.title, reservation.locationName);
        if (query.length >= 4 && shouldGeocodeQuery(query)) {
          targets.set(key, query);
        }
      });

      day.activities.forEach((activity) => {
        const key = coordinateLookupKey(
          "itinerary_event",
          activity.id,
          activity.title,
          activity.locationName,
        );
        if (
          hasKnownCoordinates(
            mapObjects,
            "itinerary_event",
            activity.id,
            activity.title,
            activity.locationName,
            geocodedCoordinates,
          )
        ) {
          return;
        }

        const query = geocodeQuery(activity.title, activity.locationName);
        if (query.length >= 4 && shouldGeocodeQuery(query)) {
          targets.set(key, query);
        }
      });

      day.memories.forEach((memory) => {
        if (memory.type !== "photo") return;
        const key = coordinateLookupKey(
          "memory",
          memory.id,
          memory.content,
          memory.locationName,
        );
        if (
          hasKnownCoordinates(
            mapObjects,
            "memory",
            memory.id,
            memory.content,
            memory.locationName,
            geocodedCoordinates,
          )
        ) {
          return;
        }

        const query = geocodeQuery(memory.content, memory.locationName);
        if (query.length >= 4 && shouldGeocodeQuery(query)) {
          targets.set(key, query);
        }
      });
    });

    return [...targets.entries()].map(([key, query]) => ({ key, query }));
  }, [days, geocodedCoordinates, mapObjects]);

  useEffect(() => {
    if (!geocodeTargets.length) return;

    const controller = new AbortController();

    async function resolveCoordinates() {
      const resolved: CoordinateLookup = {};

      for (const target of geocodeTargets.slice(0, 12)) {
        if (controller.signal.aborted) return;
        const coordinates = await geocodePlace(target.query, controller.signal).catch(
          () => null,
        );
        if (coordinates) resolved[target.key] = coordinates;
      }

      if (!controller.signal.aborted && Object.keys(resolved).length) {
        setGeocodedCoordinates((current) => ({ ...current, ...resolved }));
      }
    }

    resolveCoordinates();

    return () => controller.abort();
  }, [geocodeTargets]);

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
              trip,
              geocodedCoordinates,
            );
            return stop ? [stop] : [];
          }),
      ),
    [days, geocodedCoordinates, mapObjects, trip],
  );

  const hotelObjectStops = useMemo(
    () =>
      mapObjects.flatMap((object) => {
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
    [mapObjects],
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
                trip,
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
            trip,
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

          const stop = eventStop(activity, day, mapObjects, trip, geocodedCoordinates);
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
    [days, geocodedCoordinates, mapObjects, trip],
  );

  const journeyObjectStops = useMemo(
    () =>
      mapObjects.flatMap((object) => {
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
    [hotelStops.length, mapObjects],
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
            trip,
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
        trip,
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
        trip,
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
            trip,
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
  }, [days, geocodedCoordinates, mapObjects, selectedDay, t, trip]);

  const memoryStops = useMemo(
    () =>
      days.flatMap((day) =>
        day.memories.flatMap((memory) => {
          const stop = memoryStop(
            memory,
            mapObjects,
            days,
            trip,
            geocodedCoordinates,
            memoryImageUrls,
          );
          return stop ? [stop] : [];
        }),
      ),
    [days, geocodedCoordinates, mapObjects, memoryImageUrls, trip],
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
  const fallbackCenter = useMemo(() => destinationFallbackCenter(trip), [trip]);
  const fallbackBounds = useMemo(() => destinationFallbackBounds(trip), [trip]);
  const activePlanStops = selectedDay
    ? selectedDayStops
    : journeyStops.length
      ? journeyStops
      : journeyObjectStops;
  const focusCoordinates = useMemo(
    () =>
      activePlanStops.length
        ? activePlanStops.map((stop) => stop.coordinates)
        : fallbackBounds
          ? boundsToCoordinates(fallbackBounds)
          : [fallbackCenter],
    [activePlanStops, fallbackBounds, fallbackCenter],
  );
  const planBounds =
    coordinatesBounds(focusCoordinates) ?? fallbackBounds;

  const liveMarkers = memberLocations.flatMap((memberLocation) => {
    const coordinates = getCoordinates(memberLocation.location);
    if (!coordinates || !memberLocation.member.userId) return [];
    if (!containsCoordinate(planBounds, coordinates)) return [];

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

  const outsideLiveMembers = memberLocations.filter((memberLocation) => {
    const coordinates = getCoordinates(memberLocation.location);
    return coordinates && !containsCoordinate(planBounds, coordinates);
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
        ? selectedDayStops.map((stop) => stop.coordinates)
        : journeyRouteCoordinates,
    [journeyRouteCoordinates, selectedDay, selectedDayStops],
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

  function handleOutsideMemberClick(memberLocation: MemberLocation) {
    const coordinates = getCoordinates(memberLocation.location);
    if (!coordinates || !memberLocation.member.userId) return;

    setSelectedMarker({
      id: `outside-live-${memberLocation.member.userId}`,
      label: memberLocation.member.displayName,
      subtitle: liveLocationDescription(memberLocation, currentUserId, t),
      title:
        memberLocation.member.userId === currentUserId
          ? t("map.currentUser")
          : memberLocation.member.displayName,
      description: liveLocationDescription(memberLocation, currentUserId, t),
      coordinates,
      status: memberLocation.status,
      kind: "live",
      icon: "live",
    });
    setSelectedMemoryId(null);
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
    <section className="otr-journey-map fixed inset-0 z-10 bg-stone-100 md:left-44">
      {isLoading ? (
        <div className="h-full w-full bg-gradient-to-br from-emerald-50 via-sky-50 to-stone-100" />
      ) : (
        <LeafletMapCanvas
          markers={mapMarkers}
          routes={mapRoutes}
          fitCoordinates={focusCoordinates}
          fitVersion={`${selectedDayId}-${mapViewVersion}-${showMemories ? "memories" : "base"}`}
          fallbackCenter={fallbackCenter}
          onMarkerClick={handleMarkerClick}
        />
      )}

      <div className="pointer-events-none absolute left-16 right-2 top-2 z-[500] md:inset-x-0 md:top-0 md:p-5">
        <div className="pointer-events-auto rounded-2xl border border-white/60 bg-white/[0.62] p-2 shadow-lg backdrop-blur-md md:rounded-[28px] md:bg-white/[0.88] md:p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-emerald-900 md:tracking-[0.16em]">
                {trip?.name || t("map.title")}
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
            </div>
          </div>

          <div ref={dateStripRef} className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 md:gap-2">
            {days.map((day) => (
              (() => {
                const selected = selectedDayId === day.day.id;
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
                        : official
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-dashed border-stone-200 bg-white/70 text-stone-400"
                    }`}
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
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-20 z-[500] px-3 md:bottom-5 md:px-5">
        {isLoading ? (
          <p className="pointer-events-auto mb-3 inline-flex rounded-full bg-white px-4 py-2 text-sm font-black text-stone-600 shadow-lg">
            {t("map.loading")}
          </p>
        ) : null}

        {!isLoading && mappedStopCount === 0 ? (
          <p className="pointer-events-auto mb-3 inline-flex rounded-full bg-white px-4 py-2 text-sm font-black text-stone-600 shadow-lg">
            {t("map.noMappedStops")}
          </p>
        ) : null}

        {outsideLiveMembers.length ? (
          <div className="mb-3 flex justify-start gap-2 md:justify-end">
            {outsideLiveMembers.slice(0, 3).map((memberLocation) => {
              const coordinates = getCoordinates(memberLocation.location);
              if (!coordinates) return null;

              return (
                <button
                  key={memberLocation.member.id}
                  type="button"
                  onClick={() => handleOutsideMemberClick(memberLocation)}
                  className="pointer-events-auto grid size-10 place-items-center rounded-2xl bg-white/[0.85] text-xs font-black text-emerald-800 shadow-lg backdrop-blur"
                  aria-label={memberLocation.member.displayName}
                >
                  {memberInitial(memberLocation.member.displayName)}
                </button>
              );
            })}
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
                      ? `?date=${dateKey(selectedMarker.memories[0].capturedAt)}`
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
