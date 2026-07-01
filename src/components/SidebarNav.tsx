"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useCapture2Preview } from "@/components/Capture2PreviewProvider";
import { useCaptureModal } from "@/components/CaptureModalProvider";
import { useI18n } from "@/components/I18nProvider";
import { OtrLogo } from "@/components/OtrLogo";
import { useJourneyCachedResource } from "@/hooks/useJourneyCachedResource";
import {
  journeyResourceKey,
  loadJourneyBaseListResource,
} from "@/lib/journey-resources";
import {
  compareTripsByStartDateAsc,
  getJourneyStatus,
} from "@/lib/journeys/status";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { hasUnreadJourneyChat } from "@/lib/supabase/chat";
import type { JourneyStatus, Trip } from "@/types";

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
  | "album"
  | "highlights"
  | "settings";

type NavItem = {
  labelKey: TranslationKey;
  href: string;
  icon: NavIcon;
};

const SIDEBAR_WIDTH_STORAGE_KEY = "otr.sidebar.width";
const DEFAULT_SIDEBAR_WIDTH = 192;
const MIN_SIDEBAR_WIDTH = 176;
const MAX_SIDEBAR_WIDTH = 288;

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function getActiveTripId(pathname: string) {
  return pathname.match(/^\/trips\/([^/]+)/)?.[1] ?? null;
}

function getJourneySwitchHref(pathname: string, nextTripId: string) {
  return pathname.match(/^\/trips\/[^/]+/)
    ? pathname.replace(/^\/trips\/[^/]+/, `/trips/${nextTripId}`)
    : `/trips/${nextTripId}/planner`;
}

function getDateTime(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(time) ? time : null;
}

function getJourneyStatusSortRank(status: JourneyStatus) {
  if (status === "active") return 0;
  if (status === "upcoming") return 1;
  return 2;
}

function compareJourneysForSwitcher(left: Trip, right: Trip) {
  const leftStatus = getJourneyStatus(left);
  const rightStatus = getJourneyStatus(right);
  const statusOrder =
    getJourneyStatusSortRank(leftStatus) - getJourneyStatusSortRank(rightStatus);
  if (statusOrder) return statusOrder;

  if (leftStatus === "completed" && rightStatus === "completed") {
    const leftEnd = getDateTime(left.endDate) ?? getDateTime(left.startDate) ?? 0;
    const rightEnd = getDateTime(right.endDate) ?? getDateTime(right.startDate) ?? 0;
    if (leftEnd !== rightEnd) return rightEnd - leftEnd;
  }

  return compareTripsByStartDateAsc(left, right);
}

function journeyStatusLabel(status: JourneyStatus) {
  if (status === "active") return "进行中";
  if (status === "upcoming") return "即将开始";
  return "已完成";
}

function journeyStatusDotClass(status: JourneyStatus) {
  if (status === "active") return "bg-emerald-500";
  if (status === "upcoming") return "bg-sky-500";
  return "bg-stone-300";
}

function Icon({ name }: { name: NavIcon }) {
  const common = {
    className: "h-5 w-5 shrink-0",
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
    case "album":
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="3" />
          <path d="M8 5.5V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9" />
          <circle cx="10" cy="10" r="1.4" />
          <path d="m7.5 16 3.2-3.2 2.1 2.1 1.5-1.5 2.2 2.6" />
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
  const { openCapture2 } = useCapture2Preview();
  const tripId = getActiveTripId(pathname);
  const isChatPage = Boolean(pathname.match(/^\/trips\/[^/]+\/chat$/));
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [isJourneysOpen, setIsJourneysOpen] = useState(() =>
    pathname === "/trips" || pathname.startsWith("/trips/"),
  );
  const [journeys, setJourneys] = useState<Trip[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const mainItems: NavItem[] = [
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
          icon: "album",
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
  const sortedJourneys = useMemo(
    () => [...journeys].sort(compareJourneysForSwitcher),
    [journeys],
  );
  const journeyListResource = useJourneyCachedResource({
    cacheKey: journeyResourceKey.tripsBase(),
    loader: loadJourneyBaseListResource,
    ttl: 2 * 60_000,
    staleTime: 30_000,
    keepPreviousData: true,
    backgroundRefresh: true,
  });

  useEffect(() => {
    const savedWidth = Number(
      window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY),
    );
    const nextWidth = Number.isFinite(savedWidth)
      ? clampSidebarWidth(savedWidth)
      : DEFAULT_SIDEBAR_WIDTH;
    setSidebarWidth(nextWidth);
    document.documentElement.style.setProperty(
      "--otr-sidebar-width",
      `${nextWidth}px`,
    );
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--otr-sidebar-width",
      `${sidebarWidth}px`,
    );
    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(sidebarWidth),
    );
  }, [sidebarWidth]);

  useEffect(() => {
    if (journeyListResource.data) {
      setJourneys(journeyListResource.data);
    }
  }, [journeyListResource.data]);

  useEffect(() => {
    if (pathname === "/trips" || pathname.startsWith("/trips/")) {
      setIsJourneysOpen(true);
    }
  }, [pathname]);

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
    return `group relative flex h-10 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-sm font-bold transition ${
      active
        ? "bg-emerald-50 text-emerald-900 shadow-sm"
        : "text-stone-600 hover:bg-stone-100 hover:text-stone-950"
    }`;
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onPointerMove(moveEvent: PointerEvent) {
      const nextWidth = clampSidebarWidth(
        startWidth + moveEvent.clientX - startX,
      );
      setSidebarWidth(nextWidth);
    }

    function onPointerUp() {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerUp, { once: true });
  }

  function renderItem(item: NavItem) {
    const label = t(item.labelKey);

    if (item.icon === "capture") {
      return (
        <div key={item.labelKey} className="space-y-1">
          <button
            type="button"
            onClick={() => openCapture({ tripId, entryPoint: "global_capture" })}
            className={itemClass(isActive(item.href))}
            title={label}
            aria-label={label}
          >
            <Icon name={item.icon} />
            <span className="min-w-0 truncate">
              {label}
            </span>
          </button>
          {tripId && !isChatPage ? (
            <button
              type="button"
              onClick={() => openCapture2({ tripId })}
              className="ml-8 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-left text-[10px] font-black uppercase tracking-[0.12em] text-stone-500 transition hover:bg-stone-100"
              title="Capture Beta"
              aria-label="Capture Beta"
            >
              Beta
            </button>
          ) : null}
        </div>
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
        <span className="min-w-0 truncate">
          {label}
        </span>
      </Link>
    );
  }

  function renderJourneySwitchLink(trip: Trip) {
    const status = getJourneyStatus(trip);
    const active = trip.id === tripId;

    return (
      <Link
        key={trip.id}
        href={getJourneySwitchHref(pathname, trip.id)}
        className={`group relative block rounded-lg py-1.5 pl-4 pr-2 transition ${
          active
            ? "bg-emerald-50 text-emerald-950"
            : "text-stone-600 hover:bg-stone-100 hover:text-stone-950"
        }`}
        title={trip.name}
      >
        <span
          className={`absolute left-0 top-2 h-6 w-1 rounded-full ${
            active ? "bg-emerald-600" : "bg-transparent"
          }`}
          aria-hidden="true"
        />
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`size-1.5 shrink-0 rounded-full ${journeyStatusDotClass(status)}`}
            title={journeyStatusLabel(status)}
          />
          <span className="truncate text-sm font-black">
            {trip.name}
          </span>
        </span>
      </Link>
    );
  }

  function renderJourneySwitcher() {
    const active = pathname === "/trips" || pathname.startsWith("/trips/");

    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setIsJourneysOpen((current) => !current)}
          className={`${itemClass(active)} pr-2`}
          aria-expanded={isJourneysOpen}
        >
          <Icon name="journeys" />
          <span className="min-w-0 flex-1 truncate text-left">{t("nav.journeys")}</span>
          <span
            className={`grid size-6 place-items-center rounded-lg text-stone-500 transition ${
              isJourneysOpen ? "rotate-180 bg-white/80" : "bg-stone-50"
            }`}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </button>

        {isJourneysOpen ? (
          <div className="ml-3 border-l border-emerald-100 pl-2">
            <Link
              href="/trips"
              className={`relative block rounded-lg py-1.5 pl-4 pr-2 text-sm font-black transition ${
                pathname === "/trips"
                  ? "bg-emerald-50 text-emerald-950"
                  : "text-stone-600 hover:bg-stone-100 hover:text-stone-950"
              }`}
            >
              <span
                className={`absolute left-0 top-2 h-6 w-1 rounded-full ${
                  pathname === "/trips" ? "bg-emerald-600" : "bg-transparent"
                }`}
                aria-hidden="true"
              />
              <span className="block min-w-0 truncate">全部旅程</span>
            </Link>
            {sortedJourneys.length > 0 ? (
              <div className="mt-0.5 max-h-40 space-y-0.5 overflow-y-auto pr-0.5">
                {sortedJourneys.map(renderJourneySwitchLink)}
              </div>
            ) : (
              <p className="rounded-lg px-4 py-1.5 text-xs font-semibold text-stone-500">
                {journeyListResource.isLoading ? "加载旅程中..." : "还没有旅程"}
              </p>
            )}
            <Link
              href="/trips/new"
              className="mt-1 block rounded-lg py-1.5 pl-4 pr-2 text-xs font-black text-emerald-800 transition hover:bg-emerald-50"
            >
              <span className="block min-w-0 truncate">+ 新建 Journey</span>
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[var(--otr-sidebar-width)] border-r border-emerald-100 bg-[#fffdf8] px-3 py-5 shadow-[8px_0_28px_rgba(28,25,23,0.04)] md:block">
      <Link href="/trips" className="flex min-w-0 items-center gap-3 px-1" title="OTR">
        <OtrLogo className="size-10 shrink-0 rounded-xl" />
        <span className="min-w-0">
          <span className="block text-base font-black leading-tight text-stone-950">
            OTR
          </span>
          <span className="block truncate text-xs font-semibold leading-tight text-stone-500">
            旅程与记忆
          </span>
        </span>
      </Link>
      <nav className="mt-7 space-y-5">
        <div className="grid gap-1.5">
          {renderJourneySwitcher()}
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
            null
          )}
        </div>
      </nav>
      <button
        type="button"
        onPointerDown={handleResizePointerDown}
        className="group absolute inset-y-0 right-[-5px] z-20 hidden w-2 cursor-col-resize touch-none items-center justify-center md:flex"
        aria-label="调整侧边栏宽度"
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
      >
        <span className="h-12 w-1 rounded-full bg-emerald-200/70 opacity-0 transition group-hover:opacity-100" />
      </button>
    </aside>
  );
}
