"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthGate } from "@/components/AuthGate";
import {
  LOCALE_PREFERENCE_CHANGED_EVENT,
  LOCALE_STORAGE_KEY,
} from "@/components/I18nProvider";
import { getErrorMessage } from "@/lib/errors";
import { logout } from "@/lib/supabase/auth";
import {
  accountRoles,
  getProfile,
  searchAccountRoles,
  updateAccountRole,
  updateProfile,
  type AccountRoleRow,
} from "@/lib/supabase/profiles";
import type { AccountRole, Profile } from "@/types";

const roleLabels: Record<AccountRole, string> = {
  admin: "管理员",
  free_user: "免费用户",
  plus: "Plus用户",
  pro: "Pro用户",
};

const languageOptions = [
  { value: "auto", label: "Auto" },
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

function syncLocalePreference(language: string) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, language);
  window.dispatchEvent(
    new CustomEvent(LOCALE_PREFERENCE_CHANGED_EVENT, {
      detail: { language },
    }),
  );
}

function SettingsContent({ user }: { user: User }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [languagePreference, setLanguagePreference] = useState("auto");
  const [roleSearchQuery, setRoleSearchQuery] = useState("");
  const [roleRows, setRoleRows] = useState<AccountRoleRow[]>([]);
  const [hasSearchedRoles, setHasSearchedRoles] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [isSavingLanguage, setIsSavingLanguage] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      try {
        const profileData = await getProfile(user.id);

        if (isMounted) {
          setProfile(profileData);
          setLanguagePreference(profileData.preferredLanguage || "auto");
          syncLocalePreference(profileData.preferredLanguage || "auto");
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

  const loadAccountRoles = useCallback(async () => {
    const query = roleSearchQuery.trim();
    if (query.length < 2) {
      setRoleRows([]);
      setHasSearchedRoles(false);
      setError("请输入至少 2 个字符搜索用户。");
      return;
    }

    setIsLoadingRoles(true);
    setError(null);
    setHasSearchedRoles(true);
    try {
      setRoleRows(await searchAccountRoles(query));
    } catch (roleError) {
      setError(getErrorMessage(roleError, "无法读取用户角色。"));
    } finally {
      setIsLoadingRoles(false);
    }
  }, [roleSearchQuery]);

  async function handleRoleChange(profileId: string, accountRole: AccountRole) {
    setUpdatingRoleId(profileId);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateAccountRole({ profileId, accountRole });
      setRoleRows((current) =>
        current.map((row) => (row.id === profileId ? updated : row)),
      );
      if (profileId === profile?.id) {
        setProfile({ ...profile, accountRole: updated.accountRole });
      }
      setNotice("角色已更新。");
    } catch (roleError) {
      setError(getErrorMessage(roleError, "无法更新用户角色。"));
    } finally {
      setUpdatingRoleId(null);
    }
  }

  async function handleLanguageSave() {
    if (!profile) return;

    setIsSavingLanguage(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateProfile({
        id: profile.id,
        displayName: profile.displayName,
        globalAka: profile.globalAka,
        globalBaseCurrency: profile.globalBaseCurrency,
        preferredLanguage: languagePreference,
        avatarUrl: profile.avatarUrl,
      });
      setProfile(updated);
      setLanguagePreference(updated.preferredLanguage || "auto");
      syncLocalePreference(updated.preferredLanguage || "auto");
      setNotice("Language preference saved.");
    } catch (languageError) {
      setError(
        getErrorMessage(languageError, "Could not save language preference."),
      );
    } finally {
      setIsSavingLanguage(false);
    }
  }

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
              <p className="mt-1 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                {profile ? roleLabels[profile.accountRole] : "免费用户"}
              </p>
            </div>
          </div>
        ) : null}

        {notice ? (
          <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {notice}
          </p>
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

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Language</p>
          <h2 className="mt-1 text-xl font-semibold text-stone-950">
            Display language
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Auto follows your browser language. Languages without a reviewed
            bundle fall back to English until generated.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={languagePreference}
            onChange={(event) => {
              const nextLanguage = event.target.value;
              setLanguagePreference(nextLanguage);
              syncLocalePreference(nextLanguage);
            }}
            disabled={isLoading || !profile || isSavingLanguage}
            className="min-h-12 flex-1 rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm font-bold text-stone-950 disabled:text-stone-400"
          >
            {languageOptions.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleLanguageSave}
            disabled={
              isLoading ||
              !profile ||
              isSavingLanguage ||
              languagePreference === (profile.preferredLanguage || "auto")
            }
            className="min-h-12 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {isSavingLanguage ? "Saving..." : "Save language"}
          </button>
        </div>
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

      {profile?.accountRole === "admin" ? (
        <section className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
          <div>
            <div>
              <p className="text-sm font-semibold text-emerald-700">Admin</p>
              <h2 className="mt-1 text-xl font-semibold text-stone-950">
                权限管理
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                管理用户角色。当前只用于权限可见性，会员功能差异后续再定义。
              </p>
            </div>
          </div>

          <Link
            href="/settings/admin/localization"
            className="mt-4 block rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm font-semibold text-sky-900 transition hover:border-sky-200 hover:bg-sky-100"
          >
            多语言管理：语言包预热、队列处理、机器翻译审核
          </Link>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadAccountRoles();
            }}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <input
              type="search"
              value={roleSearchQuery}
              onChange={(event) => {
                setRoleSearchQuery(event.target.value);
                if (!event.target.value.trim()) {
                  setRoleRows([]);
                  setHasSearchedRoles(false);
                }
              }}
              placeholder="搜索邮箱或姓名"
              className="min-h-12 flex-1 rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 text-sm font-semibold text-stone-950 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
            />
            <button
              type="submit"
              disabled={isLoadingRoles || roleSearchQuery.trim().length < 2}
              className="min-h-12 rounded-2xl bg-emerald-700 px-5 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isLoadingRoles ? "搜索中..." : "搜索用户"}
            </button>
          </form>

          {isLoadingRoles ? (
            <p className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-500">
              正在搜索用户...
            </p>
          ) : hasSearchedRoles && roleRows.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm font-semibold text-stone-500">
              没有找到匹配用户。
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {roleRows.map((row) => (
                <article
                  key={row.id}
                  className="flex flex-col gap-3 rounded-2xl border border-stone-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-emerald-100 text-sm font-black text-emerald-800">
                      {row.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        row.displayName.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-stone-950">
                        {row.displayName}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {row.email ?? "未绑定邮箱"}
                      </p>
                    </div>
                  </div>
                  <select
                    value={row.accountRole}
                    onChange={(event) =>
                      handleRoleChange(row.id, event.target.value as AccountRole)
                    }
                    disabled={updatingRoleId === row.id}
                    className="rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm font-bold text-stone-950 disabled:text-stone-400"
                  >
                    {accountRoles.map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  return <AuthGate>{(user) => <SettingsContent user={user} />}</AuthGate>;
}
