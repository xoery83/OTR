import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/types";
import { getUserAvatarUrl, getUserDisplayName } from "./auth";
import { supabase } from "./client";

type ProfileRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
}

export async function upsertProfileForUser(user: User) {
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        display_name: getUserDisplayName(user),
        avatar_url: getUserAvatarUrl(user),
      },
      { onConflict: "id" },
    )
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
