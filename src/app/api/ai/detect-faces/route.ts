import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { PhotoFace } from "@/types";

type DetectFacesRequest = {
  assetId?: string;
  tripId?: string;
};

type MediaAssetRow = {
  id: string;
  trip_id: string;
  compressed_file_path: string | null;
};

type FaceServiceResponse = {
  model_name: string;
  embedding_version: string;
  faces: {
    bounding_box: Record<string, unknown>;
    embedding: number[];
    confidence: number | null;
    quality_score: number | null;
  }[];
};

type PhotoFaceRow = {
  id: string;
  media_asset_id: string;
  trip_id: string;
  journey_member_id: string | null;
  bounding_box: Record<string, unknown>;
  embedding: number[] | null;
  confidence: number | null;
  quality_score: number | null;
  recognition_status: PhotoFace["recognitionStatus"];
  recognized_name: string | null;
  model_name?: string | null;
  embedding_version?: string | null;
  created_at: string;
  updated_at: string;
};

type FaceEmbeddingRow = {
  journey_member_id: string;
  embedding: number[] | null;
  quality_score: number | null;
  model_name?: string | null;
  embedding_version?: string | null;
  journey_members?: {
    display_name?: string | null;
  } | null;
};

type FaceMatch = {
  journeyMemberId: string;
  recognizedName: string;
  similarity: number;
};

const FACE_MATCH_THRESHOLD = 0.42;

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

function mapFace(row: PhotoFaceRow): PhotoFace {
  return {
    id: row.id,
    mediaAssetId: row.media_asset_id,
    tripId: row.trip_id,
    journeyMemberId: row.journey_member_id,
    boundingBox: row.bounding_box,
    embedding: row.embedding,
    confidence: row.confidence,
    qualityScore: row.quality_score,
    recognitionStatus: row.recognition_status,
    recognizedName: row.recognized_name,
    modelName: row.model_name ?? null,
    embeddingVersion: row.embedding_version ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function findBestFaceMatch(
  embedding: number[],
  samples: FaceEmbeddingRow[],
): FaceMatch | null {
  const bestByMember = new Map<string, FaceMatch>();

  for (const sample of samples) {
    if (!sample.embedding || sample.embedding.length !== embedding.length) {
      continue;
    }

    const displayName = sample.journey_members?.display_name?.trim();
    if (!displayName) continue;

    const similarity = cosineSimilarity(embedding, sample.embedding);
    const existing = bestByMember.get(sample.journey_member_id);

    if (!existing || similarity > existing.similarity) {
      bestByMember.set(sample.journey_member_id, {
        journeyMemberId: sample.journey_member_id,
        recognizedName: displayName,
        similarity,
      });
    }
  }

  const best = [...bestByMember.values()].sort(
    (a, b) => b.similarity - a.similarity,
  )[0];

  return best && best.similarity >= FACE_MATCH_THRESHOLD ? best : null;
}

async function getFaceSamples(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  tripId: string,
) {
  const { data, error } = await supabase
    .from("journey_member_face_embeddings")
    .select(
      "journey_member_id, embedding, quality_score, model_name, embedding_version, journey_members(display_name)",
    )
    .eq("trip_id", tripId);

  if (error) {
    throw error;
  }

  return (data ?? []) as FaceEmbeddingRow[];
}

async function recognizeExistingFaces(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  faces: PhotoFaceRow[];
}) {
  const samples = await getFaceSamples(input.supabase, input.tripId);
  const recognizedRows: PhotoFaceRow[] = [];

  for (const face of input.faces) {
    if (
      face.recognition_status === "confirmed" ||
      !face.embedding ||
      face.embedding.length === 0
    ) {
      recognizedRows.push(face);
      continue;
    }

    const match = findBestFaceMatch(face.embedding, samples);

    if (!match) {
      recognizedRows.push(face);
      continue;
    }

    const { data: updatedFace, error } = await input.supabase
      .from("photo_faces")
      .update({
        journey_member_id: match.journeyMemberId,
        recognition_status: "recognized",
        recognized_name: match.recognizedName,
      })
      .eq("id", face.id)
      .eq("trip_id", input.tripId)
      .select("*")
      .single();

    if (error || !updatedFace) {
      throw error || new Error("Could not recognize existing face.");
    }

    recognizedRows.push(updatedFace as PhotoFaceRow);
  }

  return recognizedRows;
}

async function callFaceService(imageUrl: string) {
  const faceServiceUrl = process.env.FACE_SERVICE_URL?.replace(/\/$/, "");
  const faceServiceSecret = process.env.FACE_SERVICE_SECRET;

  if (!faceServiceUrl) {
    throw new Error("Missing FACE_SERVICE_URL.");
  }

  const response = await fetch(`${faceServiceUrl}/detect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(faceServiceSecret
        ? { "x-face-service-secret": faceServiceSecret }
        : {}),
    },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  const payload = (await response.json()) as FaceServiceResponse & {
    detail?: string;
  };

  if (!response.ok) {
    throw new Error(payload.detail || "Face service request failed.");
  }

  return payload;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DetectFacesRequest;
    const assetId = body.assetId;
    const tripId = body.tripId;

    if (!assetId || !tripId) {
      return jsonError("assetId and tripId are required.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data: existingFaces, error: existingError } = await supabase
      .from("photo_faces")
      .select("*")
      .eq("media_asset_id", assetId)
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true });

    if (existingError) {
      throw existingError;
    }

    if (existingFaces && existingFaces.length > 0) {
      const recognizedFaces = await recognizeExistingFaces({
        supabase,
        tripId,
        faces: existingFaces as PhotoFaceRow[],
      });

      return NextResponse.json({
        faces: recognizedFaces.map(mapFace),
        reused: true,
      });
    }

    const { data: asset, error: assetError } = await supabase
      .from("media_assets")
      .select("id, trip_id, compressed_file_path")
      .eq("id", assetId)
      .eq("trip_id", tripId)
      .eq("asset_type", "image")
      .single();

    if (assetError || !asset) {
      return jsonError("Photo asset was not found.", 404);
    }

    const assetRow = asset as MediaAssetRow;
    if (!assetRow.compressed_file_path) {
      return jsonError("Photo does not have a compressed display file.", 409);
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from("trip-media")
      .createSignedUrl(assetRow.compressed_file_path, 10 * 60);

    if (signedError || !signedData?.signedUrl) {
      throw signedError || new Error("Could not create image URL.");
    }

    const detected = await callFaceService(signedData.signedUrl);

    if (detected.faces.length === 0) {
      return NextResponse.json({ faces: [], reused: false });
    }

    const samples = await getFaceSamples(supabase, tripId);

    const { data: insertedFaces, error: insertError } = await supabase
      .from("photo_faces")
      .insert(
        detected.faces.map((face) => {
          const match = findBestFaceMatch(face.embedding, samples);

          return {
            media_asset_id: assetId,
            trip_id: tripId,
            journey_member_id: match?.journeyMemberId ?? null,
            bounding_box: face.bounding_box,
            embedding: face.embedding,
            confidence: face.confidence,
            quality_score: face.quality_score,
            recognition_status: match ? "recognized" : "unknown",
            recognized_name: match ? match.recognizedName : null,
            model_name: detected.model_name,
            embedding_version: detected.embedding_version,
          };
        }),
      )
      .select("*");

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      faces: ((insertedFaces ?? []) as PhotoFaceRow[]).map(mapFace),
      reused: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not detect faces.";
    return jsonError(message, 500);
  }
}
