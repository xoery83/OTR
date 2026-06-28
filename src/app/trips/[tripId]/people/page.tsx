"use client";

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
  group_member: "成员",
  guest: "访客",
};

const statusLabels: Record<JourneyMember["status"], string> = {
  linked: "已关联",
  invite_pending: "待登录",
  unlinked: "未关联",
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
  if (role === "owner") return "可以管理成员和旅程权限。";
  if (role === "guest") return "可以查看和评论，但不能添加主要内容。";
  return "可以编辑行程、添加记录和费用。";
}

function MembersPageContent() {
  const { tripId } = useParams<{ tripId: string }>();
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
          setError(getErrorMessage(membersError, "无法加载成员。"));
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
        notes: memberNotes,
      });
      setMembers((current) => [...current, created]);
      setDisplayName("");
      setInviteEmail("");
      setMemberNotes("");
      setRole("group_member");
      setNotice("成员已添加。");
    } catch (addError) {
      setError(getErrorMessage(addError, "无法添加成员。"));
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
      setError(getErrorMessage(roleError, "无法更新角色。"));
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
      setNotice("成员信息已保存。");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "无法保存成员信息。"));
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
        setError(`无法移除成员：${result.status.replaceAll("_", " ")}。`);
        return;
      }
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setNotice(
        member.userId
          ? "成员已移除，旅程访问权限已撤销。"
          : "未关联成员已移除。",
      );
    } catch (removeError) {
      setError(getErrorMessage(removeError, "无法移除成员。"));
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
        setNotice(`关联结果：${result.status.replaceAll("_", " ")}。`);
        return;
      }
      const refreshed = await getJourneyMembers(tripId);
      setMembers(refreshed);
      setNotice(`你已关联为 ${member.displayName}。`);
    } catch (claimError) {
      setError(getErrorMessage(claimError, "无法关联这个成员身份。"));
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
            成员
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
            管理这个 Journey 的同行成员、邮箱授权、角色和昵称 / 别名。
            Owner 填入成员邮箱后，成员使用同一个邮箱登录 OTR 就会看到这个旅程。
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
              添加成员
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              填写成员姓名和邮箱即可授权访问。邮箱可以之后再补；补上后，成员用该邮箱登录就能看到这个 Journey。
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
              <option value="group_member">成员</option>
              <option value="guest">访客</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="成员登录邮箱，可后补"
              type="email"
              className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm"
            />
            <button
              type="submit"
              disabled={isAdding || !displayName.trim()}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isAdding ? "正在添加..." : "添加"}
            </button>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-bold text-stone-700">
              昵称 / 别名
            </span>
            <input
              value={memberNotes}
              onChange={(event) => setMemberNotes(event.target.value)}
              placeholder="Bao 小宝 B，可用空格、逗号、/ 或 ; 分隔"
              className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm"
            />
            <span className="block text-[11px] leading-5 text-stone-500">
              用于帮助 OTR 在记录、行程、语音和支出中识别这个人。
            </span>
          </label>
        </form>
      ) : null}

      {!currentMember && unlinkedMembers.length > 0 ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-950">
            关联你的旅程身份
          </h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            如果 owner 已经先添加了你的名字，但还没有填邮箱，你可以在这里手动关联。
            更推荐让 owner 补上你的登录邮箱，之后系统会自动识别。
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
                    AKA {member.notes}
                  </span>
                ) : null}
                {!member.userId ? (
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500">
                    未关联
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
                      昵称 / 别名
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
                      placeholder="Bao 小宝 B，可用空格、逗号、/ 或 ; 分隔"
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
                      placeholder="成员登录邮箱"
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
                    <option value="group_member">成员</option>
                    <option value="guest">访客</option>
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() => saveMemberDetails(member)}
                      className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-60"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      disabled={isWorking || member.role === "owner"}
                      onClick={() => removeMember(member)}
                      className="rounded-full bg-red-50 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
                    >
                      {member.userId ? "移除权限" : "移除"}
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
                  {isWorking ? "正在关联..." : "关联这个身份"}
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
