"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/AuthGate";
import { logout } from "@/lib/supabase/auth";
import { getProfile } from "@/lib/supabase/profiles";
import type { Profile } from "@/types";

function SettingsContent({ user }: { user: User }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        const profileData = await getProfile(user.id);

        if (isMounted) {
          setProfile(profileData);
        }
      } catch (profileError) {
        if (isMounted) {
          setError(
            profileError instanceof Error
              ? profileError.message
              : "Could not load profile.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [user.id]);

  async function handleLogout() {
    setIsLoggingOut(true);
    setError(null);

    try {
      await logout();
      router.replace("/login");
    } catch (logoutError) {
      setError(
        logoutError instanceof Error ? logoutError.message : "Could not logout.",
      );
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Your profile
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Profile data is created from Supabase Auth on first login.
        </p>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        {isLoading ? (
          <p className="text-sm font-medium text-stone-600">
            Loading profile...
          </p>
        ) : null}

        {profile ? (
          <div className="flex items-center gap-4">
            <div className="grid size-14 place-items-center overflow-hidden rounded-2xl bg-emerald-100 text-lg font-bold text-emerald-800">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                profile.displayName.slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-stone-950">
                {profile.displayName}
              </h2>
              <p className="truncate text-sm text-stone-500">{user.email}</p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="mt-5 w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          Logout
        </button>
      </section>

      <Link
        href="/settings/capture-ai"
        className="block rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50"
      >
        <p className="text-sm font-semibold text-emerald-700">Capture AI</p>
        <h2 className="mt-1 text-xl font-semibold text-stone-950">
          Intent engine and prompts
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Configure supported intents, confidence thresholds, prompt templates,
          and test detection without writing data.
        </p>
      </Link>
    </div>
  );
}

export default function SettingsPage() {
  return <AuthGate>{(user) => <SettingsContent user={user} />}</AuthGate>;
}
