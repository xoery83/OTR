import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { PhotoFace } from "@/types";

type ConfirmFaceRequest = {
  faceId?: string;
  tripId?: string;
  journeyMemberId?: string;
  recognizedName?: string;
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

type JourneyMemberRow = {
  id: string;
  trip_id: string;
  display_name: string;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConfirmFaceRequest;
    const faceId = body.faceId;
    const tripId = body.tripId;
    const journeyMemberId = body.journeyMemberId;
    const recognizedName = body.recognizedName?.trim();

    if (!faceId || !tripId || (!journeyMemberId && !recognizedName)) {
      return jsonError(
        "faceId, tripId, and either journeyMemberId or recognizedName are required.",
        400,
      );
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { data: face, error: faceError } = await supabase
      .from("photo_faces")
      .select("*")
      .eq("id", faceId)
      .eq("trip_id", tripId)
      .single();

    if (faceError || !face) {
      return jsonError("Face was not found.", 404);
    }

    const faceRow = face as PhotoFaceRow;

    if (!journeyMemberId) {
      const { data: updatedFace, error: updateFaceError } = await supabase
        .from("photo_faces")
        .update({
          journey_member_id: null,
          recognition_status: "confirmed",
          recognized_name: recognizedName,
        })
        .eq("id", faceId)
        .eq("trip_id", tripId)
        .select("*")
        .single();

      if (updateFaceError || !updatedFace) {
        throw updateFaceError || new Error("Could not confirm face.");
      }

      const { error: deleteEmbeddingError } = await supabase
        .from("journey_member_face_embeddings")
        .delete()
        .eq("face_id", faceId)
        .eq("trip_id", tripId);

      if (deleteEmbeddingError) {
        throw deleteEmbeddingError;
      }

      return NextResponse.json({
        face: mapFace(updatedFace as PhotoFaceRow),
      });
    }

    const { data: member, error: memberError } = await supabase
      .from("journey_members")
      .select("id, trip_id, display_name")
      .eq("id", journeyMemberId)
      .eq("trip_id", tripId)
      .single();

    if (memberError || !member) {
      return jsonError("Journey member was not found.", 404);
    }

    const memberRow = member as JourneyMemberRow;

    if (!faceRow.embedding || faceRow.embedding.length === 0) {
      return jsonError("Face does not have an embedding.", 409);
    }

    const { data: updatedFace, error: updateFaceError } = await supabase
      .from("photo_faces")
      .update({
        journey_member_id: journeyMemberId,
        recognition_status: "confirmed",
        recognized_name: memberRow.display_name,
      })
      .eq("id", faceId)
      .eq("trip_id", tripId)
      .select("*")
      .single();

    if (updateFaceError || !updatedFace) {
      throw updateFaceError || new Error("Could not confirm face.");
    }

    const { data: existingEmbedding } = await supabase
      .from("journey_member_face_embeddings")
      .select("id")
      .eq("face_id", faceId)
      .maybeSingle();

    if (existingEmbedding?.id) {
      const { error: updateEmbeddingError } = await supabase
        .from("journey_member_face_embeddings")
        .update({
          journey_member_id: journeyMemberId,
          embedding: faceRow.embedding,
          quality_score: faceRow.quality_score,
          source: "confirmed_match",
          created_by: userData.user.id,
          model_name: faceRow.model_name ?? null,
          embedding_version: faceRow.embedding_version ?? null,
        })
        .eq("id", existingEmbedding.id);

      if (updateEmbeddingError) {
        throw updateEmbeddingError;
      }
    } else {
      const { error: insertEmbeddingError } = await supabase
        .from("journey_member_face_embeddings")
        .insert({
          trip_id: tripId,
          journey_member_id: journeyMemberId,
          media_asset_id: faceRow.media_asset_id,
          face_id: faceId,
          embedding: faceRow.embedding,
          quality_score: faceRow.quality_score,
          source: "confirmed_match",
          created_by: userData.user.id,
          model_name: faceRow.model_name ?? null,
          embedding_version: faceRow.embedding_version ?? null,
        });

      if (insertEmbeddingError) {
        throw insertEmbeddingError;
      }
    }

    return NextResponse.json({
      face: mapFace(updatedFace as PhotoFaceRow),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not confirm this face.";
    return jsonError(message, 500);
  }
}
