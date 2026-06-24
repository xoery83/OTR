"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Home", href: "/", match: "/" },
  { label: "Journeys", href: "/trips", match: "/trips" },
  { label: "Capture", section: "capture" },
  { label: "Timeline", section: "timeline" },
  { label: "Profile", href: "/profile", match: "/profile" },
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

export function BottomNav() {
  const pathname = usePathname();
  const activeTripId = getActiveTripId(pathname);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 shadow-[0_-10px_30px_rgba(28,25,23,0.08)] backdrop-blur md:hidden">
      <div className="mx-auto grid h-20 max-w-3xl grid-cols-5 px-2 pb-2 pt-2">
        {navItems.map((item) => {
          const href =
            "href" in item
              ? item.href
              : activeTripId
                ? `/trips/${activeTripId}/${item.section}`
                : "/trips";
          const isActive =
            "section" in item
              ? pathname === href
              : pathname === item.match ||
                (item.match === "/trips" &&
                  pathname.startsWith("/trips/") &&
                  !pathname.includes("/timeline") &&
                  !pathname.includes("/capture"));

          return (
            <Link
              key={item.label}
              href={href}
              className={`flex flex-col items-center justify-center rounded-2xl px-1 text-xs font-semibold transition ${
                isActive
                  ? "bg-emerald-50 text-emerald-800"
                  : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              <span className="mb-1 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
