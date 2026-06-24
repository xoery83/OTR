"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function getActiveTripId(pathname: string) {
  return pathname.match(/^\/trips\/([^/]+)/)?.[1] ?? null;
}

export function SidebarNav() {
  const pathname = usePathname();
  const tripId = getActiveTripId(pathname);
  const mainItems = [
    { label: "Home", href: "/" },
    { label: "Journeys", href: "/trips" },
    { label: "People", href: "/people" },
    { label: "Profile", href: "/profile" },
  ];
  const journeyItems = tripId
    ? [
        { label: "Overview", href: `/trips/${tripId}` },
        { label: "Planner", href: `/trips/${tripId}/planner` },
        { label: "Timeline", href: `/trips/${tripId}/timeline` },
        { label: "Highlights", href: `/trips/${tripId}/highlights` },
      ]
    : [];

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href === "/trips") return pathname === "/trips" || pathname === "/trips/new";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function itemClass(active: boolean) {
    return `block rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
      active
        ? "bg-emerald-50 text-emerald-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-950"
    }`;
  }

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-emerald-100 bg-[#fffdf8] px-4 py-5 md:block">
      <Link href="/" className="flex items-center gap-3 px-2">
        <span className="grid size-10 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
          O
        </span>
        <div>
          <p className="text-xl font-semibold tracking-wide text-stone-950">OTR</p>
          <p className="text-xs font-medium text-stone-500">journeys</p>
        </div>
      </Link>
      <nav className="mt-8 space-y-7">
        <div className="space-y-1">
          <p className="px-3 text-xs font-bold uppercase tracking-[0.16em] text-stone-400">
            Main
          </p>
          {mainItems.map((item) => (
            <Link key={item.label} href={item.href} className={itemClass(isActive(item.href))}>
              {item.label}
            </Link>
          ))}
        </div>

        <div className="space-y-1">
          <p className="px-3 text-xs font-bold uppercase tracking-[0.16em] text-stone-400">
            Current Journey
          </p>
          {journeyItems.length > 0 ? (
            journeyItems.map((item) => (
              <Link key={item.label} href={item.href} className={itemClass(isActive(item.href))}>
                {item.label}
              </Link>
            ))
          ) : (
            <p className="px-3 py-2 text-sm leading-6 text-stone-500">
              Open a journey to see planner, timeline, and highlights.
            </p>
          )}
        </div>
      </nav>
    </aside>
  );
}
