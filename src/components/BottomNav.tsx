"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useState } from "react";
import { useCapture2Preview } from "@/components/Capture2PreviewProvider";
import { useI18n } from "@/components/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { compareTripsByStartDateAsc, getJourneyStatus } from "@/lib/journeys/status";
import { hasUnreadJourneyChat } from "@/lib/supabase/chat";
import { supabase } from "@/lib/supabase/client";
import { getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

type MobileNavIcon =
  | "journeys"
  | "discover"
  | "account"
  | "planner"
  | "map"
  | "ledger"
  | "chat"
  | "people"
  | "timeline"
  | "album"
  | "highlights"
  | "settings";

type MobileNavItem = {
  labelKey: TranslationKey;
  href: string;
  icon: MobileNavIcon;
};

type Capture2ReviewCountRow = {
  status: string | null;
  metadata: Record<string, unknown> | null;
};

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

function needsCapture2Review(row: Capture2ReviewCountRow) {
  if (row.status === "archived" || row.status === "processed") return false;
  const inbox = row.metadata?.capture2Inbox;
  const inboxStatus =
    inbox && typeof inbox === "object"
      ? (inbox as { status?: unknown }).status
      : null;
  if (inboxStatus === "archived" || inboxStatus === "processed") return false;

  const capture2 = row.metadata?.capture2;
  const safetyClass =
    capture2 && typeof capture2 === "object"
      ? (capture2 as { safetyClass?: unknown }).safetyClass
      : null;
  return row.status === "raw" || row.status === "deferred" || safetyClass === "deferred";
}

async function getCapture2ReviewCount(tripId: string) {
  const { data, error } = await supabase
    .from("journey_capture_events")
    .select("status, metadata")
    .eq("journey_id", tripId)
    .filter("metadata->>source", "eq", "capture2_preview")
    .not("status", "in", "(archived,processed)")
    .limit(1000);

  if (error) throw error;
  return ((data ?? []) as Capture2ReviewCountRow[]).filter(needsCapture2Review).length;
}

function Icon({ name }: { name: MobileNavIcon }) {
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
    case "people":
      return (
        <svg {...common}>
          <path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4" />
          <circle cx="12" cy="8" r="3" />
          <path d="M20 18c0-1.7-1.1-3.1-2.7-3.7" />
          <path d="M6.7 14.3C5.1 14.9 4 16.3 4 18" />
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

function navItemClass(active: boolean, compact = false, exploring = false) {
  return `flex h-14 w-full min-w-[74px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-center text-[11px] font-black transform-gpu transition duration-150 ${
    exploring ? "scale-110 -translate-y-1" : "active:scale-95"
  } ${
    compact
      ? active
        ? "bg-white/90 text-emerald-800 shadow-sm backdrop-blur"
        : "text-stone-700 drop-shadow-sm hover:bg-white/45 hover:text-stone-950"
      : active
        ? "bg-emerald-50 text-emerald-800 shadow-sm"
        : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
  }`;
}

function CaptureIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { openCapture2 } = useCapture2Preview();
  const activeTripId = getActiveTripId(pathname);
  const isMapPage = Boolean(pathname.match(/^\/trips\/[^/]+\/map$/));
  const isChatPage = Boolean(pathname.match(/^\/trips\/[^/]+\/chat$/));
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [capture2ReviewCount, setCapture2ReviewCount] = useState(0);
  const [capture2JourneyChoices, setCapture2JourneyChoices] = useState<Trip[]>([]);
  const [isResolvingCapture2Journey, setIsResolvingCapture2Journey] = useState(false);
  const [exploringHref, setExploringHref] = useState<string | null>(null);
  const globalItems: MobileNavItem[] = [
    { labelKey: "nav.journeys", href: "/trips", icon: "journeys" },
    { labelKey: "nav.discover", href: "/discover", icon: "discover" },
    { labelKey: "nav.account", href: "/profile", icon: "account" },
    { labelKey: "nav.settings", href: "/settings", icon: "settings" },
  ];

  function isActive(href: string) {
    if (href === "/trips") return pathname === "/trips" || pathname === "/trips/new";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function vibrateNavTick() {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    navigator.vibrate(8);
  }

  function beginNavExploration(
    event: ReactPointerEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (event.pointerType === "mouse") return;
    setExploringHref(href);
    vibrateNavTick();
  }

  function endNavExploration(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (event.pointerType === "mouse") return;
    setExploringHref(null);
  }

  async function openCapture2FromFloatingEntry() {
    if (activeTripId) {
      openCapture2({ tripId: activeTripId });
      return;
    }

    setIsResolvingCapture2Journey(true);
    try {
      const trips = await getTripsForCurrentUser();
      const activeTrips = trips
        .filter((trip) => getJourneyStatus(trip) === "active")
        .sort(compareTripsByStartDateAsc);

      if (activeTrips.length === 0) {
        window.alert("请先创建一个进行中的行程，再使用 Capture 2.0。");
        router.push("/trips/new");
        return;
      }

      if (activeTrips.length === 1) {
        openCapture2({ tripId: activeTrips[0].id });
        return;
      }

      setCapture2JourneyChoices(activeTrips);
    } catch {
      window.alert("暂时无法读取进行中的行程，请进入某个行程后再使用 Capture 2.0。");
    } finally {
      setIsResolvingCapture2Journey(false);
    }
  }

  function renderBottomBar(items: MobileNavItem[]) {
    const useEqualColumns = items.length <= 4;

    return (
      <nav
        data-mobile-bottom-nav
        onContextMenu={(event) => event.preventDefault()}
        className={`fixed inset-x-0 bottom-0 z-30 backdrop-blur md:hidden ${
          isMapPage
            ? "border-t border-transparent bg-transparent shadow-none"
            : "border-t border-stone-200 bg-white/95 shadow-[0_-10px_30px_rgba(28,25,23,0.08)]"
        }`}
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-8 items-center justify-start bg-gradient-to-r from-white/95 to-transparent pl-1 text-stone-400">
          <span className="text-lg leading-none">‹</span>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-8 items-center justify-end bg-gradient-to-l from-white/95 to-transparent pr-1 text-stone-400">
          <span className="text-lg leading-none">›</span>
        </div>
        <div
          className={`mx-auto max-w-3xl ${
            useEqualColumns ? "overflow-hidden px-8" : "overflow-x-auto pl-5 pr-28"
          } ${
            isMapPage ? "h-[72px] py-2" : "h-[82px] pb-3 pt-2"
          }`}
        >
          <div
            className={
              useEqualColumns
                ? "grid h-full min-w-full grid-cols-4 items-center gap-2"
                : "flex w-max min-w-full items-center justify-center gap-2"
            }
          >
            {items.map((item) => {
              const isExploring = exploringHref === item.href;
              const active = exploringHref ? isExploring : isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-bottom-nav-href={item.href}
                  onPointerDown={(event) => beginNavExploration(event, item.href)}
                  onPointerUp={endNavExploration}
                  onPointerCancel={endNavExploration}
                  onPointerLeave={endNavExploration}
                  onContextMenu={(event) => event.preventDefault()}
                  onDragStart={(event) => event.preventDefault()}
                  className={`${navItemClass(active, isMapPage, isExploring)} relative`}
                  aria-label={t(item.labelKey)}
                  draggable={false}
                >
                  <span
                    className={`transition-transform duration-150 ${
                      isExploring ? "scale-125" : ""
                    }`}
                  >
                    <Icon name={item.icon} />
                  </span>
                  {item.icon === "chat" && hasUnreadChat && !isChatPage ? (
                    <span
                      aria-label={t("chat.unread")}
                      className="absolute right-4 top-2 h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm ring-2 ring-white"
                    />
                  ) : null}
                  <span className="leading-none">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    );
  }

  const captureButton = (
    <div
      data-mobile-capture-button
      className={`fixed right-4 z-40 w-[86px] overflow-hidden rounded-[26px] bg-white/90 shadow-2xl shadow-emerald-950/25 ring-1 ring-emerald-900/10 backdrop-blur md:hidden ${
        isMapPage ? "bottom-20" : "bottom-24"
      }`}
    >
      <button
        type="button"
        onClick={() => void openCapture2FromFloatingEntry()}
        disabled={isResolvingCapture2Journey}
        className="flex h-[72px] w-full flex-col items-center justify-center gap-1 bg-emerald-700 text-white transition hover:bg-emerald-800 active:scale-[0.98] disabled:bg-stone-300"
        aria-label={t("nav.capture")}
        title={t("nav.capture")}
      >
        <CaptureIcon />
        <span className="text-[13px] font-black leading-none">{t("nav.capture")}</span>
      </button>
      {activeTripId ? (
        <Link
          href={`/trips/${activeTripId}/capture2`}
          className="relative flex h-10 w-full items-center justify-center bg-stone-200 text-lg font-black leading-none text-stone-800 transition hover:bg-stone-300 active:scale-[0.98]"
          aria-label={`${capture2ReviewCount} captures need review`}
          title="Today Review"
        >
          {capture2ReviewCount > 0 ? (
            <span className="absolute right-4 top-2 size-2 rounded-full bg-rose-500 shadow-sm ring-2 ring-stone-200" />
          ) : null}
          {capture2ReviewCount > 99 ? "99+" : capture2ReviewCount}
        </Link>
      ) : (
        <div className="h-2 bg-stone-200" aria-hidden="true" />
      )}
    </div>
  );

  useEffect(() => {
    if (!activeTripId) {
      setCapture2ReviewCount(0);
      return;
    }

    let cancelled = false;
    async function refreshReviewCount() {
      const count = await getCapture2ReviewCount(activeTripId!).catch(() => 0);
      if (!cancelled) setCapture2ReviewCount(count);
    }

    void refreshReviewCount();
    const interval = window.setInterval(refreshReviewCount, 30_000);
    const onFocus = () => void refreshReviewCount();
    const onCaptureChanged = () => void refreshReviewCount();
    window.addEventListener("focus", onFocus);
    window.addEventListener("otr:capture2-changed", onCaptureChanged);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("otr:capture2-changed", onCaptureChanged);
    };
  }, [activeTripId]);

  useEffect(() => {
    document.body.classList.toggle("otr-map-page", isMapPage);
    return () => document.body.classList.remove("otr-map-page");
  }, [isMapPage]);

  useEffect(() => {
    if (!activeTripId || isChatPage) {
      setHasUnreadChat(false);
      return;
    }

    let cancelled = false;
    async function refreshUnread() {
      const unread = await hasUnreadJourneyChat(activeTripId!).catch(() => false);
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
  }, [activeTripId, isChatPage]);

  const capture2JourneyPicker =
    capture2JourneyChoices.length > 0 ? (
      <div className="fixed inset-0 z-[70] grid place-items-end bg-stone-950/35 p-4 backdrop-blur-sm md:hidden">
        <div className="w-full rounded-3xl bg-[#fffdf8] p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
                Capture 2.0
              </p>
              <h2 className="mt-1 text-xl font-black text-stone-950">
                选择要记录到哪个行程
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setCapture2JourneyChoices([])}
              className="rounded-full bg-stone-100 px-3 py-2 text-sm font-black text-stone-700"
            >
              关闭
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {capture2JourneyChoices.map((trip) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => {
                  setCapture2JourneyChoices([]);
                  openCapture2({ tripId: trip.id });
                }}
                className="w-full rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-stone-100"
              >
                <span className="block text-base font-black text-stone-950">
                  {trip.name}
                </span>
                <span className="mt-1 block text-xs font-bold text-stone-500">
                  {trip.destination || "目的地待定"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    ) : null;

  if (!activeTripId) {
    return (
      <>
        {renderBottomBar(globalItems)}
        {captureButton}
        {isChatPage ? null : capture2JourneyPicker}
      </>
    );
  }

  const journeyItems: MobileNavItem[] = [
    {
      labelKey: "nav.planner",
      href: `/trips/${activeTripId}/planner`,
      icon: "planner",
    },
    { labelKey: "nav.map", href: `/trips/${activeTripId}/map`, icon: "map" },
    {
      labelKey: "nav.ledger",
      href: `/trips/${activeTripId}/ledger`,
      icon: "ledger",
    },
    { labelKey: "nav.chat", href: `/trips/${activeTripId}/chat`, icon: "chat" },
    {
      labelKey: "nav.timeline",
      href: `/trips/${activeTripId}/timeline`,
      icon: "album",
    },
    {
      labelKey: "nav.highlights",
      href: `/trips/${activeTripId}/highlights`,
      icon: "highlights",
    },
    {
      labelKey: "nav.people",
      href: `/trips/${activeTripId}/people`,
      icon: "people",
    },
    {
      labelKey: "nav.settings",
      href: `/trips/${activeTripId}/settings`,
      icon: "settings",
    },
  ];

  return (
    <>
      {renderBottomBar(journeyItems)}
      {isChatPage ? null : captureButton}
      {isChatPage ? null : capture2JourneyPicker}
    </>
  );
}
