function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

function savedAtKey(key: string) {
  return `${key}:saved-at`;
}

export function isTodayTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return false;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}` === todayKey();
}

export function readTodayScopedValue(key: string) {
  if (typeof window === "undefined") return null;

  const savedAt = window.localStorage.getItem(savedAtKey(key));
  if (savedAt !== todayKey()) {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(savedAtKey(key));
    return null;
  }

  return window.localStorage.getItem(key);
}

export function writeTodayScopedValue(key: string, value: string) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(key, value);
  window.localStorage.setItem(savedAtKey(key), todayKey());
}
