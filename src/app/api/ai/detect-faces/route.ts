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
  asset_type: "image" | "video";
  compressed_file_path: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  thumbnail_drive_web_url?: string | null;
  provider_thumbnail_url?: string | null;
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
  trip_id?: string | null;
  journey_member_id: string;
  embedding: number[] | null;
  quality_score: number | null;
  model_name?: string | null;
  embedding_version?: string | null;
  journey_members?: {
    display_name?: string | null;
    user_id?: string | null;
    invite_email?: string | null;
    role?: string | null;
    status?: string | null;
  } | null;
};

type FaceMatch = {
  journeyMemberId: string;
  recognizedName: string;
  similarity: number;
};

type CurrentJourneyMemberIdentity = {
  journeyMemberId: string;
  displayName: string;
  identityKeys: Set<string>;
};

const FACE_MATCH_THRESHOLD = 0.42;
const GLOBAL_FACE_MATCH_THRESHOLD = 0.5;

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || null;
}

function publicImageUrlForAi(asset: MediaAssetRow, requestUrl: string) {
  if (asset.asset_type === "video") {
    return (
      asset.thumbnail_url ??
      asset.provider_thumbnail_url ??
      asset.thumbnail_drive_web_url ??
      new URL(`/api/media/assets/${asset.id}/thumbnail`, requestUrl).toString()
    );
  }

  return (
    asset.preview_url ??
    asset.thumbnail_url ??
    asset.provider_thumbnail_url ??
    asset.thumbnail_drive_web_url ??
    new URL(`/api/media/assets/${asset.id}/preview`, requestUrl).toString()
  );
}

function memberIdentityKeys(member: {
  user_id?: string | null;
  invite_email?: string | null;
}) {
  const keys = new Set<string>();
  if (member.user_id) keys.add(`user:${member.user_id}`);

  const email = normalizeEmail(member.invite_email);
  if (email) keys.add(`email:${email}`);

  return keys;
}

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
  threshold = FACE_MATCH_THRESHOLD,
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

  return best && best.similarity >= threshold ? best : null;
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

async function getCurrentJourneyMemberIdentities(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  tripId: string,
) {
  const { data, error } = await supabase
    .from("journey_members")
    .select("id, display_name, user_id, invite_email, role, status")
    .eq("trip_id", tripId)
    .neq("role", "guest");

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((member) => ({
      journeyMemberId: member.id as string,
      displayName: String(member.display_name ?? "").trim(),
      identityKeys: memberIdentityKeys({
        user_id: member.user_id as string | null,
        invite_email: member.invite_email as string | null,
      }),
    }))
    .filter((member) => member.displayName && member.identityKeys.size > 0);
}

async function getGlobalSameIdentityFaceSamples(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  tripId: string,
) {
  let currentMembers: CurrentJourneyMemberIdentity[] = [];

  try {
    currentMembers = await getCurrentJourneyMemberIdentities(supabase, tripId);
  } catch (error) {
    console.warn("Global face matching skipped: current members unavailable.", error);
    return [];
  }

  if (currentMembers.length === 0) return [];

  const currentMemberByIdentity = new Map<string, CurrentJourneyMemberIdentity>();
  for (const member of currentMembers) {
    for (const key of member.identityKeys) {
      currentMemberByIdentity.set(key, member);
    }
  }

  const { data, error } = await supabase.from("journey_member_face_embeddings")
    .select(
      "trip_id, journey_member_id, embedding, quality_score, model_name, embedding_version, journey_members(display_name, user_id, invite_email, role, status)",
    );

  if (error) {
    console.warn("Global face matching skipped: historical samples unavailable.", error);
    return [];
  }

  const samples: FaceEmbeddingRow[] = [];

  for (const sample of (data ?? []) as FaceEmbeddingRow[]) {
    if (sample.trip_id === tripId) continue;
    if (!sample.embedding) continue;
    if (sample.journey_members?.role === "guest") continue;

    const keys = memberIdentityKeys({
      user_id: sample.journey_members?.user_id ?? null,
      invite_email: sample.journey_members?.invite_email ?? null,
    });
    const matchedCurrentMember = [...keys]
      .map((key) => currentMemberByIdentity.get(key))
      .find(Boolean);

    if (!matchedCurrentMember) continue;

    samples.push({
      ...sample,
      journey_member_id: matchedCurrentMember.journeyMemberId,
      journey_members: {
        ...sample.journey_members,
        display_name: matchedCurrentMember.displayName,
      },
    });
  }

  return samples;
}

function findBestFaceMatchWithGlobalFallback(
  embedding: number[],
  localSamples: FaceEmbeddingRow[],
  globalSamples: FaceEmbeddingRow[],
) {
  return (
    findBestFaceMatch(embedding, localSamples) ??
    findBestFaceMatch(embedding, globalSamples, GLOBAL_FACE_MATCH_THRESHOLD)
  );
}

async function recognizeExistingFaces(input: {
  supabase: ReturnType<typeof getSupabaseForRequest>;
  tripId: string;
  faces: PhotoFaceRow[];
}) {
  const [samples, globalSamples] = await Promise.all([
    getFaceSamples(input.supabase, input.tripId),
    getGlobalSameIdentityFaceSamples(input.supabase, input.tripId),
  ]);
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

    const match = findBestFaceMatchWithGlobalFallback(
      face.embedding,
      samples,
      globalSamples,
    );

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
      .select(
        "id, trip_id, asset_type, compressed_file_path, thumbnail_url, preview_url, thumbnail_drive_web_url, provider_thumbnail_url",
      )
      .eq("id", assetId)
      .eq("trip_id", tripId)
      .in("asset_type", ["image", "video"])
      .single();

    if (assetError || !asset) {
      return jsonError("Media asset was not found.", 404);
    }

    const assetRow = asset as MediaAssetRow;
    const imageUrl = publicImageUrlForAi(assetRow, request.url);

    const detected = await callFaceService(imageUrl);

    if (detected.faces.length === 0) {
      return NextResponse.json({ faces: [], reused: false });
    }

    const [samples, globalSamples] = await Promise.all([
      getFaceSamples(supabase, tripId),
      getGlobalSameIdentityFaceSamples(supabase, tripId),
    ]);

    const { data: insertedFaces, error: insertError } = await supabase
      .from("photo_faces")
      .insert(
        detected.faces.map((face) => {
          const match = findBestFaceMatchWithGlobalFallback(
            face.embedding,
            samples,
            globalSamples,
          );

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
