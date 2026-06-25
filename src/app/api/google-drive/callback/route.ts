import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { encryptGoogleToken } from "@/lib/server/google-token";
import {
  createGoogleDriveDayFolders,
  createGoogleDriveJourneyFolders,
} from "@/lib/storage/google-drive";
import { getGoogleClientConfig, verifyGoogleDriveState } from "../oauth";

type GoogleTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type TripRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
};

type DayFolder = {
  date: string;
  folderId: string;
  name: string;
};

type StorageConnectionRow = {
  provider_root_folder_id: string | null;
  journey_folder_id: string | null;
  metadata: {
    rootFolderName?: string;
    journeyFolderName?: string;
    journeyFolderUrl?: string | null;
    dayFolders?: DayFolder[];
  } | null;
};

function redirectToSettings(origin: string, tripId: string, params: Record<string, string>) {
  const url = new URL(`/trips/${tripId}/settings`, origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

function getSupabaseForAccessToken(accessToken: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function exchangeGoogleCode(input: {
  origin: string;
  code: string;
}) {
  const { clientId, clientSecret, redirectUri } = getGoogleClientConfig(
    input.origin,
  );
  const body = new URLSearchParams({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "Could not exchange Google code.",
    );
  }

  return payload;
}

async function getOrCreateDriveFolders(input: {
  accessToken: string;
  supabase: ReturnType<typeof getSupabaseForAccessToken>;
  trip: TripRow;
}) {
  const { data: existingConnection } = await input.supabase
    .from("journey_storage_connections")
    .select("provider_root_folder_id, journey_folder_id, metadata")
    .eq("trip_id", input.trip.id)
    .eq("provider", "google_drive")
    .maybeSingle();

  const existing = existingConnection as StorageConnectionRow | null;
  const metadata = existing?.metadata ?? {};
  const existingDayFolders = Array.isArray(metadata.dayFolders)
    ? metadata.dayFolders
    : [];

  if (existing?.journey_folder_id) {
    const dayFolders =
      existingDayFolders.length > 0
        ? existingDayFolders
        : await createGoogleDriveDayFolders({
            accessToken: input.accessToken,
            journeyFolderId: existing.journey_folder_id,
            startDate: input.trip.start_date,
            endDate: input.trip.end_date,
          });

    return {
      rootFolderId: existing.provider_root_folder_id,
      rootFolderName: metadata.rootFolderName ?? "Journey",
      journeyFolderId: existing.journey_folder_id,
      journeyFolderName: metadata.journeyFolderName ?? input.trip.name,
      journeyFolderUrl: metadata.journeyFolderUrl ?? null,
      dayFolders,
    };
  }

  const folders = await createGoogleDriveJourneyFolders({
    accessToken: input.accessToken,
    tripName: input.trip.name,
    startDate: input.trip.start_date,
    endDate: input.trip.end_date,
  });

  return {
    rootFolderId: folders.rootFolder.id,
    rootFolderName: folders.rootFolder.name,
    journeyFolderId: folders.journeyFolder.id,
    journeyFolderName: folders.journeyFolder.name,
    journeyFolderUrl: folders.journeyFolder.webViewLink ?? null,
    dayFolders: folders.dayFolders,
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  let tripId: string | null = null;

  try {
    const error = requestUrl.searchParams.get("error_description") ??
      requestUrl.searchParams.get("error");

    if (error) {
      throw new Error(error);
    }

    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");

    if (!code || !state) {
      throw new Error("Missing Google callback code or state.");
    }

    const statePayload = verifyGoogleDriveState(state);
    tripId = statePayload.tripId;

    const cookieHeader = request.headers.get("cookie") ?? "";
    const supabaseAccessToken = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("journey_gdrive_access="))
      ?.split("=")[1];

    if (!supabaseAccessToken) {
      throw new Error("OTR login session was not found. Please try again.");
    }

    const supabase = getSupabaseForAccessToken(
      decodeURIComponent(supabaseAccessToken),
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user || userData.user.id !== statePayload.userId) {
      throw new Error("OTR login session did not match this Drive connection.");
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id, name, start_date, end_date, created_by")
      .eq("id", statePayload.tripId)
      .single();

    if (tripError || !trip) {
      throw new Error("Journey was not found.");
    }

    const token = await exchangeGoogleCode({ origin, code });
    if (!token.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Please reconnect Google Drive and approve access again.",
      );
    }
    const tripRow = trip as TripRow;
    const folders = await getOrCreateDriveFolders({
      accessToken: token.access_token!,
      supabase,
      trip: tripRow,
    });

    const { error: connectionError } = await supabase
      .from("journey_storage_connections")
      .upsert(
        {
          trip_id: tripRow.id,
          provider: "google_drive",
          account_label: userData.user.email ?? null,
          provider_account_id: userData.user.id,
          provider_root_folder_id: folders.rootFolderId,
          journey_folder_id: folders.journeyFolderId,
          status: "connected",
          token_reference: encryptGoogleToken(token.refresh_token),
          connected_by: userData.user.id,
          metadata: {
            rootFolderName: folders.rootFolderName,
            journeyFolderName: folders.journeyFolderName,
            journeyFolderUrl: folders.journeyFolderUrl,
            dayFolders: folders.dayFolders,
          },
        },
        { onConflict: "trip_id,provider" },
      );

    if (connectionError) {
      throw connectionError;
    }

    const { error: tripUpdateError } = await supabase
      .from("trips")
      .update({
        photo_storage_provider: "google_drive",
        photo_storage_status: "connected",
        photo_storage_root_folder_id: folders.journeyFolderId,
      })
      .eq("id", tripRow.id);

    if (tripUpdateError) {
      throw tripUpdateError;
    }

    const response = redirectToSettings(origin, tripRow.id, {
      drive: "connected",
    });
    response.cookies.delete("journey_gdrive_access");
    return response;
  } catch (callbackError) {
    const message =
      callbackError instanceof Error
        ? callbackError.message
        : "Could not connect Google Drive.";
    const response = tripId
      ? redirectToSettings(origin, tripId, { drive_error: message })
      : NextResponse.redirect(
          new URL(`/trips?drive_error=${encodeURIComponent(message)}`, origin),
        );
    response.cookies.delete("journey_gdrive_access");
    return response;
  }
}
