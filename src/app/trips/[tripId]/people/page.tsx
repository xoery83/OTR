"use client";

import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { TranslatedText } from "@/components/TranslatedText";
import { getErrorMessage } from "@/lib/errors";
import { useJourneyCachedResource } from "@/hooks/useJourneyCachedResource";
import {
  journeyResourceKey,
  loadJourneyPeopleResource,
} from "@/lib/journey-resources";
import {
  claimJourneyMember,
  createJourneyMember,
  getJourneyMembers,
  removeJourneyMember,
  updateJourneyMember,
} from "@/lib/supabase/journey-members";
import type { JourneyMember, JourneyMemberRole, Trip } from "@/types";

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

function roleHelp(role: JourneyMemberRole, t: ReturnType<typeof useI18n>["t"]) {
  if (role === "owner") return t("people.role.ownerHelp");
  if (role === "guest") return t("people.role.guestHelp");
  return t("people.role.memberHelp");
}

function MembersPageContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const { t } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<JourneyMemberRole>("group_member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [memberNotes, setMemberNotes] = useState("");
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { displayName: string; notes: string; inviteEmail: string }>
  >({});
  const [isAdding, setIsAdding] = useState(false);
  const [workingMemberId, setWorkingMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const peopleResource = useJourneyCachedResource({
    cacheKey: journeyResourceKey.people(tripId),
    loader: () => loadJourneyPeopleResource(tripId),
    ttl: 2 * 60_000,
    staleTime: 30_000,
    keepPreviousData: true,
    backgroundRefresh: true,
  });

  useEffect(() => {
    if (!peopleResource.data) return;
    setTrip(peopleResource.data.tripData);
    setMembers(peopleResource.data.memberData);
    setCurrentUserId(peopleResource.data.currentUserId);
  }, [peopleResource.data]);

  useEffect(() => {
    if (!peopleResource.error || peopleResource.data) return;
    setError(getErrorMessage(peopleResource.error, t("people.error.load")));
  }, [peopleResource.data, peopleResource.error, t]);

  const currentMember = useMemo(
    () => members.find((member) => member.userId === currentUserId),
    [currentUserId, members],
  );
  const canManagePeople =
    currentMember?.role === "owner" || trip?.createdBy === currentUserId;
  const unlinkedMembers = members.filter((member) => !member.userId);
  const roleLabels: Record<JourneyMemberRole, string> = {
    owner: t("people.role.owner"),
    group_member: t("people.role.member"),
    guest: t("people.role.guest"),
  };
  const statusLabels: Record<JourneyMember["status"], string> = {
    linked: t("people.status.linked"),
    invite_pending: t("people.status.invitePending"),
    unlinked: t("people.status.unlinked"),
  };

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
        notes: memberNotes,
      });
      setMembers((current) => [...current, created]);
      setDisplayName("");
      setInviteEmail("");
      setMemberNotes("");
      setRole("group_member");
      setNotice(t("people.notice.added"));
    } catch (addError) {
      setError(getErrorMessage(addError, t("people.error.add")));
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
      setError(getErrorMessage(roleError, t("people.error.updateRole")));
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
      setNotice(t("people.notice.saved"));
    } catch (saveError) {
      setError(getErrorMessage(saveError, t("people.error.save")));
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
        setError(t("people.error.removeStatus", { status: result.status.replaceAll("_", " ") }));
        return;
      }
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setNotice(
        member.userId
          ? t("people.notice.removedLinked")
          : t("people.notice.removedUnlinked"),
      );
    } catch (removeError) {
      setError(getErrorMessage(removeError, t("people.error.remove")));
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
        setNotice(t("people.notice.claimResult", { status: result.status.replaceAll("_", " ") }));
        return;
      }
      const refreshed = await getJourneyMembers(tripId);
      setMembers(refreshed);
      setNotice(t("people.notice.claimed", { name: member.displayName }));
    } catch (claimError) {
      setError(getErrorMessage(claimError, t("people.error.claim")));
    } finally {
      setWorkingMemberId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            {trip?.name ? (
              <TranslatedText
                as="span"
                showToggle={false}
                sourceField="name"
                sourceId={trip.id}
                sourceType="trip"
                text={trip.name}
              />
            ) : (
              t("common.journey")
            )}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-950">
            {t("people.title")}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
            {t("people.description")}
          </p>
        </div>
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
              {t("people.add.title")}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {t("people.add.description")}
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
              <option value="group_member">{roleLabels.group_member}</option>
              <option value="guest">{roleLabels.guest}</option>
              <option value="owner">{roleLabels.owner}</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder={t("people.placeholder.emailOptional")}
              type="email"
              className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm"
            />
            <button
              type="submit"
              disabled={isAdding || !displayName.trim()}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isAdding ? t("common.adding") : t("common.add")}
            </button>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-stone-700">
              {t("people.alias")}
            </span>
            <input
              value={memberNotes}
              onChange={(event) => setMemberNotes(event.target.value)}
              placeholder={t("people.placeholder.alias")}
              className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm"
            />
            <span className="block text-[11px] leading-5 text-stone-500">
              {t("people.aliasHelp")}
            </span>
          </label>
        </form>
      ) : null}

      {!currentMember && unlinkedMembers.length > 0 ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-950">
            {t("people.claim.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            {t("people.claim.description")}
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
                      {roleHelp(member.role, t)}
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${statusClass(
                    member.status,
                  )}`}
                >
                  {statusLabels[member.status]}
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
                {member.notes ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                    {t("people.aka", { notes: member.notes })}
                  </span>
                ) : null}
                {!member.userId ? (
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500">
                    {t("people.status.unlinked")}
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
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-600">
                      {t("people.alias")}
                    </span>
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
                      placeholder={t("people.placeholder.alias")}
                      className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-3 py-2 text-sm"
                    />
                  </label>
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
                      placeholder={t("people.placeholder.email")}
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
                    <option value="owner">{roleLabels.owner}</option>
                    <option value="group_member">{roleLabels.group_member}</option>
                    <option value="guest">{roleLabels.guest}</option>
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() => saveMemberDetails(member)}
                      className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-60"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      disabled={isWorking || member.role === "owner"}
                      onClick={() => removeMember(member)}
                      className="rounded-full bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
                    >
                      {member.userId ? t("people.removeAccess") : t("common.remove")}
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
                  {isWorking ? t("people.claim.working") : t("people.claim.action")}
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
