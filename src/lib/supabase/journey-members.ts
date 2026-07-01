import type {
  ClaimJourneyMemberStatus,
  JourneyMember,
  JourneyMemberRole,
  JourneyMemberStatus,
  RemoveJourneyMemberStatus,
} from "@/types";
import { getCurrentUser } from "./auth";
import { supabase } from "./client";
import { getTripsForCurrentUser } from "./trips";

type JourneyMemberRpcRow = {
  member_id: string;
  member_trip_id: string;
  member_user_id: string | null;
  member_display_name: string;
  member_avatar_url: string | null;
  member_role: JourneyMemberRole;
  member_status: JourneyMemberStatus;
  member_notes: string | null;
  member_invite_email: string | null;
  member_linked_at: string | null;
  member_created_at: string;
  profile_display_name: string | null;
  profile_avatar_url: string | null;
};

type JourneyMemberRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  display_name: string;
  avatar_url: string | null;
  role: JourneyMemberRole;
  status: JourneyMemberStatus;
  notes: string | null;
  invite_email: string | null;
  linked_at: string | null;
  created_at: string;
};

type CreateJourneyMemberInput = {
  tripId: string;
  displayName: string;
  role: JourneyMemberRole;
  inviteEmail?: string;
  notes?: string;
};

type UpdateJourneyMemberInput = {
  memberId: string;
  displayName?: string;
  role?: JourneyMemberRole;
  status?: JourneyMemberStatus;
  inviteEmail?: string;
  notes?: string;
};

type EmailInvitedJourneyClaimRow = {
  claimed_trip_id: string | null;
  claimed_member_id: string | null;
  claim_status: string;
};

function createInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeInviteEmail(value: string | undefined) {
  return value?.trim().toLowerCase() || null;
}

function isMissingEmailClaimFunction(error: { code?: string; message?: string }) {
  return (
    error.code === "42883" ||
    /claim_email_invited_journeys/i.test(error.message ?? "")
  );
}

function mapJourneyMember(row: JourneyMemberRpcRow | JourneyMemberRow): JourneyMember {
  if ("member_id" in row) {
    return {
      id: row.member_id,
      tripId: row.member_trip_id,
      userId: row.member_user_id,
      displayName: row.member_display_name || row.profile_display_name || "Traveler",
      avatarUrl: row.profile_avatar_url || row.member_avatar_url,
      role: row.member_role,
      status: row.member_status,
      notes: row.member_notes,
      inviteEmail: row.member_invite_email,
      linkedAt: row.member_linked_at,
      createdAt: row.member_created_at,
    };
  }

  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    notes: row.notes,
    inviteEmail: row.invite_email,
    linkedAt: row.linked_at,
    createdAt: row.created_at,
  };
}

export async function getJourneyMembers(tripId: string) {
  const { data, error } = await supabase.rpc(
    "get_journey_members_for_current_user",
    { target_trip_id: tripId },
  );

  if (error) throw error;
  return ((data ?? []) as JourneyMemberRpcRow[]).map(mapJourneyMember);
}

export async function claimEmailInvitedJourneys() {
  const { data, error } = await supabase.rpc("claim_email_invited_journeys");

  if (error) {
    if (isMissingEmailClaimFunction(error)) return [];
    throw error;
  }

  return (data ?? []) as EmailInvitedJourneyClaimRow[];
}

export async function createJourneyMember(input: CreateJourneyMemberInput) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to add people.");

  const normalizedInviteEmail = normalizeInviteEmail(input.inviteEmail);
  const status: JourneyMemberStatus = normalizedInviteEmail
    ? "invite_pending"
    : "unlinked";

  const { data, error } = await supabase
    .from("journey_members")
    .insert({
      trip_id: input.tripId,
      display_name: input.displayName.trim(),
      role: input.role,
      status,
      invite_email: normalizedInviteEmail,
      invite_code: createInviteCode(),
      invited_by_user_id: user.id,
      notes: input.notes?.trim() || null,
    })
    .select(
      "id, trip_id, user_id, display_name, avatar_url, role, status, notes, invite_email, linked_at, created_at",
    )
    .single();

  if (error) throw error;
  return mapJourneyMember(data as JourneyMemberRow);
}

export type JourneyMemberSuggestion = {
  key: string;
  displayName: string;
  inviteEmail: string;
  notes: string;
  userId: string | null;
  avatarUrl: string | null;
  journeysTogether: number;
  isCurrentUser: boolean;
};

export async function getJourneyMemberSuggestions() {
  const user = await getCurrentUser();
  const trips = await getTripsForCurrentUser();
  const members = (await Promise.all(trips.map((trip) => getJourneyMembers(trip.id))))
    .flat()
    .filter(
      (member) =>
        member.role === "group_member" || member.role === "guest" || member.userId === user?.id,
    );
  const suggestions = new Map<string, JourneyMemberSuggestion>();

  members.forEach((member) => {
    const normalizedName = member.displayName.trim().toLocaleLowerCase();
    if (!normalizedName) return;

    const key = member.userId || member.inviteEmail || normalizedName;
    const existing = suggestions.get(key);

    if (existing) {
      existing.journeysTogether += 1;
      if (!existing.inviteEmail && member.inviteEmail) {
        existing.inviteEmail = member.inviteEmail;
      }
      if (!existing.avatarUrl && member.avatarUrl) {
        existing.avatarUrl = member.avatarUrl;
      }
      if (!existing.notes && member.notes) {
        existing.notes = member.notes;
      }
      if (member.userId === user?.id) {
        existing.isCurrentUser = true;
      }
      return;
    }

    suggestions.set(key, {
      key,
      displayName: member.displayName,
      inviteEmail: member.inviteEmail ?? "",
      notes: member.notes ?? "",
      userId: member.userId,
      avatarUrl: member.avatarUrl,
      journeysTogether: 1,
      isCurrentUser: member.userId === user?.id,
    });
  });

  return [...suggestions.values()].sort(
    (left, right) => right.journeysTogether - left.journeysTogether,
  );
}

export async function updateJourneyMember(input: UpdateJourneyMemberInput) {
  const patch: Partial<JourneyMemberRow> = {};

  if (input.displayName !== undefined) patch.display_name = input.displayName.trim();
  if (input.role !== undefined) patch.role = input.role;
  if (input.status !== undefined) patch.status = input.status;
  if (input.inviteEmail !== undefined) {
    patch.invite_email = normalizeInviteEmail(input.inviteEmail);
  }
  if (input.notes !== undefined) patch.notes = input.notes.trim() || null;

  const { data, error } = await supabase
    .from("journey_members")
    .update(patch)
    .eq("id", input.memberId)
    .select(
      "id, trip_id, user_id, display_name, avatar_url, role, status, notes, invite_email, linked_at, created_at",
    )
    .single();

  if (error) throw error;
  return mapJourneyMember(data as JourneyMemberRow);
}

export async function updateOwnJourneyMemberNotes(input: {
  memberId: string;
  notes: string;
}) {
  const { data, error } = await supabase
    .rpc("update_own_journey_member_notes", {
      target_member_id: input.memberId,
      next_notes: input.notes,
    })
    .single();

  if (error) throw error;
  return mapJourneyMember(data as JourneyMemberRow);
}

export async function removeJourneyMember(memberId: string) {
  const { data, error } = await supabase.rpc("remove_journey_member", {
    target_member_id: memberId,
    revoke_matching_invites: true,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  return {
    tripId: result?.removed_trip_id as string | null,
    status: result?.remove_status as RemoveJourneyMemberStatus,
  };
}

export async function claimJourneyMember(memberId: string) {
  const { data, error } = await supabase.rpc("claim_journey_member", {
    target_member_id: memberId,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  return {
    memberId: result?.claimed_member_id as string | null,
    tripId: result?.claimed_trip_id as string | null,
    status: result?.claim_status as ClaimJourneyMemberStatus,
  };
}
