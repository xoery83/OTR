"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCaptureModal } from "@/components/CaptureModalProvider";
import { useI18n } from "@/components/I18nProvider";
import { logout } from "@/lib/supabase/auth";
import { getTrip, getTripsForCurrentUser } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

const languageOptions = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
];

function getActiveTripId(pathname: string) {
  const segment = pathname.match(/^\/trips\/([^/]+)/)?.[1] ?? null;
  return segment && segment !== "new" ? segment : null;
}

function getJourneySwitchHref(pathname: string, tripId: string) {
  return pathname.match(/^\/trips\/[^/]+/)
    ? pathname.replace(/^\/trips\/[^/]+/, `/trips/${tripId}`)
    : `/trips/${tripId}`;
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { contentLanguage, setLocale, t } = useI18n();
  const { openCapture } = useCaptureModal();
  const tripId = getActiveTripId(pathname);
  const isMapPage = Boolean(pathname.match(/^\/trips\/[^/]+\/map$/));
  const isChatPage = Boolean(pathname.match(/^\/trips\/[^/]+\/chat$/));
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isJourneyMenuOpen, setIsJourneyMenuOpen] = useState(false);
  const [journeyName, setJourneyName] = useState<string | null>(null);
  const [journeyCoverImageUrl, setJourneyCoverImageUrl] = useState<string | null>(null);
  const [journeys, setJourneys] = useState<Trip[]>([]);
  const journeyMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadJourneyName() {
      if (!tripId) {
        setJourneyName(null);
        setJourneyCoverImageUrl(null);
        return;
      }

      try {
        const trip = await getTrip(tripId);
        if (isMounted) {
          setJourneyName(trip.name);
          setJourneyCoverImageUrl(trip.coverImageUrl);
        }
      } catch {
        if (isMounted) {
          setJourneyName(t("common.journey"));
          setJourneyCoverImageUrl(null);
        }
      }
    }

    loadJourneyName();
    return () => {
      isMounted = false;
    };
  }, [tripId, t]);

  useEffect(() => {
    let isMounted = true;

    async function loadJourneys() {
      try {
        const data = await getTripsForCurrentUser();
        if (isMounted) setJourneys(data);
      } catch {
        if (isMounted) setJourneys([]);
      }
    }

    loadJourneys();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isJourneyMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        journeyMenuRef.current?.contains(target)
      ) {
        return;
      }

      setIsJourneyMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsJourneyMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isJourneyMenuOpen]);

  async function handleLogout() {
    await logout();
    setIsMenuOpen(false);
    router.push("/login");
  }

  const journeyHeaderStyle =
    !isMapPage && !isChatPage && tripId && journeyCoverImageUrl
      ? {
          backgroundImage: [
            "linear-gradient(90deg, rgba(255, 253, 248, 0.96) 0%, rgba(255, 253, 248, 0.7) 22%, rgba(255, 253, 248, 0.72) 78%, rgba(255, 253, 248, 0.97) 100%)",
            "linear-gradient(180deg, rgba(255, 253, 248, 0.55), rgba(255, 253, 248, 0.88))",
            `url("${journeyCoverImageUrl}")`,
          ].join(", "),
          backgroundPosition: "center",
          backgroundSize: "cover",
        }
      : undefined;

  return (
    <>
      <header
        data-mobile-app-header
        style={journeyHeaderStyle}
        className={
          isMapPage
            ? "fixed left-3 top-3 z-[650] md:hidden"
            : isChatPage
              ? "fixed inset-x-0 top-0 z-[650] border-b border-transparent bg-transparent text-white md:hidden"
            : "sticky top-0 z-[600] border-b border-emerald-100 bg-[#fffdf8]/95 backdrop-blur md:hidden"
        }
      >
        <div
          className={
            isMapPage
              ? "flex items-center"
              : "relative mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5"
          }
        >
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className={
              isMapPage
                ? "grid size-11 place-items-center rounded-2xl bg-white/[0.78] text-left shadow-lg backdrop-blur"
                : isChatPage
                  ? "grid size-11 place-items-center rounded-2xl bg-emerald-700/92 text-left text-white shadow-lg backdrop-blur"
                : "flex min-w-0 items-center gap-3 text-left"
            }
            aria-label={t("app.menu.open")}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
              O
            </span>
            <div
              className={`${
                isMapPage || isChatPage
                  ? "hidden"
                  : "hidden min-w-0 min-[380px]:block"
              }`}
            >
              <p className="text-lg font-semibold tracking-wide text-stone-950">
                OTR
              </p>
              <p className="truncate text-xs font-medium text-stone-500">
                {t("app.tagline")}
              </p>
            </div>
          </button>
          {!isMapPage ? (
            <>
              <p
                className={`pointer-events-none absolute left-1/2 max-w-[42vw] -translate-x-1/2 truncate text-center text-sm font-black ${
                  isChatPage ? "text-white drop-shadow" : "text-stone-900"
                }`}
              >
                {tripId ? journeyName || t("common.journey") : "OTR"}
              </p>
              <div ref={journeyMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsJourneyMenuOpen((current) => !current)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm ${
                    isChatPage ? "bg-emerald-700/92 backdrop-blur" : "bg-emerald-700"
                  }`}
                  aria-expanded={isJourneyMenuOpen}
                >
                  <span>{t("nav.journeys")}</span>
                  <span
                    className={`text-[10px] leading-none transition-transform ${
                      isJourneyMenuOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  >
                    ▼
                  </span>
                </button>
                {isJourneyMenuOpen ? (
                  <div className="absolute right-0 top-12 z-[680] w-72 max-w-[82vw] overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-xl">
                    <div className="border-b border-stone-100 px-4 py-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                        Journeys
                      </p>
                    </div>
                    <div className="max-h-80 overflow-y-auto p-2">
                      {journeys.length > 0 ? (
                        journeys.map((journey) => {
                          const active = journey.id === tripId;

                          return (
                            <Link
                              key={journey.id}
                              href={getJourneySwitchHref(pathname, journey.id)}
                              onClick={() => setIsJourneyMenuOpen(false)}
                              className={`block rounded-xl px-3 py-3 text-sm font-bold ${
                                active
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "text-stone-800 hover:bg-stone-50"
                              }`}
                            >
                              <span className="block truncate">{journey.name}</span>
                              {journey.destination ? (
                                <span className="mt-1 block truncate text-xs font-semibold text-stone-500">
                                  {journey.destination}
                                </span>
                              ) : null}
                            </Link>
                          );
                        })
                      ) : (
                        <p className="px-3 py-4 text-sm font-semibold text-stone-500">
                          No journeys yet.
                        </p>
                      )}
                    </div>
                    <div className="border-t border-stone-100 p-2">
                      <Link
                        href="/trips"
                        onClick={() => setIsJourneyMenuOpen(false)}
                        className="block rounded-xl px-3 py-3 text-sm font-black text-emerald-700 hover:bg-emerald-50"
                      >
                        {t("nav.journeys")}
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-[700] md:hidden">
          <button
            type="button"
            aria-label={t("app.menu.close")}
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
                  {t("app.menu.global")}
                </p>
              </div>
            </div>
            <div className="mt-6 rounded-2xl bg-white p-3 shadow-sm">
              <label
                htmlFor="app-header-language"
                className="block px-1 pb-2 text-[11px] font-black uppercase tracking-[0.16em] text-stone-400"
              >
                {t("app.language")}
              </label>
              <select
                id="app-header-language"
                value={contentLanguage}
                onChange={(event) => setLocale(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-stone-200 bg-[#fffdf8] px-3 text-sm font-bold text-stone-800 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <nav className="mt-7 grid gap-2">
              {(
                [
                  ["nav.journeys", "/trips"],
                  ["nav.discover", "/discover"],
                  ["nav.account", "/profile"],
                  ["nav.settings", "/settings"],
                ] as const
              ).map(([labelKey, href]) => (
                <Link
                  key={labelKey}
                  href={href}
                  onClick={() => setIsMenuOpen(false)}
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-stone-700 shadow-sm"
                >
                  {t(labelKey)}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  openCapture({ tripId, entryPoint: "global_capture" });
                }}
                className="rounded-2xl bg-white px-4 py-3 text-left text-sm font-bold text-stone-700 shadow-sm"
              >
                {t("nav.capture")}
              </button>
            </nav>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-5 w-full rounded-2xl bg-stone-900 px-4 py-3 text-sm font-bold text-white"
            >
              {t("nav.logout")}
            </button>
          </aside>
        </div>
      ) : null}
    </>
  );
}
