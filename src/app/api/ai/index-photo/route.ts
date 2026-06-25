import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { MediaAsset } from "@/types";

type IndexPhotoRequest = {
  assetId?: string;
  tripId?: string;
};

type MediaAssetRow = {
  id: string;
  trip_id: string;
  user_id: string | null;
  memory_entry_id: string | null;
  asset_type: MediaAsset["assetType"];
  storage_provider?: MediaAsset["storageProvider"];
  storage_bucket: string;
  original_file_path: string | null;
  compressed_file_path: string | null;
  thumbnail_file_path: string | null;
  provider_file_id?: string | null;
  provider_drive_id?: string | null;
  provider_web_url?: string | null;
  provider_thumbnail_url?: string | null;
  provider_original_reference?: string | null;
  original_file_size: number | null;
  compressed_file_size: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  storage_tier: MediaAsset["storageTier"];
  is_original_preserved: boolean;
  retention_until: string | null;
  taken_at?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  camera_model?: string | null;
  orientation?: string | null;
  exif_json?: Record<string, unknown>;
  ai_status?: MediaAsset["aiStatus"];
  ai_metadata?: Record<string, unknown>;
  ocr_text?: string | null;
  duplicate_score?: number | null;
  blur_score?: number | null;
  scene_tags?: string[];
  indexed_at?: string | null;
  created_at: string;
};

type PhotoIndexResult = {
  summary: string;
  sceneTags: string[];
  ocrText: string | null;
  locationHints: string[];
  peopleDescription: string | null;
  objects: string[];
  travelMomentType: string | null;
  qualityNotes: string[];
};

const photoIndexSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    sceneTags: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    ocrText: { type: ["string", "null"] },
    locationHints: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    peopleDescription: { type: ["string", "null"] },
    objects: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
    travelMomentType: {
      type: ["string", "null"],
      enum: [
        "arrival",
        "meal",
        "shopping",
        "hotel",
        "flight",
        "drive",
        "sightseeing",
        "hike",
        "group_moment",
        "document",
        "other",
        null,
      ],
    },
    qualityNotes: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
  },
  required: [
    "summary",
    "sceneTags",
    "ocrText",
    "locationHints",
    "peopleDescription",
    "objects",
    "travelMomentType",
    "qualityNotes",
  ],
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

function openAiEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/chat/completions`
    : normalizedBaseUrl.includes("api.openai.com")
      ? `${normalizedBaseUrl}/v1/chat/completions`
      : `${normalizedBaseUrl}/chat/completions`;
}

function mapMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id ?? "",
    memoryEntryId: row.memory_entry_id ?? "",
    assetType: row.asset_type,
    storageProvider: row.storage_provider ?? "supabase_legacy",
    storageBucket: row.storage_bucket,
    originalFilePath: row.original_file_path,
    compressedFilePath: row.compressed_file_path,
    thumbnailFilePath: row.thumbnail_file_path,
    providerFileId: row.provider_file_id ?? null,
    providerDriveId: row.provider_drive_id ?? null,
    providerWebUrl: row.provider_web_url ?? null,
    providerThumbnailUrl: row.provider_thumbnail_url ?? null,
    providerOriginalReference: row.provider_original_reference ?? null,
    originalFileSize: row.original_file_size,
    compressedFileSize: row.compressed_file_size,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    storageTier: row.storage_tier,
    isOriginalPreserved: row.is_original_preserved,
    retentionUntil: row.retention_until,
    takenAt: row.taken_at ?? null,
    gpsLatitude: row.gps_latitude ?? null,
    gpsLongitude: row.gps_longitude ?? null,
    cameraModel: row.camera_model ?? null,
    orientation: row.orientation ?? null,
    exifJson: row.exif_json ?? {},
    aiStatus: row.ai_status ?? "pending",
    aiMetadata: row.ai_metadata ?? {},
    ocrText: row.ocr_text ?? null,
    duplicateScore: row.duplicate_score ?? null,
    blurScore: row.blur_score ?? null,
    sceneTags: row.scene_tags ?? [],
    indexedAt: row.indexed_at ?? null,
    createdAt: row.created_at,
  };
}

async function analyzePhoto(imageUrl: string): Promise<PhotoIndexResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model =
    process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for photo indexing.");
  }

  const response = await fetch(
    openAiEndpoint(
      process.env.OPENAI_BASE_URL ||
        process.env.OPENAI_API_URL ||
        "https://api.openai.com/v1",
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You index travel photos for OTR. Extract searchable metadata only. Do not identify people by name. Return compact valid JSON.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Analyze this travel photo for search and memory organization. Capture visible text, scene tags, objects, location hints, and a short summary.",
              },
              {
                type: "image_url",
                image_url: { url: imageUrl, detail: "low" },
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "otr_photo_index",
            strict: true,
            schema: photoIndexSchema,
          },
        },
      }),
    },
  );
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || "OpenAI photo indexing failed.");
  }

  const payload = JSON.parse(text) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI returned an empty photo indexing response.");
  }

  return JSON.parse(content) as PhotoIndexResult;
}

export async function POST(request: Request) {
  let assetId: string | null = null;
  let tripId: string | null = null;

  try {
    const body = (await request.json()) as IndexPhotoRequest;
    assetId = body.assetId ?? null;
    tripId = body.tripId ?? null;

    if (!assetId || !tripId) {
      return jsonError("assetId and tripId are required.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data: assetRow, error: assetError } = await supabase
      .from("media_assets")
      .select("*")
      .eq("id", assetId)
      .eq("trip_id", tripId)
      .eq("asset_type", "image")
      .single();

    if (assetError || !assetRow) {
      return jsonError("Photo asset was not found.", 404);
    }

    const asset = assetRow as MediaAssetRow;
    if (!asset.compressed_file_path) {
      return jsonError("Photo does not have a compressed display file.", 409);
    }

    await supabase
      .from("media_assets")
      .update({ ai_status: "processing" })
      .eq("id", assetId)
      .eq("trip_id", tripId);

    const { data: signedData, error: signedError } = await supabase.storage
      .from("trip-media")
      .createSignedUrl(asset.compressed_file_path, 10 * 60);

    if (signedError || !signedData?.signedUrl) {
      throw signedError || new Error("Could not create image URL.");
    }

    const result = await analyzePhoto(signedData.signedUrl);
    const { data: updatedRow, error: updateError } = await supabase
      .from("media_assets")
      .update({
        ai_status: "indexed",
        ai_metadata: {
          summary: result.summary,
          locationHints: result.locationHints,
          peopleDescription: result.peopleDescription,
          objects: result.objects,
          travelMomentType: result.travelMomentType,
          qualityNotes: result.qualityNotes,
          provider: "openai",
          model:
            process.env.OPENAI_VISION_MODEL ||
            process.env.OPENAI_MODEL ||
            "gpt-4.1-mini",
        },
        ocr_text: result.ocrText,
        scene_tags: result.sceneTags,
        indexed_at: new Date().toISOString(),
      })
      .eq("id", assetId)
      .eq("trip_id", tripId)
      .select("*")
      .single();

    if (updateError || !updatedRow) {
      throw updateError || new Error("Could not save photo index.");
    }

    return NextResponse.json({ asset: mapMediaAsset(updatedRow as MediaAssetRow) });
  } catch (error) {
    if (assetId && tripId) {
      try {
        const supabase = getSupabaseForRequest(request);
        await supabase
          .from("media_assets")
          .update({
            ai_status: "failed",
            ai_metadata: {
              error:
                error instanceof Error
                  ? error.message
                  : "Photo indexing failed.",
            },
          })
          .eq("id", assetId)
          .eq("trip_id", tripId);
      } catch {
        // Best effort: the client still receives the real failure below.
      }
    }

    const message =
      error instanceof Error ? error.message : "Could not index this photo.";
    return jsonError(message, 500);
  }
}
