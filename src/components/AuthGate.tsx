"use client";

import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { upsertProfileForUser } from "@/lib/supabase/profiles";
import {
  clearAuthSessionPersistence,
  ensureRestoredSession,
  persistAuthSession,
} from "@/lib/supabase/session-fallback";

type AuthGateProps = {
  children: (user: User) => ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      const restoredSession = await ensureRestoredSession();
      const { error: sessionError, data } = restoredSession
        ? { error: null, data: { session: restoredSession } }
        : await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (sessionError) {
        setError(sessionError.message);
        setIsLoading(false);
        return;
      }

      if (!data.session?.user) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      try {
        await upsertProfileForUser(data.session.user);
        setUser(data.session.user);
      } catch (profileError) {
        setError(
          profileError instanceof Error
            ? profileError.message
            : "Could not load your profile.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    loadSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          persistAuthSession(session);
        } else {
          clearAuthSessionPersistence();
        }
        if (!session?.user) {
          router.replace("/login");
          return;
        }

        setUser(session.user);
      },
    );

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading your OTR workspace...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
        {error}
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children(user)}</>;
}
