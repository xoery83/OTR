"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type NavIcon =
  | "home"
  | "journeys"
  | "discover"
  | "people"
  | "account"
  | "profile"
  | "overview"
  | "planner"
  | "capture"
  | "map"
  | "ledger"
  | "timeline"
  | "highlights"
  | "settings";

type NavItem = {
  labelKey: TranslationKey;
  href: string;
  icon: NavIcon;
};

function getActiveTripId(pathname: string) {
  return pathname.match(/^\/trips\/([^/]+)/)?.[1] ?? null;
}

function Icon({ name }: { name: NavIcon }) {
  const common = {
    className: "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="m3 11 9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "journeys":
      return (
        <svg {...common}>
          <path d="M4 17 9 5l5 12 2-5 4 7" />
          <path d="M4 17h16" />
        </svg>
      );
    case "discover":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15 9-2 5-5 2 2-5 5-2Z" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4" />
          <circle cx="12" cy="8" r="3" />
          <path d="M20 18c0-1.7-1.1-3.1-2.7-3.7" />
          <path d="M6.7 14.3C5.1 14.9 4 16.3 4 18" />
        </svg>
      );
    case "profile":
    case "account":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M5 21c1.2-4 12.8-4 14 0" />
        </svg>
      );
    case "overview":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </svg>
      );
    case "planner":
      return (
        <svg {...common}>
          <path d="M7 3v4" />
          <path d="M17 3v4" />
          <rect x="4" y="5" width="16" height="15" rx="3" />
          <path d="M8 12h8" />
          <path d="M8 16h5" />
        </svg>
      );
    case "capture":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
          <path d="M9 3v15" />
          <path d="M15 6v15" />
        </svg>
      );
    case "ledger":
      return (
        <svg {...common}>
          <path d="M6 3h12v18H6z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h3" />
        </svg>
      );
    case "timeline":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <circle cx="12" cy="7" r="2" />
          <circle cx="12" cy="17" r="2" />
          <path d="M14 7h5" />
          <path d="M5 17h5" />
        </svg>
      );
    case "highlights":
      return (
        <svg {...common}>
          <path d="m12 3 2.4 5 5.6.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.6-.8L12 3Z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a8 8 0 0 0 .1-6" />
          <path d="M4.5 9a8 8 0 0 0 .1 6" />
          <path d="m8 4 1.2 2" />
          <path d="m14.8 18 1.2 2" />
          <path d="m16 4-1.2 2" />
          <path d="m9.2 18-1.2 2" />
        </svg>
      );
  }
}

export function SidebarNav() {
  const pathname = usePathname();
  const { t } = useI18n();
  const tripId = getActiveTripId(pathname);
  const mainItems: NavItem[] = [
    { labelKey: "nav.journeys", href: "/trips", icon: "journeys" },
    { labelKey: "nav.discover", href: "/discover", icon: "discover" },
    { labelKey: "nav.capture", href: "/capture", icon: "capture" },
    { labelKey: "nav.account", href: "/profile", icon: "account" },
    { labelKey: "nav.settings", href: "/settings", icon: "settings" },
  ];
  const journeyItems: NavItem[] = tripId
    ? [
        { labelKey: "nav.overview", href: `/trips/${tripId}`, icon: "overview" },
        { labelKey: "nav.planner", href: `/trips/${tripId}/planner`, icon: "planner" },
        { labelKey: "nav.capture", href: `/trips/${tripId}/capture`, icon: "capture" },
        { labelKey: "nav.map", href: `/trips/${tripId}/map`, icon: "map" },
        { labelKey: "nav.ledger", href: `/trips/${tripId}/ledger`, icon: "ledger" },
        { labelKey: "nav.people", href: `/trips/${tripId}/people`, icon: "people" },
        {
          labelKey: "nav.timeline",
          href: `/trips/${tripId}/timeline`,
          icon: "timeline",
        },
        {
          labelKey: "nav.highlights",
          href: `/trips/${tripId}/highlights`,
          icon: "highlights",
        },
        {
          labelKey: "nav.settings",
          href: `/trips/${tripId}/settings`,
          icon: "settings",
        },
      ]
    : [];

  function isActive(href: string) {
    if (href === "/" || href.startsWith("/?")) return pathname === "/";
    if (href === "/trips") return pathname === "/trips" || pathname === "/trips/new";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function itemClass(active: boolean) {
    return `group relative grid size-11 place-items-center rounded-2xl transition ${
      active
        ? "bg-emerald-50 text-emerald-900"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-950"
    }`;
  }

  function renderItem(item: NavItem) {
    const label = t(item.labelKey);

    return (
      <Link
        key={item.labelKey}
        href={item.href}
        className={itemClass(isActive(item.href))}
        title={label}
        aria-label={label}
      >
        <Icon name={item.icon} />
        <span className="pointer-events-none absolute left-14 top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-xl bg-stone-950 px-3 py-2 text-xs font-bold text-white shadow-lg group-hover:block group-focus-visible:block">
          {label}
        </span>
      </Link>
    );
  }

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-20 border-r border-emerald-100 bg-[#fffdf8] px-3 py-5 md:block">
      <Link href="/trips" className="grid place-items-center" title="OTR">
        <span className="grid size-10 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
          O
        </span>
      </Link>
      <nav className="mt-8 space-y-7">
        <div className="grid justify-items-center gap-2">
          {mainItems.map(renderItem)}
        </div>

        <div className="grid justify-items-center gap-2 border-t border-stone-100 pt-4">
          {journeyItems.length > 0 ? (
            journeyItems.map(renderItem)
          ) : (
            <span className="grid size-11 place-items-center rounded-2xl bg-stone-50 text-xs font-bold text-stone-300">
              <Icon name="journeys" />
            </span>
          )}
        </div>
      </nav>
    </aside>
  );
}
