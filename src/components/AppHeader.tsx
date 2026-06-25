"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { LiveLocationToggle } from "@/components/LiveLocationToggle";
import { logout } from "@/lib/supabase/auth";
import { getTrip } from "@/lib/supabase/trips";

function getActiveTripId(pathname: string) {
  return pathname.match(/^\/trips\/([^/]+)/)?.[1] ?? null;
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const tripId = getActiveTripId(pathname);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [journeyName, setJourneyName] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadJourneyName() {
      if (!tripId) {
        setJourneyName(null);
        return;
      }

      try {
        const trip = await getTrip(tripId);
        if (isMounted) setJourneyName(trip.name);
      } catch {
        if (isMounted) setJourneyName(t("common.journey"));
      }
    }

    loadJourneyName();
    return () => {
      isMounted = false;
    };
  }, [tripId, t]);

  async function handleLogout() {
    await logout();
    setIsMenuOpen(false);
    router.push("/login");
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-emerald-100 bg-[#fffdf8]/95 backdrop-blur md:hidden">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="flex min-w-0 items-center gap-3 text-left"
            aria-label={t("app.menu.open")}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
              O
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold tracking-wide text-stone-950">
                OTR
              </p>
              <p className="truncate text-xs font-medium text-stone-500">
                {t("app.tagline")}
              </p>
            </div>
          </button>
          <div className="flex min-w-0 items-center gap-2">
            {tripId ? <LiveLocationToggle tripId={tripId} compact /> : null}
            <Link
              href="/trips"
              className="max-w-[34vw] truncate rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm"
            >
              {journeyName ? `${journeyName} ▾` : t("nav.journeys")}
            </Link>
          </div>
        </div>
      </header>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
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
            <div className="mt-6 rounded-2xl bg-white p-2 shadow-sm">
              <p className="px-2 pb-2 text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">
                {t("app.language")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["en", "English"],
                  ["zh-CN", "简体中文"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLocale(value === "zh-CN" ? "zh-CN" : "en")}
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${
                      locale === value
                        ? "bg-emerald-700 text-white"
                        : "bg-stone-50 text-stone-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <nav className="mt-7 grid gap-2">
              {(
                [
                  ["nav.profile", "/profile"],
                  ["nav.settings", "/settings"],
                  ["nav.notifications", "/settings"],
                  ["nav.syncStatus", "/settings"],
                  ["nav.offlineData", "/settings"],
                  ["nav.help", "/settings"],
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
