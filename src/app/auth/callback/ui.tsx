"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { exchangeCodeForSession, getCurrentUser } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import { claimEmailInvitedJourneys } from "@/lib/supabase/journey-members";
import { upsertProfileForUser } from "@/lib/supabase/profiles";
import { persistAuthSession } from "@/lib/supabase/session-fallback";

export function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Finishing sign in...");

  useEffect(() => {
    let isMounted = true;

    async function completeLogin() {
      try {
        const callbackError =
          searchParams.get("error_description") || searchParams.get("error");

        if (callbackError) {
          throw new Error(callbackError);
        }

        const code = searchParams.get("code");
        const next = searchParams.get("next") || "/trips";

        if (code) {
          setStatus("Exchanging login code...");
          await exchangeCodeForSession(code);
        } else if (window.location.hash) {
          setStatus("Reading magic link session...");
          const hash = new URLSearchParams(window.location.hash.slice(1));
          const accessToken = hash.get("access_token");
          const refreshToken = hash.get("refresh_token");
          const hashError = hash.get("error_description") || hash.get("error");

          if (hashError) {
            throw new Error(hashError);
          }

          if (accessToken && refreshToken) {
            const { data: sessionData, error: sessionError } =
              await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
            if (sessionError) {
              throw sessionError;
            }

            persistAuthSession(sessionData.session);
          }
        }

        let user: User | null = await getCurrentUser();

        if (!user) {
          const { data } = await supabase.auth.getSession();
          user = data.session?.user ?? null;
        }

        if (!user) {
          throw new Error("No authenticated user was found.");
        }

        setStatus("Setting up profile...");
        await upsertProfileForUser(user);
        setStatus("Checking journey access...");
        await claimEmailInvitedJourneys();
        if (isMounted) {
          router.replace(next);
        }
      } catch (callbackError) {
        if (isMounted) {
          setError(
            callbackError instanceof Error
              ? callbackError.message
              : "Could not complete login.",
          );
        }
      }
    }

    completeLogin();

    return () => {
      isMounted = false;
    };
  }, [router, searchParams]);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h1 className="text-xl font-semibold text-stone-950">
        {error ? "Sign in needs attention" : status}
      </h1>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        {error
          ? "The magic link reached OTR, but the session was not completed."
          : "Setting up your profile and opening your journeys."}
      </p>
      {error ? (
        <>
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
          <a
            href="/login"
            className="mt-4 inline-flex rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
          >
            Back to login
          </a>
        </>
      ) : null}
    </div>
  );
}
