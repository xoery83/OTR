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

function parseModelJson(content: string): AiItineraryResponse {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fencedMatch ? fencedMatch[1] : trimmed) as AiItineraryResponse;
}

function getTripYear(trip: TripRow) {
  const sourceDate = trip.start_date || trip.end_date;
  if (!sourceDate) return new Date().getFullYear();

  const year = Number(sourceDate.slice(0, 4));
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

function toDateValue(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseChineseDateRange(text: string, trip: TripRow) {
  const rangeMatch = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:到|至|~|-|–|—)\s*(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日?/,
  );
  if (!rangeMatch) return null;

  const startMonth = Number(rangeMatch[1]);
  const startDay = Number(rangeMatch[2]);
  const endMonth = Number(rangeMatch[3] ?? rangeMatch[1]);
  const endDay = Number(rangeMatch[4]);
  const tripYear = getTripYear(trip);
  const startDate = toDateValue(tripYear, startMonth, startDay);
  let endDate = toDateValue(tripYear, endMonth, endDay);

  if (!startDate || !endDate) return null;
  if (endDate < startDate) {
    endDate = toDateValue(tripYear + 1, endMonth, endDay);
  }
  if (!endDate) return null;

  return { startDate, endDate };
}

function parseNights(text: string) {
  const match = text.match(/(\d+)\s*(?:晚|nights?)/i);
  return match ? Number(match[1]) : null;
}

function compactWhitespace(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim();
}

function parseChineseHotelStay(text: string, trip: TripRow) {
  if (!/(酒店|住宿|hotel|accommodation)/i.test(text)) return null;

  const tripYear = getTripYear(trip);
  const dayListMatch = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:和|与|及|,|，|、)\s*(\d{1,2})\s*日?\s*(?:两天|2\s*天)?/,
  );
  const range = parseChineseDateRange(text, trip);
  let startDate: string | null = null;
  let endDate: string | null = null;

  if (dayListMatch) {
    const month = Number(dayListMatch[1]);
    const startDay = Number(dayListMatch[2]);
    const endDay = Number(dayListMatch[3]);
    startDate = toDateValue(tripYear, month, startDay);
    const lastNightDate = toDateValue(tripYear, month, endDay);
    endDate = lastNightDate ? addDays(lastNightDate, 1) : null;
  } else if (range) {
    startDate = range.startDate;
    const nights = parseNights(text);
    endDate = nights && nights > 0 ? addDays(range.startDate, nights) : range.endDate;
  }

  const titleMatch = text.match(
    /(?:酒店|住宿|hotel|accommodation)\s*[:：]\s*([^\n,，]+(?:\s+[^\n,，地址]+)*)/i,
  );
  const addressMatch = text.match(/(?:地址|address)\s*[:：]\s*([\s\S]+)$/i);
  const title = compactWhitespace(
    titleMatch?.[1]?.replace(/\s*(?:地址|address)\s*[:：][\s\S]*$/i, ""),
  );
  const locationName = compactWhitespace(addressMatch?.[1]);

  if (!startDate && !title && !locationName) return null;

  return {
    reservation_type: "hotel",
    title: title || "Hotel reservation",
    day_date: startDate,
    location_name: locationName || null,
    starts_at: startDate ? `${startDate}T15:00:00` : null,
    ends_at: endDate ? `${endDate}T11:00:00` : null,
    source_excerpt: text,
    confidence: 0.9,
    needs_review: false,
  } satisfies NonNullable<AiItineraryResponse["reservations"]>[number];
}

function completeReservationDateRanges(
  parsed: AiItineraryResponse,
  rawText: string,
  trip: TripRow,
) {
  const fallbackHotelStay = parseChineseHotelStay(rawText, trip);
  const aiReservations = parsed.reservations ?? [];
  const reservations =
    aiReservations.length > 0 ? aiReservations : fallbackHotelStay ? [fallbackHotelStay] : [];

  return {
    ...parsed,
    reservations: reservations.map((reservation) => {
      const sourceText = [
        reservation.source_excerpt,
        reservation.title,
        reservation.location_name,
        reservations.length === 1 ? rawText : null,
      ]
        .filter(Boolean)
        .join("\n");
      const range = parseChineseDateRange(sourceText, trip);
      if (!range) return reservation;

      const nights = parseNights(sourceText);
      const endDate =
        nights && nights > 0 ? addDays(range.startDate, nights) : range.endDate;
      const isAccommodation =
        reservation.reservation_type === "hotel" ||
        /住宿|酒店|hotel|accommodation/i.test(sourceText);

      return {
        ...reservation,
        reservation_type:
          reservation.reservation_type === "other" && isAccommodation
            ? "hotel"
            : reservation.reservation_type,
        title:
          !reservation.title || /^Imported reservation \d+$/i.test(reservation.title)
            ? fallbackHotelStay?.title || reservation.title
            : reservation.title,
        location_name: reservation.location_name || fallbackHotelStay?.location_name || null,
        day_date: reservation.day_date || fallbackHotelStay?.day_date || range.startDate,
        starts_at:
          reservation.starts_at ||
          fallbackHotelStay?.starts_at ||
          `${range.startDate}T${isAccommodation ? "15:00" : "09:00"}:00`,
        ends_at:
          reservation.ends_at ||
          fallbackHotelStay?.ends_at ||
          `${endDate}T${isAccommodation ? "11:00" : "17:00"}:00`,
        source_excerpt: reservation.source_excerpt || fallbackHotelStay?.source_excerpt || null,
        needs_review: reservation.needs_review ?? true,
      };
    }),
  } satisfies AiItineraryResponse;
}

async function callOpenAI(prompt: string) {
  const configs = getProviderConfigs();
  if (configs.length === 0) {
    throw new Error("Missing OPENAI_API_KEY or DEEPSEEK_API_KEY.");
  }

  const errors: string[] = [];

  for (const config of configs) {
    try {
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

      return parseModelJson(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`${config.name}: ${message}`);
      continue;
    }
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

    const parsed = completeReservationDateRanges(
      await callOpenAI(prompt),
      rawText,
      tripContext,
    );
    return NextResponse.json({ parsed, members });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not parse itinerary.";
    return jsonError(message, 500);
  }
}
