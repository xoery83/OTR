"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useCaptureModal } from "@/components/CaptureModalProvider";
import { useI18n } from "@/components/I18nProvider";
import {
  compareTripsByStartDateAsc,
  getJourneyStatus,
} from "@/lib/journeys/status";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { hasUnreadJourneyChat } from "@/lib/supabase/chat";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

type NavIcon =
  | "home"
  | "journeys"
  | "discover"
  | "people"
  | "account"
  | "profile"
  | "planner"
  | "capture"
  | "map"
  | "ledger"
  | "chat"
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
    case "chat":
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H8l-5 2 1.6-4A8 8 0 1 1 21 12Z" />
          <path d="M8 11h8" />
          <path d="M8 15h5" />
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
  const { openCapture } = useCaptureModal();
  const tripId = getActiveTripId(pathname);
  const isChatPage = Boolean(pathname.match(/^\/trips\/[^/]+\/chat$/));
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [quickTrips, setQuickTrips] = useState<Trip[]>([]);
  const mainItems: NavItem[] = [
    { labelKey: "nav.journeys", href: "/trips", icon: "journeys" },
    { labelKey: "nav.discover", href: "/discover", icon: "discover" },
    { labelKey: "nav.capture", href: "/capture", icon: "capture" },
    { labelKey: "nav.account", href: "/profile", icon: "account" },
    { labelKey: "nav.settings", href: "/settings", icon: "settings" },
  ];
  const journeyItems: NavItem[] = tripId
    ? [
        { labelKey: "nav.planner", href: `/trips/${tripId}/planner`, icon: "planner" },
        { labelKey: "nav.capture", href: `/trips/${tripId}/capture`, icon: "capture" },
        { labelKey: "nav.map", href: `/trips/${tripId}/map`, icon: "map" },
        { labelKey: "nav.ledger", href: `/trips/${tripId}/ledger`, icon: "ledger" },
        { labelKey: "nav.chat", href: `/trips/${tripId}/chat`, icon: "chat" },
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
        { labelKey: "nav.people", href: `/trips/${tripId}/people`, icon: "people" },
        {
          labelKey: "nav.settings",
          href: `/trips/${tripId}/settings`,
          icon: "settings",
        },
      ]
    : [];
  const quickJourneyItems = useMemo(() => {
    const statusRank: Record<string, number> = {
      active: 0,
      upcoming: 1,
      completed: 2,
    };

    return [...quickTrips]
      .sort((left, right) => {
        const statusOrder =
          statusRank[getJourneyStatus(left)] - statusRank[getJourneyStatus(right)];
        if (statusOrder) return statusOrder;
        return compareTripsByStartDateAsc(left, right);
      })
      .slice(0, 3);
  }, [quickTrips]);

  useEffect(() => {
    if (tripId) {
      return;
    }

    let isMounted = true;
    getTripsForCurrentUser()
      .then((trips) => {
        if (isMounted) setQuickTrips(trips);
      })
      .catch(() => {
        if (isMounted) setQuickTrips([]);
      });

    return () => {
      isMounted = false;
    };
  }, [tripId]);

  useEffect(() => {
    if (!tripId || isChatPage) {
      setHasUnreadChat(false);
      return;
    }

    let cancelled = false;
    async function refreshUnread() {
      const unread = await hasUnreadJourneyChat(tripId!).catch(() => false);
      if (!cancelled) setHasUnreadChat(unread);
    }

    void refreshUnread();
    const interval = window.setInterval(refreshUnread, 30_000);
    const onFocus = () => void refreshUnread();
    const onChatChanged = () => void refreshUnread();
    window.addEventListener("focus", onFocus);
    window.addEventListener("otr:chat-changed", onChatChanged);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("otr:chat-changed", onChatChanged);
    };
  }, [isChatPage, tripId]);

  function isActive(href: string) {
    if (href === "/" || href.startsWith("/?")) return pathname === "/";
    if (href === "/trips") return pathname === "/trips" || pathname === "/trips/new";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function itemClass(active: boolean) {
    return `group relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold transition ${
      active
        ? "bg-emerald-50 text-emerald-900 shadow-sm"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-950"
    }`;
  }

  function renderItem(item: NavItem) {
    const label = t(item.labelKey);

    if (item.icon === "capture") {
      return (
        <button
          key={item.labelKey}
          type="button"
          onClick={() => openCapture({ tripId, entryPoint: "global_capture" })}
          className={itemClass(isActive(item.href))}
          title={label}
          aria-label={label}
        >
          <Icon name={item.icon} />
          <span className="truncate">
            {label}
          </span>
        </button>
      );
    }

    return (
      <Link
        key={item.labelKey}
        href={item.href}
        className={itemClass(isActive(item.href))}
        title={label}
        aria-label={label}
      >
        <Icon name={item.icon} />
        {item.icon === "chat" && hasUnreadChat && !isChatPage ? (
          <span
            aria-label={t("chat.unread")}
            className="absolute right-3 top-2 h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm ring-2 ring-white"
          />
        ) : null}
        <span className="truncate">
          {label}
        </span>
      </Link>
    );
  }

  function renderQuickJourney(trip: Trip) {
    const status = getJourneyStatus(trip);
    const statusLabel =
      status === "active" ? "进行中" : status === "upcoming" ? "即将开始" : "已完成";

    return (
      <Link
        key={trip.id}
        href={`/trips/${trip.id}/planner`}
        className="group rounded-xl px-3 py-2 transition hover:bg-emerald-50"
        title={trip.name}
      >
        <span className="block truncate text-sm font-black text-stone-900 group-hover:text-emerald-900">
          {trip.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-semibold text-stone-500">
          {statusLabel}
          {trip.destination ? ` · ${trip.destination}` : ""}
        </span>
      </Link>
    );
  }

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-44 border-r border-emerald-100 bg-[#fffdf8] px-3 py-5 shadow-[8px_0_28px_rgba(28,25,23,0.04)] md:block">
      <Link href="/trips" className="flex items-center gap-3 px-1" title="OTR">
        <span className="grid size-10 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
          O
        </span>
        <span>
          <span className="block text-base font-black leading-tight text-stone-950">
            OTR
          </span>
          <span className="block text-xs font-semibold leading-tight text-stone-500">
            旅程与记忆
          </span>
        </span>
      </Link>
      <nav className="mt-7 space-y-5">
        <div className="grid gap-1.5">
          {mainItems.map(renderItem)}
        </div>

        <div className="border-t-2 border-emerald-100 pt-4">
          {journeyItems.length > 0 ? (
            <>
              <p className="mb-2 px-3 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-800">
                当前 Journey
              </p>
              <div className="grid gap-1.5 rounded-2xl bg-white/60 p-1.5 ring-1 ring-emerald-50">
                {journeyItems.map(renderItem)}
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 px-3 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-800">
                快速进入
              </p>
              {quickJourneyItems.length > 0 ? (
                <div className="grid gap-1.5 rounded-2xl bg-white/60 p-1.5 ring-1 ring-emerald-50">
                  {quickJourneyItems.map(renderQuickJourney)}
                </div>
              ) : (
                <Link
                  href="/trips"
                  className="flex h-10 items-center gap-3 rounded-xl bg-stone-50 px-3 text-sm font-bold text-stone-400 hover:bg-emerald-50 hover:text-emerald-900"
                >
                  <Icon name="journeys" />
                  Journey
                </Link>
              )}
            </>
          )}
        </div>
      </nav>
    </aside>
  );
}
