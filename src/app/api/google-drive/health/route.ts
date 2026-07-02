import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { decryptGoogleToken } from "@/lib/server/google-token";
import { refreshGoogleDriveAccessToken } from "@/lib/storage/google-drive";

export const runtime = "nodejs";

const RECONNECT_MESSAGE =
  "Google Drive 连接已失效，请到行程设置重新连接云盘后再上传。";

type StorageConnectionRow = {
  token_reference: string | null;
  status: "connected" | "disconnected" | "error";
  metadata: Record<string, unknown> | null;
};

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status });
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

function isGoogleDriveTokenExpiredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /token has been expired or revoked|invalid_grant|expired|revoked/i.test(
    message,
  );
}

async function markGoogleDriveError(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  metadata: Record<string, unknown> | null;
  reason: string;
}) {
  const nextMetadata = {
    ...(input.metadata ?? {}),
    health: {
      status: "error",
      checkedAt: new Date().toISOString(),
      reason: input.reason,
    },
  };

  await Promise.allSettled([
    input.supabase
      .from("journey_storage_connections")
      .update({ status: "error", metadata: nextMetadata })
      .eq("trip_id", input.tripId)
      .eq("provider", "google_drive"),
    input.supabase
      .from("trips")
      .update({ photo_storage_status: "error" })
      .eq("id", input.tripId),
  ]);
}

async function markGoogleDriveHealthy(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  metadata: Record<string, unknown> | null;
}) {
  const nextMetadata = {
    ...(input.metadata ?? {}),
    health: {
      status: "connected",
      checkedAt: new Date().toISOString(),
    },
  };

  await Promise.allSettled([
    input.supabase
      .from("journey_storage_connections")
      .update({ status: "connected", metadata: nextMetadata })
      .eq("trip_id", input.tripId)
      .eq("provider", "google_drive"),
    input.supabase
      .from("trips")
      .update({ photo_storage_status: "connected" })
      .eq("id", input.tripId),
  ]);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      tripId?: string;
    };
    const tripId = body.tripId?.trim();
    if (!tripId) return json({ healthy: false, error: "tripId is required." }, 400);

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return json({ healthy: false, error: "You must be logged in." }, 401);
    }

    const { data: connection, error } = await supabase
      .from("journey_storage_connections")
      .select("token_reference, status, metadata")
      .eq("trip_id", tripId)
      .eq("provider", "google_drive")
      .maybeSingle();

    if (error) throw error;
    const row = connection as StorageConnectionRow | null;
    if (!row?.token_reference || row.status === "disconnected") {
      return json({
        healthy: false,
        status: row?.status ?? "not_connected",
        needsReconnect: true,
        message: "请先在行程设置中连接 Google Drive。",
      });
    }

    try {
      const refreshToken = decryptGoogleToken(row.token_reference);
      await refreshGoogleDriveAccessToken(refreshToken);
      await markGoogleDriveHealthy({ supabase, tripId, metadata: row.metadata });
      return json({ healthy: true, status: "connected", needsReconnect: false });
    } catch (refreshError) {
      const reason =
        refreshError instanceof Error ? refreshError.message : "Could not refresh token.";
      await markGoogleDriveError({
        supabase,
        tripId,
        metadata: row.metadata,
        reason,
      });
      return json(
        {
          healthy: false,
          status: "error",
          needsReconnect: true,
          message: isGoogleDriveTokenExpiredError(refreshError)
            ? RECONNECT_MESSAGE
            : `Google Drive 连接检查失败：${reason}`,
        },
        409,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not check Google Drive.";
    return json({ healthy: false, error: message }, 500);
  }
}
