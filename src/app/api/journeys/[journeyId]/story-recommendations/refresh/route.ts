import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { refreshStoryRecommendations } from "@/lib/story-recommendations";

type RefreshRequest = {
  mode?: string;
  limit?: number;
  language?: string | null;
};

type ProfileRow = {
  account_role?: string | null;
};

type TripRow = {
  id: string;
  created_by?: string | null;
};

type MemberRow = {
  role?: string | null;
};

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [
      record.message,
      record.details,
      record.hint,
      record.code ? `code: ${record.code}` : null,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  return fallback;
}

function getRequestSupabase(request: Request) {
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

function normalizeLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 5);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(Math.floor(parsed), 5));
}

async function assertCanRefresh(input: {
  supabase: SupabaseClient;
  journeyId: string;
  userId: string;
}) {
  const [{ data: profile, error: profileError }, { data: trip }, { data: member }] =
    await Promise.all([
      input.supabase
        .from("profiles")
        .select("account_role")
        .eq("id", input.userId)
        .maybeSingle(),
      input.supabase
        .from("trips")
        .select("id, created_by")
        .eq("id", input.journeyId)
        .maybeSingle(),
      input.supabase
        .from("journey_members")
        .select("role")
        .eq("trip_id", input.journeyId)
        .eq("user_id", input.userId)
        .maybeSingle(),
    ]);

  if (profileError) throw profileError;
  if (!trip) {
    throw new HttpError("You must be a journey member to refresh recommendations.", 403);
  }

  const isSystemAdmin =
    ((profile as ProfileRow | null)?.account_role ?? null) === "admin";
  const isCreator = ((trip as TripRow | null)?.created_by ?? null) === input.userId;
  const isOwner = ((member as MemberRow | null)?.role ?? null) === "owner";

  if (!isSystemAdmin && !isCreator && !isOwner) {
    throw new HttpError("Only journey owners or admins can refresh recommendations.", 403);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ journeyId: string }> },
) {
  try {
    const { journeyId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as RefreshRequest;
    if (body.mode && body.mode !== "manual") {
      return jsonError("Only manual refresh is supported.", 400);
    }

    const supabase = getRequestSupabase(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    await assertCanRefresh({
      supabase,
      journeyId,
      userId: userData.user.id,
    });

    const serviceSupabase = getServiceSupabase();
    if (!serviceSupabase) {
      return jsonError("SUPABASE_SERVICE_ROLE_KEY is required.", 500);
    }

    const result = await refreshStoryRecommendations({
      journeyId,
      language: body.language || "zh-CN",
      limit: normalizeLimit(body.limit),
      options: { supabase: serviceSupabase },
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(
      errorMessage(error, "Could not refresh story recommendations."),
      error instanceof HttpError ? error.status : 500,
    );
  }
}
