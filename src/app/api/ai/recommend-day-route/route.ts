import { NextResponse } from "next/server";

type RecommendRequest = {
  journeyName?: string;
  destination?: string;
  date?: string;
  startLocation?: string;
  startTime?: string;
  endLocation?: string;
  endTime?: string;
  driving?: boolean;
  tags?: string[];
  notes?: string;
};

type RouteSegment = {
  startTime: string;
  endTime: string;
  name: string;
  location: string;
  distanceKm: number | null;
  playMinutes: number;
  transport: string;
  estimatedCost: string;
  highlights: string[];
  description: string;
  photoUrl: string;
};

export type DayRouteRecommendation = {
  title: string;
  summary: string;
  heroImageUrl: string;
  segments: RouteSegment[];
};

type AiProviderConfig = {
  name: "openai" | "deepseek";
  apiKey: string;
  endpoint: string;
  model: string;
  responseFormat: { type: "json_object" };
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
      responseFormat: { type: "json_object" },
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

function stringValue(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback: number | null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function stringArrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item).trim())
      .filter(Boolean);
  }
  const text = stringValue(value).trim();
  if (!text) return [];
  return text
    .split(/[、,，/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRecommendation(value: unknown): DayRouteRecommendation {
  const recommendation =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const segments = Array.isArray(recommendation.segments)
    ? recommendation.segments
    : [];

  return {
    title: stringValue(recommendation.title, "最佳行程推荐"),
    summary: stringValue(recommendation.summary, ""),
    heroImageUrl: stringValue(recommendation.heroImageUrl, ""),
    segments: segments.map((rawSegment, index) => {
      const segment =
        rawSegment && typeof rawSegment === "object"
          ? (rawSegment as Record<string, unknown>)
          : {};

      return {
        startTime: stringValue(segment.startTime, index === 0 ? "09:00" : ""),
        endTime: stringValue(segment.endTime, ""),
        name: stringValue(segment.name, `推荐地点 ${index + 1}`),
        location: stringValue(segment.location, ""),
        distanceKm: numberValue(segment.distanceKm, null),
        playMinutes: numberValue(segment.playMinutes, 60) ?? 60,
        transport: stringValue(segment.transport, "待确认"),
        estimatedCost: stringValue(segment.estimatedCost, "待估"),
        highlights: stringArrayValue(segment.highlights),
        description: stringValue(segment.description, ""),
        photoUrl: stringValue(segment.photoUrl, ""),
      };
    }),
  };
}

function parseModelJson(content: string): DayRouteRecommendation {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return normalizeRecommendation(JSON.parse(fencedMatch ? fencedMatch[1] : trimmed));
}

function unsplash(location: string) {
  return `https://source.unsplash.com/900x600/?${encodeURIComponent(location || "travel scenic")}`;
}

function fallbackRecommendation(input: Required<RecommendRequest>): DayRouteRecommendation {
  const mode = input.driving ? "自驾" : "公共交通 / 步行";
  const tagText = input.tags.length > 0 ? input.tags.join("、") : "休闲";
  const area = input.endLocation || input.startLocation || input.destination;

  return {
    title: `${area} 单日最佳行程`,
    summary: `按 ${tagText} 风格安排，从 ${input.startLocation} 出发，${input.endTime} 前抵达 ${input.endLocation}。${
      input.notes ? `补充要求：${input.notes}` : ""
    }`,
    heroImageUrl: unsplash(area),
    segments: [
      {
        startTime: input.startTime,
        endTime: "10:30",
        name: `${area} 经典起点`,
        location: input.startLocation,
        distanceKm: 0,
        playMinutes: 75,
        transport: mode,
        estimatedCost: "按现场消费",
        highlights: ["热身", "拍照", "确认路线"],
        description: "从出发地附近开始，先安排一个低压力的经典点位，方便进入当天节奏。",
        photoUrl: unsplash(`${area} landmark`),
      },
      {
        startTime: "11:00",
        endTime: "13:00",
        name: `${area} 重点景点`,
        location: area,
        distanceKm: input.driving ? 25 : 8,
        playMinutes: 90,
        transport: mode,
        estimatedCost: "约 0-40 / 人",
        highlights: ["代表景观", "网红打卡", "短徒步"],
        description: "当天最值得停留的主景点，兼顾观景、拍照和轻量活动。",
        photoUrl: unsplash(`${area} scenic`),
      },
      {
        startTime: "13:15",
        endTime: "14:30",
        name: "午餐与补给",
        location: area,
        distanceKm: input.driving ? 6 : 2,
        playMinutes: 60,
        transport: mode,
        estimatedCost: "约 25-45 / 人",
        highlights: ["午餐", "补给", "休息"],
        description: "中段安排用餐和补给，避免下午行程体力断档。",
        photoUrl: unsplash(`${area} food`),
      },
      {
        startTime: "15:00",
        endTime: input.endTime,
        name: "收尾景点与返回",
        location: input.endLocation,
        distanceKm: input.driving ? 30 : 10,
        playMinutes: 90,
        transport: mode,
        estimatedCost: "按现场消费",
        highlights: ["收尾", "轻松返回", "日落机会"],
        description: "下午安排一个顺路收尾点，最后回到当晚终点，保留缓冲时间。",
        photoUrl: unsplash(`${area} sunset`),
      },
    ],
  };
}

function normalizeInput(input: RecommendRequest): Required<RecommendRequest> {
  return {
    journeyName: input.journeyName?.trim() || "Journey",
    destination: input.destination?.trim() || "目的地",
    date: input.date?.trim() || new Date().toISOString().slice(0, 10),
    startLocation: input.startLocation?.trim() || "",
    startTime: input.startTime?.trim() || "09:00",
    endLocation: input.endLocation?.trim() || "",
    endTime: input.endTime?.trim() || "18:00",
    driving: Boolean(input.driving),
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : [],
    notes: input.notes?.trim() || "",
  };
}

async function callModel(input: Required<RecommendRequest>) {
  const configs = getProviderConfigs();
  if (configs.length === 0) return null;
  const routeArea = [input.startLocation, input.endLocation]
    .filter(Boolean)
    .join(" -> ");

  const prompt = [
    "Generate one practical single-day travel route recommendation.",
    "Return strict JSON only with keys: title, summary, heroImageUrl, segments.",
    "segments must be 4 to 7 items. Each segment requires: startTime, endTime, name, location, distanceKm, playMinutes, transport, estimatedCost, highlights, description, photoUrl.",
    "Use concise Chinese text. Do not include hotel booking. Respect start/end addresses and times.",
    "The explicit Start and End locations are the highest-priority geographic constraints.",
    "Build the route inside or near the Start/End city or region. Do not choose attractions in a different country, city, or journey destination unless the user explicitly asks for that.",
    "Journey and Destination are background context only. If they conflict with Start/End, ignore Journey and Destination.",
    `Journey: ${input.journeyName}`,
    `Journey destination background: ${input.destination}`,
    `Route geographic scope: ${routeArea}`,
    `Date: ${input.date}`,
    `Start: ${input.startLocation} around ${input.startTime}`,
    `End: ${input.endLocation} no later than ${input.endTime}`,
    `Driving: ${input.driving ? "yes" : "no"}`,
    `Style tags: ${input.tags.join(", ") || "休闲"}`,
    input.notes
      ? `User constraints and notes: ${input.notes}. Treat must-go places and fixed-time constraints as hard constraints when possible.`
      : "User constraints and notes: none.",
  ].join("\n");

  for (const config of configs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.35,
          messages: [
            {
              role: "system",
              content:
                "You are OTR's travel route recommendation engine. Return practical single-day route JSON only. Never expose internal reasoning.",
            },
            { role: "user", content: prompt },
          ],
          response_format: config.responseFormat,
        }),
      });
      clearTimeout(timeout);

      if (!response.ok) continue;
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) continue;
      return parseModelJson(content);
    } catch {
      clearTimeout(timeout);
    }
  }

  return null;
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as RecommendRequest | null;
  if (!payload) return jsonError("Invalid JSON body.");

  const input = normalizeInput(payload);
  if (!input.startLocation || !input.endLocation) {
    return jsonError("Start and end locations are required.");
  }

  const aiRecommendation = await callModel(input);
  return NextResponse.json({
    recommendation: aiRecommendation ?? fallbackRecommendation(input),
    provider: aiRecommendation ? "ai" : "local_fallback",
  });
}
