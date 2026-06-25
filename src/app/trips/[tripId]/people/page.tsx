"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { getCurrentUser } from "@/lib/supabase/auth";
import {
  claimJourneyMember,
  createJourneyMember,
  getJourneyMembers,
  removeJourneyMember,
  updateJourneyMember,
} from "@/lib/supabase/journey-members";
import { getTrip } from "@/lib/supabase/trips";
import type { JourneyMember, JourneyMemberRole, Trip } from "@/types";

const roleLabels: Record<JourneyMemberRole, string> = {
  owner: "Owner",
  group_member: "Group Member",
  guest: "Guest",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function statusClass(status: JourneyMember["status"]) {
  if (status === "linked") return "bg-emerald-50 text-emerald-800";
  if (status === "invite_pending") return "bg-amber-50 text-amber-800";
  return "bg-stone-100 text-stone-600";
}

function roleHelp(role: JourneyMemberRole) {
  if (role === "owner") return "Can manage people and permissions.";
  if (role === "guest") return "Can view and comment, but not add main memories.";
  return "Can edit planner and add main memories.";
}

function MembersPageContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<JourneyMemberRole>("group_member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { displayName: string; notes: string; inviteEmail: string }>
  >({});
  const [isAdding, setIsAdding] = useState(false);
  const [workingMemberId, setWorkingMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadMembers() {
      try {
        const [tripData, memberData, user] = await Promise.all([
          getTrip(tripId),
          getJourneyMembers(tripId),
          getCurrentUser(),
        ]);
        if (isMounted) {
          setTrip(tripData);
          setMembers(memberData);
          setCurrentUserId(user?.id ?? null);
        }
      } catch (membersError) {
        if (isMounted) {
          setError(getErrorMessage(membersError, "Could not load people."));
        }
      }
    }

    loadMembers();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  const currentMember = useMemo(
    () => members.find((member) => member.userId === currentUserId),
    [currentUserId, members],
  );
  const canManagePeople =
    currentMember?.role === "owner" || trip?.createdBy === currentUserId;
  const unlinkedMembers = members.filter((member) => !member.userId);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsAdding(true);
    try {
      const created = await createJourneyMember({
        tripId,
        displayName,
        role,
        inviteEmail,
      });
      setMembers((current) => [...current, created]);
      setDisplayName("");
      setInviteEmail("");
      setRole("group_member");
      setNotice("Member added.");
    } catch (addError) {
      setError(getErrorMessage(addError, "Could not add member."));
    } finally {
      setIsAdding(false);
    }
  }

  async function changeRole(member: JourneyMember, nextRole: JourneyMemberRole) {
    setWorkingMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateJourneyMember({
        memberId: member.id,
        role: nextRole,
      });
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (roleError) {
      setError(getErrorMessage(roleError, "Could not update role."));
    } finally {
      setWorkingMemberId(null);
    }
  }

  async function saveMemberDetails(member: JourneyMember) {
    const draft = editDrafts[member.id] ?? {
      displayName: member.displayName,
      notes: member.notes ?? "",
      inviteEmail: member.inviteEmail ?? "",
    };

    setWorkingMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateJourneyMember({
        memberId: member.id,
        displayName: draft.displayName,
        notes: draft.notes,
        inviteEmail: draft.inviteEmail,
      });
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice("Member details saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save member."));
    } finally {
      setWorkingMemberId(null);
    }
  }

  async function markInvitePending(member: JourneyMember) {
    setWorkingMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateJourneyMember({
        memberId: member.id,
        status: "invite_pending",
      });
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice("Member marked as invite pending.");
    } catch (inviteError) {
      setError(getErrorMessage(inviteError, "Could not update invite status."));
    } finally {
      setWorkingMemberId(null);
    }
  }

  async function removeMember(member: JourneyMember) {
    setWorkingMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      const result = await removeJourneyMember(member.id);
      if (result.status !== "removed") {
        setError(`Could not remove member: ${result.status.replaceAll("_", " ")}.`);
        return;
      }
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setNotice(
        member.userId
          ? "Member removed and journey access revoked."
          : "Unlinked member removed.",
      );
    } catch (removeError) {
      setError(getErrorMessage(removeError, "Could not remove member."));
    } finally {
      setWorkingMemberId(null);
    }
  }

  async function claimMember(member: JourneyMember) {
    setWorkingMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      const result = await claimJourneyMember(member.id);
      if (result.status !== "claimed") {
        setNotice(`Claim result: ${result.status.replaceAll("_", " ")}.`);
        return;
      }
      const refreshed = await getJourneyMembers(tripId);
      setMembers(refreshed);
      setNotice(`You are now linked as ${member.displayName}.`);
    } catch (claimError) {
      setError(getErrorMessage(claimError, "Could not claim member."));
    } finally {
      setWorkingMemberId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            {trip?.name || "Journey"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-950">
            People
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
            Manage the real people in this journey, including invited travelers
            who have not linked an account yet.
          </p>
        </div>
        {canManagePeople ? (
          <Link
            href={`/trips/${tripId}/invite`}
            className="shrink-0 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
          >
            Invite
          </Link>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {notice}
        </p>
      ) : null}

      {canManagePeople ? (
        <form
          onSubmit={addMember}
          className="space-y-3 rounded-3xl border border-stone-200 bg-white p-4 shadow-sm"
        >
          <div>
            <h2 className="text-lg font-semibold text-stone-950">
              Add Group Member
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Add someone to the journey before they create an account.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Bao"
              required
              className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm"
            />
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as JourneyMemberRole)
              }
              className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm"
            >
              <option value="group_member">Group Member</option>
              <option value="guest">Guest</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="Optional invite email"
              type="email"
              className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm"
            />
            <button
              type="submit"
              disabled={isAdding || !displayName.trim()}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isAdding ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      ) : null}

      {!currentMember && unlinkedMembers.length > 0 ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-950">
            Claim your travel identity
          </h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            If the owner already added your name, claim it here after joining
            the journey.
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        {members.map((member) => {
          const isWorking = workingMemberId === member.id;
          const canClaim =
            !currentMember &&
            !member.userId &&
            member.role !== "owner" &&
            currentUserId;

          return (
            <article
              key={member.id}
              className={`rounded-3xl border bg-white p-5 shadow-sm ${
                member.userId ? "border-stone-100" : "border-dashed border-stone-300"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`grid size-12 shrink-0 place-items-center overflow-hidden rounded-full font-bold ${
                      member.userId
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    {member.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials(member.displayName)
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-stone-950">
                      {member.displayName}
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-stone-500">
                      {roleHelp(member.role)}
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${statusClass(
                    member.status,
                  )}`}
                >
                  {member.status.replace("_", " ")}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700">
                  {roleLabels[member.role]}
                </span>
                {member.inviteEmail ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                    {member.inviteEmail}
                  </span>
                ) : null}
                {!member.userId ? (
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500">
                    Not linked
                  </span>
                ) : null}
              </div>

              {canManagePeople ? (
                <div className="mt-4 grid gap-2">
                  <input
                    value={
                      editDrafts[member.id]?.displayName ?? member.displayName
                    }
                    disabled={isWorking}
                    onChange={(event) =>
                      setEditDrafts((current) => ({
                        ...current,
                        [member.id]: {
                          displayName: event.target.value,
                          notes: current[member.id]?.notes ?? member.notes ?? "",
                          inviteEmail:
                            current[member.id]?.inviteEmail ??
                            member.inviteEmail ??
                            "",
                        },
                      }))
                    }
                    className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm"
                  />
                  <input
                    value={editDrafts[member.id]?.notes ?? member.notes ?? ""}
                    disabled={isWorking}
                    onChange={(event) =>
                      setEditDrafts((current) => ({
                        ...current,
                        [member.id]: {
                          displayName:
                            current[member.id]?.displayName ?? member.displayName,
                          notes: event.target.value,
                          inviteEmail:
                            current[member.id]?.inviteEmail ??
                            member.inviteEmail ??
                            "",
                        },
                      }))
                    }
                    placeholder="Notes"
                    className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm"
                  />
                  {!member.userId ? (
                    <input
                      value={
                        editDrafts[member.id]?.inviteEmail ??
                        member.inviteEmail ??
                        ""
                      }
                      disabled={isWorking}
                      onChange={(event) =>
                        setEditDrafts((current) => ({
                          ...current,
                          [member.id]: {
                            displayName:
                              current[member.id]?.displayName ??
                              member.displayName,
                            notes: current[member.id]?.notes ?? member.notes ?? "",
                            inviteEmail: event.target.value,
                          },
                        }))
                      }
                      placeholder="Invitee email for claiming"
                      type="email"
                      className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm"
                    />
                  ) : null}
                  <select
                    value={member.role}
                    disabled={isWorking}
                    onChange={(event) =>
                      changeRole(member, event.target.value as JourneyMemberRole)
                    }
                    className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm"
                  >
                    <option value="owner">Owner</option>
                    <option value="group_member">Group Member</option>
                    <option value="guest">Guest</option>
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() => saveMemberDetails(member)}
                      className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-60"
                    >
                      Save
                    </button>
                    {!member.userId ? (
                      <button
                        type="button"
                        disabled={isWorking}
                        onClick={() => markInvitePending(member)}
                        className="rounded-full bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 disabled:opacity-60"
                      >
                        Invite pending
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={isWorking || member.role === "owner"}
                      onClick={() => removeMember(member)}
                      className="rounded-full bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
                    >
                      {member.userId ? "Remove access" : "Remove"}
                    </button>
                  </div>
                </div>
              ) : null}

              {canClaim ? (
                <button
                  type="button"
                  disabled={isWorking}
                  onClick={() => claimMember(member)}
                  className="mt-4 w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-stone-300"
                >
                  {isWorking ? "Claiming..." : "Claim this identity"}
                </button>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}

export default function JourneyPeoplePage() {
  return <AuthGate>{() => <MembersPageContent />}</AuthGate>;
}
