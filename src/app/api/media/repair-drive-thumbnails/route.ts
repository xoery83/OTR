import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { decryptGoogleToken } from "@/lib/server/google-token";
import {
  googleDriveImageViewUrl,
  makeGoogleDriveFileReadableByLink,
  refreshGoogleDriveAccessToken,
} from "@/lib/storage/google-drive";

export const runtime = "nodejs";
export const maxDuration = 30;

type RepairRequest = {
  tripId?: string;
  assetIds?: string[];
};

type MediaAssetRow = {
  id: string;
  thumbnail_drive_file_id: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getRequestSupabase(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !supabaseAnonKey) throw new Error("Missing Supabase env.");
  if (!authorization) throw new Error("Missing authorization header.");

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authorizeTrip(input: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}) {
  const [{ data: profile }, { data: trip }, { data: member }] = await Promise.all([
    input.supabase
      .from("profiles")
      .select("account_role")
      .eq("id", input.userId)
      .maybeSingle(),
    input.supabase
      .from("trips")
      .select("created_by")
      .eq("id", input.tripId)
      .maybeSingle(),
    input.supabase
      .from("journey_members")
      .select("role")
      .eq("trip_id", input.tripId)
      .eq("user_id", input.userId)
      .maybeSingle(),
  ]);
  const isAdmin =
    (profile as { account_role?: string | null } | null)?.account_role === "admin";
  const isCreator =
    (trip as { created_by?: string | null } | null)?.created_by === input.userId;
  const isOwner = (member as { role?: string | null } | null)?.role === "owner";
  return isAdmin || isCreator || isOwner;
}

function normalizeAssetIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.length > 0),
    ),
  ].slice(0, 25);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RepairRequest;
    const tripId = typeof body.tripId === "string" ? body.tripId : "";
    const assetIds = normalizeAssetIds(body.assetIds);

    if (!tripId || assetIds.length === 0) {
      return jsonError("tripId and assetIds are required.", 400);
    }

    const requestSupabase = getRequestSupabase(request);
    const serviceSupabase = getServiceSupabase();
    if (!serviceSupabase) return jsonError("Service role key is not configured.", 500);

    const { data: userData, error: userError } = await requestSupabase.auth.getUser();
    if (userError || !userData.user) return jsonError("You must be logged in.", 401);
    const authorized = await authorizeTrip({
      supabase: requestSupabase,
      userId: userData.user.id,
      tripId,
    });
    if (!authorized) return jsonError("You cannot repair this Journey.", 403);

    const { data: connection, error: connectionError } = await serviceSupabase
      .from("journey_storage_connections")
      .select("token_reference")
      .eq("trip_id", tripId)
      .eq("provider", "google_drive")
      .eq("status", "connected")
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.token_reference) {
      return jsonError("Google Drive is not connected for this Journey.", 409);
    }

    const { data: rows, error: rowsError } = await serviceSupabase
      .from("media_assets")
      .select("id, thumbnail_drive_file_id")
      .eq("trip_id", tripId)
      .in("id", assetIds);
    if (rowsError) throw rowsError;

    const accessToken = await refreshGoogleDriveAccessToken(
      decryptGoogleToken(connection.token_reference),
    );
    const results = [];
    for (const row of (rows ?? []) as MediaAssetRow[]) {
      if (!row.thumbnail_drive_file_id) {
        results.push({ assetId: row.id, status: "skipped" });
        continue;
      }

      try {
        await makeGoogleDriveFileReadableByLink({
          accessToken,
          fileId: row.thumbnail_drive_file_id,
        });
        const thumbnailUrl = googleDriveImageViewUrl(row.thumbnail_drive_file_id);
        await serviceSupabase
          .from("media_assets")
          .update({
            thumbnail_drive_web_url: thumbnailUrl,
            provider_thumbnail_url: thumbnailUrl,
            processing_status: "ready",
          })
          .eq("id", row.id)
          .eq("trip_id", tripId);
        results.push({ assetId: row.id, status: "repaired" });
      } catch (error) {
        results.push({
          assetId: row.id,
          status: "failed",
          error: error instanceof Error ? error.message : "Repair failed.",
        });
      }
    }

    return NextResponse.json({ repaired: results, count: results.length });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Repair failed.", 500);
  }
}
