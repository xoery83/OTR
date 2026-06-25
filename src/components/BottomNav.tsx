"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const moreItems = [
  { label: "Timeline", href: "timeline" },
  { label: "Ledger", href: "ledger" },
  { label: "People", href: "people" },
  { label: "Highlights", href: "highlights" },
  { label: "Media", href: null },
  { label: "Documents", href: null },
  { label: "Export", href: null },
  { label: "Journey Settings", href: null },
] as const;

function getActiveTripId(pathname: string) {
  const match = pathname.match(/^\/trips\/([^/]+)/);
  const tripId = match?.[1];

  if (
    tripId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      tripId,
    )
  ) {
    return tripId;
  }

  return null;
}

function baseItemClass(active: boolean) {
  return `flex flex-col items-center justify-center rounded-2xl px-1 text-[11px] font-bold transition ${
    active
      ? "bg-emerald-50 text-emerald-800"
      : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
  }`;
}

function captureItemClass(active: boolean) {
  return `-mt-6 flex h-[76px] flex-col items-center justify-center rounded-3xl bg-emerald-700 px-1 text-xs font-black text-white shadow-lg shadow-emerald-900/20 transition ${
    active ? "ring-4 ring-emerald-100" : ""
  }`;
}

export function BottomNav() {
  const pathname = usePathname();
  const activeTripId = getActiveTripId(pathname);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  if (!activeTripId) {
    return (
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 shadow-[0_-10px_30px_rgba(28,25,23,0.08)] backdrop-blur md:hidden">
        <div className="mx-auto grid h-20 max-w-3xl grid-cols-5 items-end gap-1 px-2 pb-2 pt-2">
          <Link href="/" className={baseItemClass(pathname === "/")}>
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            Home
          </Link>
          <Link
            href="/trips"
            className={baseItemClass(pathname.startsWith("/trips"))}
          >
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            Journeys
          </Link>
          <Link href="/trips" className={captureItemClass(false)}>
            <span className="text-2xl leading-none">+</span>
            Capture
          </Link>
          <Link
            href="/people"
            className={baseItemClass(pathname.startsWith("/people"))}
          >
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            People
          </Link>
          <Link
            href="/profile"
            className={baseItemClass(pathname.startsWith("/profile"))}
          >
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            Profile
          </Link>
        </div>
      </nav>
    );
  }

  const overviewHref = `/trips/${activeTripId}`;
  const plannerHref = `/trips/${activeTripId}/planner`;
  const captureHref = `/trips/${activeTripId}/capture`;
  const mapHref = `/trips/${activeTripId}/map`;
  const moreActive = moreItems.some(
    (item) => item.href && pathname === `/trips/${activeTripId}/${item.href}`,
  );

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 shadow-[0_-10px_30px_rgba(28,25,23,0.08)] backdrop-blur md:hidden">
        <div className="mx-auto grid h-20 max-w-3xl grid-cols-5 items-end gap-1 px-2 pb-2 pt-2">
          <Link
            href={overviewHref}
            className={baseItemClass(pathname === overviewHref)}
          >
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            Overview
          </Link>
          <Link
            href={plannerHref}
            className={baseItemClass(pathname === plannerHref)}
          >
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            Planner
          </Link>
          <Link
            href={captureHref}
            className={captureItemClass(pathname === captureHref)}
          >
            <span className="text-2xl leading-none">+</span>
            Capture
          </Link>
          <Link href={mapHref} className={baseItemClass(pathname === mapHref)}>
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            Map
          </Link>
          <button
            type="button"
            onClick={() => setIsMoreOpen(true)}
            className={baseItemClass(moreActive)}
          >
            <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            More
          </button>
        </div>
      </nav>

      {isMoreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close more menu"
            className="absolute inset-0 bg-stone-950/30"
            onClick={() => setIsMoreOpen(false)}
          />
          <section className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-[#fffdf8] p-5 shadow-2xl">
            <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-200" />
            <div className="mt-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                  More
                </p>
                <h2 className="text-xl font-semibold text-stone-950">
                  Journey tools
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsMoreOpen(false)}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {moreItems.map((item) =>
                item.href ? (
                  <Link
                    key={item.label}
                    href={`/trips/${activeTripId}/${item.href}`}
                    onClick={() => setIsMoreOpen(false)}
                    className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-stone-800 shadow-sm"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    key={item.label}
                    className="rounded-2xl bg-stone-100 px-4 py-3 text-sm font-bold text-stone-400"
                  >
                    {item.label}
                  </span>
                ),
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
