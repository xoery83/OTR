import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createGoogleDriveAuthUrl } from "../oauth";

type TripMemberRpcRow = {
  member_user_id: string;
  member_role: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getSupabaseForRequest(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  if (!authorization) {
    throw new Error("Missing authorization header.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { tripId?: string };
    const tripId = body.tripId;

    if (!tripId) {
      return jsonError("tripId is required.", 400);
    }

    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.replace(/^Bearer\s+/i, "");

    if (!accessToken) {
      return jsonError("You must be logged in.", 401);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const [{ data: trip, error: tripError }, { data: memberRows }] =
      await Promise.all([
        supabase.from("trips").select("id, created_by").eq("id", tripId).single(),
        supabase.rpc("get_trip_members_for_current_user", {
          target_trip_id: tripId,
        }),
      ]);

    if (tripError || !trip) {
      return jsonError("Journey not found.", 404);
    }

    const members = (memberRows ?? []) as TripMemberRpcRow[];
    const currentMember = members.find(
      (member) => member.member_user_id === userData.user.id,
    );
    const canConnect =
      trip.created_by === userData.user.id ||
      currentMember?.member_role === "owner" ||
      currentMember?.member_role === "admin";

    if (!canConnect) {
      return jsonError("Only journey owners and admins can connect storage.", 403);
    }

    const origin = new URL(request.url).origin;
    const authUrl = createGoogleDriveAuthUrl({
      origin,
      tripId,
      userId: userData.user.id,
    });

    const response = NextResponse.json({ authUrl });
    response.cookies.set("journey_gdrive_access", accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      maxAge: 10 * 60,
      path: "/api/google-drive",
    });

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start Google Drive.";
    return jsonError(message, 500);
  }
}
