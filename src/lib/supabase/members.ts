import type { TripMember } from "@/types";
import { supabase } from "./client";

type MemberRow = {
  id: string;
  trip_id: string;
  user_id: string;
  role: string | null;
  created_at: string;
  profiles:
    | {
        display_name: string | null;
        avatar_url: string | null;
      }
    | {
        display_name: string | null;
        avatar_url: string | null;
      }[]
    | null;
};

type MemberRpcRow = {
  member_id: string;
  member_trip_id: string;
  member_user_id: string;
  member_role: string | null;
  member_created_at: string;
  display_name: string | null;
  avatar_url: string | null;
};

function mapMember(row: MemberRow): TripMember {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;

  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    name: profile?.display_name || "Traveler",
    role: row.role ?? "member",
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: row.created_at,
  };
}

function mapRpcMember(row: MemberRpcRow): TripMember {
  return {
    id: row.member_id,
    tripId: row.member_trip_id,
    userId: row.member_user_id,
    name: row.display_name || "Traveler",
    role: row.member_role ?? "member",
    avatarUrl: row.avatar_url,
    createdAt: row.member_created_at,
  };
}

export async function getTripMembers(tripId: string) {
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_trip_members_for_current_user",
    { target_trip_id: tripId },
  );

  if (!rpcError) {
    return ((rpcData ?? []) as MemberRpcRow[]).map(mapRpcMember);
  }

  const { data, error } = await supabase
    .from("trip_members")
    .select("id, trip_id, user_id, role, created_at, profiles(display_name, avatar_url)")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as MemberRow[]).map(mapMember);
}
