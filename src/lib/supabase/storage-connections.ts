import type {
  JourneyStorageConnection,
  PhotoStorageProvider,
  Trip,
} from "@/types";
import { supabase } from "./client";

type JourneyStorageConnectionRow = {
  id: string;
  trip_id: string;
  provider: Exclude<PhotoStorageProvider, "supabase_legacy">;
  account_label: string | null;
  provider_account_id: string | null;
  provider_root_folder_id: string | null;
  journey_folder_id: string | null;
  status: JourneyStorageConnection["status"];
  metadata: Record<string, unknown>;
  connected_by: string | null;
  connected_at: string;
  created_at: string;
  updated_at: string;
};

type ConnectJourneyStorageInput = {
  trip: Trip;
  provider: Exclude<PhotoStorageProvider, "supabase_legacy">;
  accountLabel?: string | null;
  providerAccountId?: string | null;
  providerRootFolderId: string;
  journeyFolderId: string;
  metadata?: Record<string, unknown>;
};

function mapConnection(
  row: JourneyStorageConnectionRow,
): JourneyStorageConnection {
  return {
    id: row.id,
    tripId: row.trip_id,
    provider: row.provider,
    accountLabel: row.account_label,
    providerAccountId: row.provider_account_id,
    providerRootFolderId: row.provider_root_folder_id,
    journeyFolderId: row.journey_folder_id,
    status: row.status,
    metadata: row.metadata ?? {},
    connectedBy: row.connected_by,
    connectedAt: row.connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getJourneyStorageConnection(
  tripId: string,
  provider: Exclude<PhotoStorageProvider, "supabase_legacy">,
) {
  const { data, error } = await supabase
    .from("journey_storage_connections")
    .select("*")
    .eq("trip_id", tripId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapConnection(data as JourneyStorageConnectionRow) : null;
}

export async function connectJourneyStorage(input: ConnectJourneyStorageInput) {
  const { error: connectionError } = await supabase
    .from("journey_storage_connections")
    .upsert(
      {
        trip_id: input.trip.id,
        provider: input.provider,
        account_label: input.accountLabel ?? null,
        provider_account_id: input.providerAccountId ?? null,
        provider_root_folder_id: input.providerRootFolderId,
        journey_folder_id: input.journeyFolderId,
        status: "connected",
        metadata: input.metadata ?? {},
      },
      { onConflict: "trip_id,provider" },
    );

  if (connectionError) {
    throw connectionError;
  }

  const { data, error: tripError } = await supabase
    .from("trips")
    .update({
      photo_storage_provider: input.provider,
      photo_storage_status: "connected",
      photo_storage_root_folder_id: input.journeyFolderId,
    })
    .eq("id", input.trip.id)
    .select("*")
    .single();

  if (tripError) {
    throw tripError;
  }

  return data;
}

export async function disconnectJourneyStorage(
  tripId: string,
  provider: Exclude<PhotoStorageProvider, "supabase_legacy">,
) {
  const { error: connectionError } = await supabase
    .from("journey_storage_connections")
    .update({ status: "disconnected" })
    .eq("trip_id", tripId)
    .eq("provider", provider);

  if (connectionError) {
    throw connectionError;
  }

  const { data, error: tripError } = await supabase
    .from("trips")
    .update({
      photo_storage_provider: provider,
      photo_storage_status: "disconnected",
    })
    .eq("id", tripId)
    .select("*")
    .single();

  if (tripError) {
    throw tripError;
  }

  return data;
}
