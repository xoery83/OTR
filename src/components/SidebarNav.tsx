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
        { label: "Capture", href: `/trips/${tripId}/capture` },
        { label: "Map", href: `/trips/${tripId}/map` },
        { label: "Ledger", href: `/trips/${tripId}/ledger` },
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
    return `grid size-11 place-items-center rounded-2xl text-sm font-bold transition ${
      active
        ? "bg-emerald-50 text-emerald-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-950"
    }`;
  }

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-20 border-r border-emerald-100 bg-[#fffdf8] px-3 py-5 md:block">
      <Link href="/" className="grid place-items-center" title="OTR">
        <span className="grid size-10 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
          O
        </span>
      </Link>
      <nav className="mt-8 space-y-7">
        <div className="grid justify-items-center gap-2">
          {mainItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={itemClass(isActive(item.href))}
              title={item.label}
            >
              {item.label.slice(0, 1)}
            </Link>
          ))}
        </div>

        <div className="grid justify-items-center gap-2 border-t border-stone-100 pt-4">
          {journeyItems.length > 0 ? (
            journeyItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={itemClass(isActive(item.href))}
                title={item.label}
              >
                {item.label.slice(0, 1)}
              </Link>
            ))
          ) : (
            <span className="grid size-11 place-items-center rounded-2xl bg-stone-50 text-xs font-bold text-stone-300">
              -
            </span>
          )}
        </div>
      </nav>
    </aside>
  );
}
