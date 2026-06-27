import { readTodayScopedValue } from "./day-view-storage";

export const LAST_WORKSPACE_KEY = "journey:lastWorkspace";

export type WorkspaceModule =
  | "Home"
  | "Planner"
  | "Memories"
  | "Gallery"
  | "Finance"
  | "Settings"
  | "Map"
  | "People"
  | "Journey";

export type SavedWorkspace = {
  tripId: string | null;
  module: WorkspaceModule;
  day: string | null;
  pathname: string;
  search: string;
  scrollY: number;
  timestamp: number;
  selectedMemory?: string | null;
  selectedExpense?: string | null;
  openSidebar?: boolean;
  searchKeywords?: string | null;
  activeFilters?: Record<string, unknown> | null;
  mapCameraPosition?: Record<string, unknown> | null;
};

const TRIP_ROUTE_PATTERN =
  /^\/trips\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

const SKIPPED_PATHS = [
  "/login",
  "/auth/callback",
  "/invite",
];

export function getWorkspaceTripId(pathname: string) {
  return pathname.match(TRIP_ROUTE_PATTERN)?.[1] ?? null;
}

export function shouldSaveWorkspacePath(pathname: string) {
  if (pathname === "/") return false;
  return !SKIPPED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function getWorkspaceModule(pathname: string): WorkspaceModule {
  if (pathname === "/") return "Home";
  if (pathname.includes("/planner")) return "Planner";
  if (pathname.includes("/timeline") || pathname.includes("/days/")) {
    return "Memories";
  }
  if (pathname.includes("/highlights")) return "Gallery";
  if (pathname.includes("/ledger")) return "Finance";
  if (pathname.includes("/map")) return "Map";
  if (pathname.includes("/people") || pathname === "/people") return "People";
  if (pathname.includes("/settings") || pathname === "/profile") return "Settings";
  if (pathname.startsWith("/trips/")) return "Journey";
  return "Home";
}

export function getWorkspaceDay(pathname: string, search: string, tripId: string | null) {
  const dayPathMatch = pathname.match(/\/days\/(\d{4}-\d{2}-\d{2})(?:\/|$)/);
  if (dayPathMatch?.[1]) return dayPathMatch[1];

  const dateParam = new URLSearchParams(search).get("date");
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return dateParam;
  }

  if (tripId && typeof window !== "undefined") {
    return readTodayScopedValue(`otr:planner-day:${tripId}`);
  }

  return null;
}

export function isValidSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<SavedWorkspace>;
  return (
    typeof workspace.pathname === "string" &&
    workspace.pathname.startsWith("/") &&
    typeof workspace.timestamp === "number" &&
    typeof workspace.scrollY === "number"
  );
}

export function readSavedWorkspace() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(LAST_WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidSavedWorkspace(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSavedWorkspace(workspace: SavedWorkspace) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, JSON.stringify(workspace));
}

export function clearSavedWorkspace() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LAST_WORKSPACE_KEY);
}
