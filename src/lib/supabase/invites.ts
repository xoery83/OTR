import type {
  InviteAcceptStatus,
  JourneyInvite,
  JourneyInviteRole,
} from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";

type InviteRow = {
  id: string;
  trip_id: string;
  token: string;
  invited_email: string | null;
  role: JourneyInviteRole;
  created_by: string | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number | null;
  is_active: boolean | null;
  created_at: string;
};

type CreateInviteInput = {
  tripId: string;
  invitedEmail?: string;
  role: JourneyInviteRole;
  expiresInDays: "7" | "30" | "never";
  maxUses: number;
};

function mapInvite(row: InviteRow): JourneyInvite {
  return {
    id: row.id,
    tripId: row.trip_id,
    token: row.token,
    invitedEmail: row.invited_email,
    role: row.role,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    maxUses: row.max_uses ?? 20,
    usedCount: row.used_count ?? 0,
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
  };
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getExpiresAt(value: CreateInviteInput["expiresInDays"]) {
  if (value === "never") {
    return null;
  }

  const date = new Date();
  date.setDate(date.getDate() + Number(value));
  return date.toISOString();
}

export async function createJourneyInvite(input: CreateInviteInput) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to create an invite.");

  const { data, error } = await supabase
    .from("journey_invites")
    .insert({
      trip_id: input.tripId,
      token: createToken(),
      invited_email: input.invitedEmail || null,
      role: input.role,
      expires_at: getExpiresAt(input.expiresInDays),
      max_uses: input.maxUses,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) throw error;
  return mapInvite(data);
}

export async function getJourneyInvites(tripId: string) {
  const { data, error } = await supabase
    .from("journey_invites")
    .select("*")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapInvite);
}

export async function revokeJourneyInvite(inviteId: string) {
  const { data, error } = await supabase
    .from("journey_invites")
    .update({ is_active: false })
    .eq("id", inviteId)
    .select("*")
    .single();

  if (error) throw error;
  return mapInvite(data);
}

export async function acceptJourneyInvite(token: string) {
  const { data, error } = await supabase.rpc("accept_journey_invite", {
    invite_token: token,
  });

  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    tripId: (result?.accepted_trip_id ?? result?.trip_id) as string | null,
    status: (result?.invite_status ?? result?.status) as InviteAcceptStatus,
  };
}
