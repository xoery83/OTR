"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getErrorMessage } from "@/lib/errors";
import { acceptJourneyInvite } from "@/lib/supabase/invites";
import { supabase } from "@/lib/supabase/client";
import { upsertProfileForUser } from "@/lib/supabase/profiles";
import type { InviteAcceptStatus } from "@/types";

const statusCopy: Record<InviteAcceptStatus, string> = {
  joined: "You joined the journey.",
  already_member: "You are already a member.",
  expired: "This invite has expired.",
  invalid: "This invite is invalid.",
  full: "This invite has reached its use limit.",
  removed: "Your access to this journey was removed.",
};

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<InviteAcceptStatus | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function acceptInvite() {
      const { data } = await supabase.auth.getSession();

      if (!data.session?.user) {
        router.replace(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
        return;
      }

      try {
        await upsertProfileForUser(data.session.user);
        const result = await acceptJourneyInvite(token);

        if (isMounted) {
          setStatus(result.status);
          setTripId(result.tripId);
        }

        if (
          result.tripId &&
          (result.status === "joined" || result.status === "already_member")
        ) {
          setTimeout(() => router.replace(`/trips/${result.tripId}`), 1200);
        }
      } catch (inviteError) {
        if (isMounted) {
          setError(getErrorMessage(inviteError, "Could not accept invite."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    acceptInvite();

    return () => {
      isMounted = false;
    };
  }, [router, token]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-emerald-700">Journey invite</p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-950">
          {isLoading ? "Accepting invite..." : status ? statusCopy[status] : "Invite"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {isLoading
            ? "Checking your session and joining the journey."
            : tripId && (status === "joined" || status === "already_member")
              ? "Redirecting to the journey overview..."
              : "This invite could not be used."}
        </p>
        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        {tripId ? (
          <Link
            href={`/trips/${tripId}`}
            className="mt-5 inline-flex rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
          >
            Open Journey
          </Link>
        ) : (
          <Link
            href="/trips"
            className="mt-5 inline-flex rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
          >
            Back to Journeys
          </Link>
        )}
      </section>
    </div>
  );
}
