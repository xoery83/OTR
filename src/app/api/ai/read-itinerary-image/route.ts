import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { analyzeImage } from "@/lib/ai/vision/router";

export const runtime = "nodejs";

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

function normalizeItineraryText(ocrText: string, summary: string) {
  const ocr = ocrText.trim();
  const summarized = summary.trim();

  if (ocr && summarized && !ocr.includes(summarized)) {
    return `${ocr}\n\n图片摘要：${summarized}`;
  }

  return ocr || summarized;
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseForRequest(request);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonError("Unauthorized.", 401);
    }

    const formData = await request.formData();
    const tripId = String(formData.get("tripId") ?? "");
    const file = formData.get("image");

    if (!tripId) {
      return jsonError("tripId is required.", 400);
    }

    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return jsonError("Please upload an image file.", 400);
    }

    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError) {
      return jsonError(tripError.message, 500);
    }

    if (!trip) {
      return jsonError("Trip not found.", 404);
    }

    const imageBuffer = Buffer.from(await file.arrayBuffer());
    const imageUrl = `data:${file.type};base64,${imageBuffer.toString("base64")}`;
    const analysis = await analyzeImage({
      imageUrl,
      mode: "vision",
      timeoutMs: 90_000,
      prompt:
        "Read this travel itinerary, booking, receipt, route note, or screenshot. Extract all visible itinerary text faithfully. Preserve dates, times, places, addresses, flight numbers, hotels, car rental details, amounts, currencies, people, and notes. Return OCR text and a concise itinerary summary useful for importing into a planner.",
    });
    const text = normalizeItineraryText(analysis.ocrText, analysis.summary);

    if (!text) {
      return jsonError("No readable itinerary text was found in this image.", 422);
    }

    return NextResponse.json({
      text,
      provider: analysis.provider,
      model: analysis.model,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not read itinerary image.",
      500,
    );
  }
}
