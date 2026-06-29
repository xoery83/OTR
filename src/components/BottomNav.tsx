"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCaptureModal } from "@/components/CaptureModalProvider";
import { useI18n } from "@/components/I18nProvider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { hasUnreadJourneyChat } from "@/lib/supabase/chat";

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

function navItemClass(active: boolean, compact = false) {
  return `flex h-14 w-full min-w-[74px] flex-col items-center justify-center gap-1 rounded-2xl px-2 text-center text-[11px] font-black transition ${
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
  const { t } = useI18n();
  const { openCapture } = useCaptureModal();
  const activeTripId = getActiveTripId(pathname);
  const isMapPage = Boolean(pathname.match(/^\/trips\/[^/]+\/map$/));
  const isChatPage = Boolean(pathname.match(/^\/trips\/[^/]+\/chat$/));
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
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

  function captureOptions() {
    return activeTripId
      ? { tripId: activeTripId, entryPoint: "global_capture" as const }
      : { entryPoint: "global_capture" as const };
  }

  function renderBottomBar(items: MobileNavItem[]) {
    const useEqualColumns = items.length <= 4;

    return (
      <nav
        data-mobile-bottom-nav
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
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${navItemClass(isActive(item.href), isMapPage)} relative`}
                aria-label={t(item.labelKey)}
              >
                <Icon name={item.icon} />
                {item.icon === "chat" && hasUnreadChat && !isChatPage ? (
                  <span
                    aria-label={t("chat.unread")}
                    className="absolute right-4 top-2 h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm ring-2 ring-white"
                  />
                ) : null}
                <span className="leading-none">{t(item.labelKey)}</span>
              </Link>
            ))}
          </div>
        </div>
      </nav>
    );
  }

  const captureButton = (
    <button
      type="button"
      data-mobile-capture-button
      onClick={() => openCapture(captureOptions())}
      className={`fixed right-4 z-40 flex h-16 min-w-20 flex-col items-center justify-center gap-0.5 rounded-[22px] bg-emerald-700 px-4 text-white shadow-2xl shadow-emerald-950/25 transition active:scale-95 md:hidden ${
        isMapPage ? "bottom-20" : "bottom-24"
      }`}
      aria-label={t("nav.capture")}
      title={t("nav.capture")}
    >
      <CaptureIcon />
      <span className="text-xs font-black leading-none">{t("nav.capture")}</span>
    </button>
  );

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

  if (!activeTripId) {
    return (
      <>
        {renderBottomBar(globalItems)}
        {captureButton}
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
    </>
  );
}
