"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  LatLngBoundsExpression,
  LayerGroup,
  Map as LeafletMap,
} from "leaflet";
import type { Coordinates } from "@/lib/geo";

export type LeafletMapMarker = {
  id: string;
  label: string;
  coordinates: Coordinates;
  status?: "live" | "stale" | "offline";
  kind?: "live" | "hotel" | "plan" | "memory" | "place";
  icon?:
    | "activity"
    | "car"
    | "ferry"
    | "flight"
    | "hotel"
    | "live"
    | "meal"
    | "memory"
    | "note"
    | "place"
    | "shopping"
    | "start"
    | "tour"
    | "transport";
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  count?: number;
};

export type LeafletMapRoute = {
  id: string;
  coordinates: Coordinates[];
  color?: string;
};

type LeafletMapCanvasProps = {
  markers: LeafletMapMarker[];
  routes?: LeafletMapRoute[];
  fitCoordinates?: Coordinates[];
  fitVersion?: string | number;
  fallbackCenter?: Coordinates;
  onMarkerClick?: (marker: LeafletMapMarker) => void;
};

function markerColor(marker: LeafletMapMarker) {
  if (marker.kind === "hotel") return "#b45309";
  if (marker.kind === "memory") return "#7c3aed";
  if (marker.kind === "plan") return "#047857";
  if (marker.kind === "place") return "#2563eb";
  const status = marker.status;
  if (status === "offline") return "#a8a29e";
  if (status === "stale") return "#f59e0b";
  return "#047857";
}

function averageCoordinates(coordinates: Coordinates[]) {
  if (!coordinates.length) return null;

  const total = coordinates.reduce(
    (sum, coordinate) => ({
      latitude: sum.latitude + coordinate.latitude,
      longitude: sum.longitude + coordinate.longitude,
    }),
    { latitude: 0, longitude: 0 },
  );

  return {
    latitude: total.latitude / coordinates.length,
    longitude: total.longitude / coordinates.length,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markerIconSvg(icon: LeafletMapMarker["icon"]) {
  const stroke = 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  const svg = (body: string) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" ${stroke}>${body}</svg>`;

  switch (icon) {
    case "flight":
      return svg('<path d="M2 16l20-9-9 20-2-8-9-3z" /><path d="M11 19l3-7" />');
    case "hotel":
      return svg('<path d="M3 11V5" /><path d="M21 19v-7a3 3 0 0 0-3-3H8v10" /><path d="M3 19h18" /><path d="M3 11h5" />');
    case "car":
      return svg('<path d="M5 17h14" /><path d="M7 17l1-5h8l1 5" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" />');
    case "ferry":
      return svg('<path d="M4 15l2-7h12l2 7" /><path d="M3 18c2 1 4 1 6 0s4-1 6 0 4 1 6 0" />');
    case "meal":
      return svg('<path d="M7 3v8" /><path d="M5 3v4" /><path d="M9 3v4" /><path d="M17 3v18" /><path d="M14 7c0-2 1-4 3-4" />');
    case "shopping":
      return svg('<path d="M6 6h15l-2 8H8L6 3H3" /><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" />');
    case "tour":
      return svg('<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3z" />');
    case "memory":
      return svg('<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 15l3-3 2 2 2-3 3 4" /><circle cx="9" cy="9" r="1" />');
    case "live":
      return svg('<circle cx="12" cy="12" r="3" /><path d="M12 2v3" /><path d="M12 19v3" /><path d="M2 12h3" /><path d="M19 12h3" />');
    case "start":
      return svg('<path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" />');
    case "transport":
      return svg('<path d="M6 17h12" /><path d="M8 17V7h8v10" /><path d="M9 21h6" /><path d="M9 11h6" />');
    case "note":
      return svg('<path d="M6 3h9l3 3v15H6z" /><path d="M14 3v4h4" /><path d="M9 12h6" /><path d="M9 16h6" />');
    case "activity":
      return svg('<path d="M13 4l-2 5 5 2-5 9" /><path d="M6 12l5-3" /><circle cx="14" cy="4" r="2" />');
    case "place":
    default:
      return svg('<path d="M12 21s7-5.4 7-11a7 7 0 0 0-14 0c0 5.6 7 11 7 11z" /><circle cx="12" cy="10" r="2" />');
  }
}

function markerIconName(marker: LeafletMapMarker): LeafletMapMarker["icon"] {
  if (marker.icon) return marker.icon;
  if (marker.kind === "hotel") return "hotel";
  if (marker.kind === "memory") return "memory";
  if (marker.kind === "live") return "live";
  if (marker.kind === "plan") return "activity";
  return "place";
}

export function LeafletMapCanvas({
  markers,
  routes = [],
  fitCoordinates = [],
  fitVersion,
  fallbackCenter = { latitude: 64.9631, longitude: -19.0208 },
  onMarkerClick,
}: LeafletMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);

  const center = useMemo(
    () => averageCoordinates(fitCoordinates) ?? fallbackCenter,
    [fallbackCenter, fitCoordinates],
  );

  useEffect(() => {
    let isMounted = true;

    async function createMap() {
      if (!containerRef.current || mapRef.current) return;

      const L = await import("leaflet");
      if (!isMounted || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        attributionControl: true,
        zoomControl: true,
      }).setView([fallbackCenter.latitude, fallbackCenter.longitude], 5);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      routeLayerRef.current = L.layerGroup().addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
    }

    createMap();
    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      routeLayerRef.current = null;
    };
  }, [fallbackCenter.latitude, fallbackCenter.longitude]);

  useEffect(() => {
    let isMounted = true;

    async function drawMarkers() {
      const map = mapRef.current;
      const layer = layerRef.current;
      const routeLayer = routeLayerRef.current;
      if (!map || !layer) return;

      const L = await import("leaflet");
      if (!isMounted) return;

      layer.clearLayers();
      routeLayer?.clearLayers();

      routes.forEach((route) => {
        if (route.coordinates.length < 2) return;
        const polyline = L.polyline(
          route.coordinates.map((coordinates) => [
            coordinates.latitude,
            coordinates.longitude,
          ]),
          {
            color: route.color ?? "#047857",
            opacity: 0.82,
            weight: 4,
            dashArray: route.id.includes("day") ? undefined : "8 8",
          },
        );
        polyline.addTo(routeLayer ?? layer);
      });

      markers.forEach((marker) => {
        const color = markerColor(marker);
        const label = escapeHtml(marker.label);
        const markerHtml = marker.thumbnailUrl
          ? `<span class="otr-map-photo-marker"><img src="${escapeHtml(marker.thumbnailUrl)}" alt="" /><b>${marker.count ?? ""}</b></span>`
          : `<span class="otr-map-marker" style="--marker-color:${color}"><span class="otr-map-marker-icon">${markerIconSvg(markerIconName(marker))}</span><span class="otr-map-marker-label">${label}</span></span>`;
        const icon = L.divIcon({
          html: markerHtml,
          className: "otr-leaflet-marker",
          iconSize: marker.thumbnailUrl ? [54, 54] : [84, 34],
          iconAnchor: marker.thumbnailUrl ? [27, 27] : [42, 17],
        });
        const mapMarker = L.marker(
          [marker.coordinates.latitude, marker.coordinates.longitude],
          { icon },
        )
          .bindPopup(
            marker.subtitle
              ? `<strong>${marker.label}</strong><br />${marker.subtitle}`
              : marker.label,
          )
          .on("click", () => onMarkerClick?.(marker));

        mapMarker.addTo(layer);
      });

      map.invalidateSize();
    }

    drawMarkers();
    return () => {
      isMounted = false;
    };
  }, [markers, onMarkerClick, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const boundCoordinates = fitCoordinates;

    if (boundCoordinates.length) {
      const bounds = boundCoordinates.map(
        (marker) =>
          [marker.latitude, marker.longitude] as [
            number,
            number,
          ],
      ) as LatLngBoundsExpression;
      map.fitBounds(bounds, { maxZoom: 14, padding: [36, 36] });
    } else {
      map.setView([center.latitude, center.longitude], 5);
    }

  }, [
    center.latitude,
    center.longitude,
    fitCoordinates,
    fitVersion,
  ]);

  return <div ref={containerRef} className="h-full min-h-[360px] w-full" />;
}
