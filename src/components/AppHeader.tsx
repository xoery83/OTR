"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/lib/supabase/auth";
import { getTrip } from "@/lib/supabase/trips";

function getActiveTripId(pathname: string) {
  return pathname.match(/^\/trips\/([^/]+)/)?.[1] ?? null;
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const tripId = getActiveTripId(pathname);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [journeyName, setJourneyName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadJourneyName() {
      if (!tripId) {
        setJourneyName(null);
        return;
      }

      try {
        const trip = await getTrip(tripId);
        if (isMounted) setJourneyName(trip.name);
      } catch {
        if (isMounted) setJourneyName("Journey");
      }
    }

    loadJourneyName();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  async function handleLogout() {
    await logout();
    setIsMenuOpen(false);
    router.push("/login");
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-emerald-100 bg-[#fffdf8]/95 backdrop-blur md:hidden">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="flex min-w-0 items-center gap-3 text-left"
            aria-label="Open OTR menu"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
              O
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold tracking-wide text-stone-950">
                OTR
              </p>
              <p className="truncate text-xs font-medium text-stone-500">
                journeys and memories
              </p>
            </div>
          </button>
          <Link
            href="/trips"
            className="max-w-[46vw] truncate rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            {journeyName ? `${journeyName} ▾` : "Journeys"}
          </Link>
        </div>
      </header>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-stone-950/30"
            onClick={() => setIsMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[82vw] bg-[#fffdf8] p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
                O
              </span>
              <div>
                <p className="text-lg font-semibold text-stone-950">OTR</p>
                <p className="text-xs font-medium text-stone-500">
                  Global app menu
                </p>
              </div>
            </div>
            <nav className="mt-7 grid gap-2">
              {[
                ["Profile", "/profile"],
                ["Settings", "/settings"],
                ["Notifications", "/settings"],
                ["Sync Status", "/settings"],
                ["Offline Data", "/settings"],
                ["Help", "/settings"],
              ].map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-stone-700 shadow-sm"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-5 w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-bold text-white"
            >
              Logout
            </button>
          </aside>
        </div>
      ) : null}
    </>
  );
}
