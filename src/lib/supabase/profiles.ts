import type { User } from "@supabase/supabase-js";
import type { AccountRole, Profile } from "@/types";
import { getUserAvatarUrl, getUserDisplayName } from "./auth";
import { supabase } from "./client";

export const accountRoles = ["admin", "free_user", "plus", "pro"] as const;

type ProfileRow = {
  id: string;
  display_name: string;
  global_aka?: string | null;
  avatar_url: string | null;
  account_role?: AccountRole | null;
  created_at: string;
};

export type AccountRoleRow = {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  accountRole: AccountRole;
  createdAt: string;
};

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    globalAka: row.global_aka ?? null,
    avatarUrl: row.avatar_url,
    accountRole: row.account_role ?? "free_user",
    createdAt: row.created_at,
  };
}

function mapAccountRoleRow(row: {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  account_role: AccountRole;
  created_at: string;
}): AccountRoleRow {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    accountRole: row.account_role,
    createdAt: row.created_at,
  };
}

export async function upsertProfileForUser(user: User) {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return mapProfile(existing as ProfileRow);
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      display_name: getUserDisplayName(user),
      avatar_url: getUserAvatarUrl(user),
      account_role:
        user.email?.toLocaleLowerCase() === "xoery83@gmail.com"
          ? "admin"
          : "free_user",
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapProfile(data);
}

export async function listAccountRoles() {
  const { data, error } = await supabase.rpc("list_account_roles");

  if (error) {
    throw error;
  }

  return ((data ?? []) as Parameters<typeof mapAccountRoleRow>[0][]).map(
    mapAccountRoleRow,
  );
}

export async function updateAccountRole(input: {
  profileId: string;
  accountRole: AccountRole;
}) {
  const { data, error } = await supabase.rpc("update_profile_account_role", {
    target_profile_id: input.profileId,
    next_account_role: input.accountRole,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("Could not update account role.");
  }

  return mapAccountRoleRow(row as Parameters<typeof mapAccountRoleRow>[0]);
}

export async function updateProfile(input: {
  id: string;
  displayName: string;
  globalAka?: string | null;
  avatarUrl: string | null;
}) {
  const payload: Record<string, string | null> = {
    display_name: input.displayName.trim(),
    avatar_url: input.avatarUrl?.trim() || null,
  };

  if (input.globalAka !== undefined) {
    payload.global_aka = input.globalAka?.trim() || null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapProfile(data);
}

export async function getProfile(profileId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .single();

  if (error) {
    throw error;
  }

  return mapProfile(data);
}
