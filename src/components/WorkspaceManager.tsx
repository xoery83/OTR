"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { getTrip } from "@/lib/supabase/trips";
import {
  clearSavedWorkspace,
  getWorkspaceDay,
  getWorkspaceModule,
  getWorkspaceTripId,
  readSavedWorkspace,
  shouldSaveWorkspacePath,
  writeSavedWorkspace,
  type SavedWorkspace,
} from "@/lib/workspace";

type DayChangeEvent = CustomEvent<{
  tripId?: string | null;
  day?: string | null;
}>;

function isSafeRestorePath(pathname: string) {
  return pathname.startsWith("/") && !pathname.startsWith("//");
}

function restoreScroll(scrollY: number) {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      window.scrollTo({ top: Math.max(0, scrollY), behavior: "instant" });
    }, 120);
  });
}

export function WorkspaceManager() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const restoreScrollYRef = useRef<number | null>(null);
  const isRestoringRef = useRef(false);
  const latestDayRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const currentSearch = searchParams.toString();
  const currentSearchWithPrefix = currentSearch ? `?${currentSearch}` : "";
  const shouldSkipHomeRestore = searchParams.get("home") === "1";

  const createWorkspace = useCallback((): SavedWorkspace | null => {
    if (!shouldSaveWorkspacePath(pathname)) return null;

    const tripId = getWorkspaceTripId(pathname);
    const day =
      latestDayRef.current ?? getWorkspaceDay(pathname, currentSearchWithPrefix, tripId);

    return {
      tripId,
      module: getWorkspaceModule(pathname),
      day,
      pathname,
      search: currentSearchWithPrefix,
      scrollY: window.scrollY,
      timestamp: Date.now(),
    };
  }, [currentSearchWithPrefix, pathname]);

  const saveWorkspace = useCallback(() => {
    if (isRestoringRef.current) return;
    const workspace = createWorkspace();
    if (workspace) {
      writeSavedWorkspace(workspace);
    }
  }, [createWorkspace]);

  const saveWorkspaceDebounced = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveWorkspace();
    }, 250);
  }, [saveWorkspace]);

  useEffect(() => {
    if (pathname !== "/") return;
    if (shouldSkipHomeRestore) return;

    let isMounted = true;

    async function restoreWorkspace() {
      const saved = readSavedWorkspace();
      if (!saved || !isSafeRestorePath(saved.pathname)) return;
      if (!shouldSaveWorkspacePath(saved.pathname)) return;

      try {
        if (saved.tripId) {
          await getTrip(saved.tripId);
          if (saved.day) {
            window.localStorage.setItem(`otr:planner-day:${saved.tripId}`, saved.day);
          }
        }

        if (!isMounted) return;
        isRestoringRef.current = true;
        restoreScrollYRef.current = saved.scrollY;
        router.replace(`${saved.pathname}${saved.search ?? ""}`);
      } catch {
        clearSavedWorkspace();
      }
    }

    restoreWorkspace();

    return () => {
      isMounted = false;
    };
  }, [pathname, router, shouldSkipHomeRestore]);

  useEffect(() => {
    if (restoreScrollYRef.current === null) return;

    const scrollY = restoreScrollYRef.current;
    restoreScrollYRef.current = null;
    restoreScroll(scrollY);

    const finishTimer = window.setTimeout(() => {
      isRestoringRef.current = false;
    }, 650);

    return () => {
      window.clearTimeout(finishTimer);
    };
  }, [pathname, currentSearchWithPrefix]);

  useEffect(() => {
    latestDayRef.current = getWorkspaceDay(
      pathname,
      currentSearchWithPrefix,
      getWorkspaceTripId(pathname),
    );
    saveWorkspace();
  }, [currentSearchWithPrefix, pathname, saveWorkspace]);

  useEffect(() => {
    function handleScroll() {
      saveWorkspaceDebounced();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        saveWorkspace();
      }
    }

    function handlePageHide() {
      saveWorkspace();
    }

    function handleDayChange(event: Event) {
      const { day } = (event as DayChangeEvent).detail ?? {};
      latestDayRef.current = day ?? null;
      saveWorkspace();
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    window.addEventListener("journey:workspace-day-change", handleDayChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      window.removeEventListener("journey:workspace-day-change", handleDayChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [saveWorkspace, saveWorkspaceDebounced]);

  return null;
}
