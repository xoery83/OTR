import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { analyzeImageForDebug } from "@/lib/ai/vision/router";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { MediaAsset } from "@/types";

type IndexPhotoRequest = {
  assetId?: string;
  tripId?: string;
  locale?: string;
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
  media_asset_id: string;
  status: "indexed_local" | "indexed_llm" | "needs_llm" | "failed";
  caption: string;
  scene: string | null;
  objects: string[];
  ocr_text: string | null;
  people: Record<string, unknown>[];
  image_hash: string;
  duplicate_hash: string;
  blur_score: number;
  brightness_score: number;
  dominant_colors: string[];
  quality_score: number;
  needs_llm_review: boolean;
  llm_review_reason: string | null;
  model_used: string;
  model_version: string;
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

function getAiServerConfig() {
  const aiServerUrl = (
    process.env.IMAGE_INDEX_SERVICE_URL ||
    process.env.AI_SERVER_URL ||
    ""
  ).replace(/\/$/, "");
  const aiServerSecret = process.env.AI_SERVER_SECRET;

  if (!aiServerUrl) {
    throw new Error("Missing AI_SERVER_URL or IMAGE_INDEX_SERVICE_URL.");
  }

  if (!aiServerSecret) {
    throw new Error("Missing AI_SERVER_SECRET.");
  }

  return { aiServerUrl, aiServerSecret };
}

function normalizeIndexLanguage(locale: string | null | undefined): Locale {
  return locale === "zh-CN" ? "zh-CN" : "en";
}

function indexLanguageInstruction(locale: Locale) {
  return locale === "zh-CN"
    ? "Return Simplified Chinese captions, scenes, objects, and search tags. Keep OCR text in the original visible language."
    : "Return English captions, scenes, objects, and search tags. Keep OCR text in the original visible language.";
}

async function callImageIndexService(input: {
  asset: MediaAssetRow;
  imageUrl: string;
  authorization: string;
  locale: Locale;
}): Promise<PhotoIndexResult> {
  const { aiServerUrl, aiServerSecret } = getAiServerConfig();
  const response = await fetch(`${aiServerUrl}/image-index/index`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ai-server-secret": aiServerSecret,
      Authorization: input.authorization,
    },
    body: JSON.stringify({
      media_asset_id: input.asset.id,
      journey_id: input.asset.trip_id,
      image_url: input.imageUrl,
      language: input.locale,
      metadata: {
        file_id: input.asset.provider_file_id ?? input.asset.id,
        journey_id: input.asset.trip_id,
        uploader_id: input.asset.user_id,
        upload_time: input.asset.created_at,
        original_filename: input.asset.provider_original_reference,
        file_size:
          input.asset.compressed_file_size ?? input.asset.original_file_size,
        width: input.asset.width,
        height: input.asset.height,
        exif_time: input.asset.taken_at,
        gps_latitude: input.asset.gps_latitude,
        gps_longitude: input.asset.gps_longitude,
        camera_model: input.asset.camera_model,
        google_drive_file_id:
          input.asset.storage_provider === "google_drive"
            ? input.asset.provider_file_id
            : null,
        supabase_asset_id: input.asset.id,
        storage_provider: input.asset.storage_provider,
        provider_file_id: input.asset.provider_file_id,
        mime_type: input.asset.mime_type,
        exif_json: input.asset.exif_json ?? {},
      },
    }),
  });
  const payload = (await response.json()) as PhotoIndexResult & {
    detail?: string;
  };

  if (!response.ok) {
    throw new Error(payload.detail || "Image index service request failed.");
  }

  return payload;
}

async function indexWithVisionFallback(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  asset: MediaAssetRow;
  imageUrl: string;
  locale: Locale;
}) {
  const analysis = await analyzeImageForDebug({
    imageUrl: input.imageUrl,
    mode: "vision",
    prompt:
      `Analyze this travel photo for OTR image indexing. Prefer concrete visible details for search and album grouping. ${indexLanguageInstruction(input.locale)}`,
  });
  const sceneTags = [
    ...analysis.tags,
    ...analysis.activities,
    ...analysis.objects,
    ...analysis.food,
  ].filter(Boolean);
  const uniqueSceneTags = [...new Set(sceneTags)];

  const aiMetadata = {
    ...(input.asset.ai_metadata ?? {}),
    summary: analysis.summary,
    locationHints: analysis.locationHints,
    peopleDescription:
      analysis.people.length > 0 ? analysis.people.join(", ") : null,
    objects: analysis.objects,
    food: analysis.food,
    activities: analysis.activities,
    provider: analysis.provider,
    model: analysis.model,
    modelUsed: `${analysis.provider}_vision`,
    confidence: analysis.confidence,
    language: input.locale,
    rawModelResponse: analysis.rawResponse,
  };

  await input.supabase
    .from("media_assets")
    .update({
      ai_status: "indexed",
      ai_metadata: aiMetadata,
      ocr_text: analysis.ocrText || null,
      scene_tags: uniqueSceneTags,
      indexed_at: new Date().toISOString(),
    })
    .eq("id", input.asset.id)
    .eq("trip_id", input.asset.trip_id);

  return {
    media_asset_id: input.asset.id,
    status: "indexed_llm",
    caption: analysis.summary,
    scene: analysis.tags[0] ?? null,
    objects: uniqueSceneTags,
    ocr_text: analysis.ocrText || null,
    people: analysis.people.map((person) => ({ description: person })),
    image_hash: "",
    duplicate_hash: "",
    blur_score: 0,
    brightness_score: 0,
    dominant_colors: [],
    quality_score: analysis.confidence,
    needs_llm_review: analysis.confidence < 0.7,
    llm_review_reason:
      analysis.confidence < 0.7 ? "low_vision_confidence" : null,
    model_used: `${analysis.provider}_vision`,
    model_version: analysis.model,
  } satisfies PhotoIndexResult;
}

export async function POST(request: Request) {
  let assetId: string | null = null;
  let tripId: string | null = null;

  try {
    const body = (await request.json()) as IndexPhotoRequest;
    assetId = body.assetId ?? null;
    tripId = body.tripId ?? null;
    const locale = normalizeIndexLanguage(body.locale);

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

    let result: PhotoIndexResult;
    try {
      result = await callImageIndexService({
        asset,
        imageUrl: signedData.signedUrl,
        authorization: request.headers.get("authorization") ?? "",
        locale,
      });
      const { data: currentMetadataRow } = await supabase
        .from("media_assets")
        .select("ai_metadata")
        .eq("id", asset.id)
        .eq("trip_id", asset.trip_id)
        .single();
      const currentMetadata =
        (currentMetadataRow as { ai_metadata?: Record<string, unknown> } | null)
          ?.ai_metadata ?? {};
      await supabase
        .from("media_assets")
        .update({
          ai_metadata: {
            ...currentMetadata,
            provider: "otr-ai-server",
            modelUsed: result.model_used,
            model: result.model_version,
            summary: result.caption,
            objects: result.objects,
            needsLlmReview: result.needs_llm_review,
            llmReviewReason: result.llm_review_reason,
            language: locale,
          },
        })
        .eq("id", asset.id)
        .eq("trip_id", asset.trip_id);
    } catch {
      result = await indexWithVisionFallback({
        supabase,
        asset,
        imageUrl: signedData.signedUrl,
        locale,
      });
    }
    const { data: updatedRow, error: updateError } = await supabase
      .from("media_assets")
      .select("*")
      .eq("id", assetId)
      .eq("trip_id", tripId)
      .single();

    if (updateError || !updatedRow) {
      throw updateError || new Error("Could not load saved photo index.");
    }

    return NextResponse.json({
      asset: mapMediaAsset(updatedRow as MediaAssetRow),
      index: result,
    });
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
