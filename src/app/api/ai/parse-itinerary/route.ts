import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AiItineraryResponse } from "@/lib/planner-import";
import type { TripMember } from "@/types";

type ParseRequest = {
  tripId?: string;
  rawText?: string;
};

type TripRow = {
  id: string;
  name: string;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
};

type MemberRpcRow = {
  member_id: string;
  member_trip_id: string;
  member_user_id: string;
  member_role: string | null;
  member_created_at: string;
  display_name: string | null;
  avatar_url: string | null;
};

type AiProviderConfig = {
  name: "openai" | "deepseek";
  apiKey: string;
  endpoint: string;
  model: string;
  responseFormat:
    | { type: "json_object" }
    | {
        type: "json_schema";
        json_schema: {
          name: string;
          strict: boolean;
          schema: typeof eventSchema;
        };
      };
};

const eventSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
        required: ["date", "title", "notes"],
      },
    },
    reservations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          reservation_type: {
            type: "string",
            enum: ["flight", "hotel", "car", "ferry", "tour", "restaurant", "other"],
          },
          title: { type: "string" },
          day_date: { type: ["string", "null"] },
          location_name: { type: ["string", "null"] },
          starts_at: { type: ["string", "null"] },
          ends_at: { type: ["string", "null"] },
          source_excerpt: { type: ["string", "null"] },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          needs_review: { type: "boolean" },
        },
        required: [
          "reservation_type",
          "title",
          "day_date",
          "location_name",
          "starts_at",
          "ends_at",
          "source_excerpt",
          "confidence",
          "needs_review",
        ],
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day_date: { type: ["string", "null"] },
          day_title: { type: ["string", "null"] },
          day_notes: { type: ["string", "null"] },
          title: { type: "string" },
          description: { type: ["string", "null"] },
          event_type: {
            type: "string",
            enum: [
              "flight",
              "hotel",
              "car",
              "activity",
              "shopping",
              "meal",
              "transport",
              "note",
              "other",
            ],
          },
          location_name: { type: ["string", "null"] },
          planned_start: { type: ["string", "null"] },
          planned_end: { type: ["string", "null"] },
          participant_names: {
            type: "array",
            items: { type: "string" },
          },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          date_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          time_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          participants_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          location_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          is_estimated_time: { type: "boolean" },
          needs_review: { type: "boolean" },
          source_excerpt: { type: ["string", "null"] },
        },
        required: [
          "day_date",
          "day_title",
          "day_notes",
          "title",
          "description",
          "event_type",
          "location_name",
          "planned_start",
          "planned_end",
          "participant_names",
          "confidence",
          "date_confidence",
          "time_confidence",
          "participants_confidence",
          "location_confidence",
          "is_estimated_time",
          "needs_review",
          "source_excerpt",
        ],
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["days", "reservations", "events", "warnings"],
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

function mapMember(row: MemberRpcRow): TripMember {
  return {
    id: row.member_id,
    tripId: row.member_trip_id,
    userId: row.member_user_id,
    name: row.display_name || "Traveler",
    role: row.member_role ?? "member",
    avatarUrl: row.avatar_url,
    createdAt: row.member_created_at,
  };
}

function openAiEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/chat/completions`
    : normalizedBaseUrl.includes("api.openai.com")
      ? `${normalizedBaseUrl}/v1/chat/completions`
      : `${normalizedBaseUrl}/chat/completions`;
}

function getProviderConfigs() {
  const preferred = process.env.AI_PROVIDER?.toLowerCase();
  const configs: AiProviderConfig[] = [];

  if (process.env.OPENAI_API_KEY) {
    configs.push({
      name: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      endpoint: openAiEndpoint(
        process.env.OPENAI_BASE_URL ||
          process.env.OPENAI_API_URL ||
          "https://api.openai.com/v1",
      ),
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "otr_itinerary_parse",
          strict: true,
          schema: eventSchema,
        },
      },
    });
  }

  if (process.env.DEEPSEEK_API_KEY) {
    configs.push({
      name: "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY,
      endpoint: `${(
        process.env.DEEPSEEK_BASE_URL ||
        process.env.DEEPSEEK_API_URL ||
        "https://api.deepseek.com"
      ).replace(/\/$/, "")}/chat/completions`,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      responseFormat: { type: "json_object" },
    });
  }

  if (preferred === "deepseek") {
    return configs.sort((config) => (config.name === "deepseek" ? -1 : 1));
  }

  if (preferred === "openai") {
    return configs.sort((config) => (config.name === "openai" ? -1 : 1));
  }

  return configs;
}

async function callOpenAI(prompt: string) {
  const configs = getProviderConfigs();
  if (configs.length === 0) {
    throw new Error("Missing OPENAI_API_KEY or DEEPSEEK_API_KEY.");
  }

  const errors: string[] = [];

  for (const config of configs) {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          {
          role: "system",
          content:
              "You are a travel planning assistant, not a sentence splitter. Return only valid JSON matching the requested shape. First organize the trip by days, then create only high-value planner events under days. Do not create standalone events for minor logistical tasks such as buying SIM cards, grocery shopping, packing, organizing supplies, or ordinary meals; put these in day notes instead. Hotels, flights, car rentals, ferries, and important bookings belong in reservations, not activity events. Standalone events should be major sightseeing, tours, hikes, transfers, or meaningful scheduled activities. Participant detection must be constrained to the provided trip members only; never use emails, organizations, profile metadata, or unknown names as participants. Use ISO 8601 timestamps. If only morning/afternoon/evening is given, use morning 09:00-12:00, afternoon 13:00-17:00, evening 18:00-21:00, set is_estimated_time true, and lower time_confidence. Keep unknown values null and add warnings for uncertainty.",
          },
          { role: "user", content: prompt },
        ],
        response_format: config.responseFormat,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      errors.push(`${config.name}: ${text}`);
      continue;
    }

    const payload = JSON.parse(text) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      errors.push(`${config.name}: empty response`);
      continue;
    }

    return JSON.parse(content) as AiItineraryResponse;
  }

  throw new Error(`AI request failed. ${errors.join(" ")}`);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ParseRequest;
    const tripId = body.tripId;
    const rawText = body.rawText?.trim();

    if (!tripId || !rawText) {
      return jsonError("tripId and rawText are required.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const [{ data: trip, error: tripError }, { data: memberRows, error: memberError }] =
      await Promise.all([
        supabase.from("trips").select("*").eq("id", tripId).single(),
        supabase.rpc("get_trip_members_for_current_user", { target_trip_id: tripId }),
      ]);

    if (tripError || !trip) {
      return jsonError("Journey not found.", 404);
    }

    if (memberError) {
      throw memberError;
    }

    const members = ((memberRows ?? []) as MemberRpcRow[]).map(mapMember);
    const currentMember = members.find(
      (member) => member.userId === userData.user.id,
    );
    const canImport =
      currentMember?.role === "owner" ||
      currentMember?.role === "admin" ||
      (trip as TripRow).created_by === userData.user.id;

    if (!canImport) {
      return jsonError("Only journey owners and admins can import plans.", 403);
    }

    const tripContext = trip as TripRow;
    const prompt = [
      `Trip name: ${tripContext.name}`,
      `Destination: ${tripContext.destination ?? "unknown"}`,
      `Date range: ${tripContext.start_date ?? "unknown"} to ${tripContext.end_date ?? "unknown"}`,
      "Known trip members:",
      members.map((member) => `- ${member.name} (${member.userId})`).join("\n"),
      "",
      "Only these exact member display names may appear in participant_names. If the text mentions someone else, do not add them to participant_names; mention the uncertainty in warnings.",
      "",
      "Raw itinerary text:",
      rawText,
    ].join("\n");

    const parsed = await callOpenAI(prompt);
    return NextResponse.json({ parsed, members });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse itinerary.";
    return jsonError(message, 500);
  }
}
