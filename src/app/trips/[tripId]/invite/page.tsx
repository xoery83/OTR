"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { getAppOrigin } from "@/lib/app-url";
import {
  createJourneyInvite,
  getJourneyInvites,
} from "@/lib/supabase/invites";
import { getTrip } from "@/lib/supabase/trips";
import type { JourneyInvite, JourneyInviteRole, Trip } from "@/types";

function InvitePageContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [invites, setInvites] = useState<JourneyInvite[]>([]);
  const [role, setRole] = useState<JourneyInviteRole>("member");
  const [expiresInDays, setExpiresInDays] = useState<"7" | "30" | "never">("7");
  const [maxUses, setMaxUses] = useState(20);
  const [invitedEmail, setInvitedEmail] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadInvites() {
      try {
        const [tripData, inviteData] = await Promise.all([
          getTrip(tripId),
          getJourneyInvites(tripId),
        ]);
        if (isMounted) {
          setTrip(tripData);
          setInvites(inviteData);
        }
      } catch (inviteError) {
        if (isMounted) setError(getErrorMessage(inviteError, "Could not load invites."));
      }
    }
    loadInvites();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const origin = useMemo(
    () => getAppOrigin(),
    [],
  );

  function inviteUrl(invite: JourneyInvite) {
    return `${origin}/invite/${invite.token}`;
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const invite = await createJourneyInvite({
        tripId,
        role,
        expiresInDays,
        maxUses,
        invitedEmail,
      });
      setInvites((current) => [invite, ...current]);
      setInvitedEmail("");
    } catch (inviteError) {
      setError(getErrorMessage(inviteError, "Could not create invite."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyInvite(invite: JourneyInvite) {
    const url = inviteUrl(invite);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(invite.token);
    } catch {
      setCopiedToken(null);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {trip?.name || "Journey"}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Invite people
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Create a simple invite link to share through any app.
        </p>
      </section>

      <form onSubmit={createInvite} className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as JourneyInviteRole)}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <select
            value={expiresInDays}
            onChange={(event) =>
              setExpiresInDays(event.target.value as "7" | "30" | "never")
            }
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="never">never</option>
          </select>
          <select
            value={maxUses}
            onChange={(event) => setMaxUses(Number(event.target.value))}
            className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
          >
            <option value={1}>1 use</option>
            <option value={7}>7 uses</option>
            <option value={20}>20 uses</option>
          </select>
        </div>
        <input
          value={invitedEmail}
          onChange={(event) => setInvitedEmail(event.target.value)}
          placeholder="Optional email note"
          className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          Create invite link
        </button>
        {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
      </form>

      <section className="space-y-4">
        {invites.map((invite) => (
          <article key={invite.id} className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                {invite.role}
              </span>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600">
                {invite.usedCount}/{invite.maxUses} used
              </span>
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600">
                {invite.expiresAt
                  ? `expires ${new Date(invite.expiresAt).toLocaleDateString()}`
                  : "never expires"}
              </span>
            </div>
            <p className="mt-4 break-all rounded-xl bg-stone-50 p-3 text-sm text-stone-700">
              {inviteUrl(invite)}
            </p>
            <button
              type="button"
              onClick={() => copyInvite(invite)}
              className="mt-3 rounded-2xl bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-900"
            >
              {copiedToken === invite.token ? "Copied" : "Copy link"}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

export default function JourneyInvitePage() {
  return <AuthGate>{() => <InvitePageContent />}</AuthGate>;
}
