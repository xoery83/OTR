export type Coordinates = {
  latitude: number;
  longitude: number;
};

const earthRadiusMeters = 6_371_000;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function distanceMeters(from: Coordinates, to: Coordinates) {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

export function formatDistance(meters: number | null) {
  if (meters === null || !Number.isFinite(meters)) return "Distance unavailable";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function navigationHref(coordinates: Coordinates, label?: string | null) {
  const query = `${coordinates.latitude},${coordinates.longitude}`;
  const encodedLabel = label ? encodeURIComponent(label) : query;

  if (typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return `https://maps.apple.com/?ll=${query}&q=${encodedLabel}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function relativeTime(value: string | null) {
  if (!value) return "unknown";

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
