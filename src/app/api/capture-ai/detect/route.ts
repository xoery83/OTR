import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  defaultCaptureIntentConfig,
  detectCaptureIntentOnServer,
} from "@/lib/capture-ai/server";
import type {
  CaptureEngineOptions,
  CaptureIntentConfig,
} from "@/lib/capture-ai/types";

type DetectRequest = {
  tripId?: string;
  text?: string;
  inputTypes?: string[];
  engineOptions?: CaptureEngineOptions;
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
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadConfig(supabase: ReturnType<typeof getSupabaseForRequest>) {
  const defaults = defaultCaptureIntentConfig();
  const [{ data: rules }, { data: prompts }, { data: routing }] = await Promise.all([
    supabase
      .from("capture_intent_rules")
      .select("*")
      .order("sort_order", { ascending: true }),
    supabase
      .from("capture_prompt_templates")
      .select("*")
      .order("template_key", { ascending: true }),
    supabase
      .from("capture_routing_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle(),
  ]);

  if (!rules?.length || !prompts?.length) {
    return defaults;
  }

  return {
    rules: rules.map((row) => ({
      id: row.id,
      intentKey: row.intent_key,
      displayName: row.display_name,
      description: row.description ?? "",
      enabled: row.enabled,
      confidenceThreshold: Number(row.confidence_threshold),
      autoExecute: row.auto_execute,
      requiresConfirmation: row.requires_confirmation,
      sortOrder: row.sort_order,
      metadata: row.metadata ?? {},
    })),
    prompts: prompts.map((row) => ({
      id: row.id,
      templateKey: row.template_key,
      displayName: row.display_name,
      prompt: row.prompt,
      metadata: row.metadata ?? {},
    })),
    routing: routing
      ? {
          enableLocalParser: routing.enable_local_parser,
          enableLocalIntentEngine: routing.enable_local_intent_engine,
          enableLlmRouter: routing.enable_llm_router,
          localConfidenceThreshold: Number(routing.local_confidence_threshold),
          complexityThreshold: Number(routing.complexity_threshold),
          forceAllRequestsToLlm: routing.force_all_requests_to_llm,
          forceLocalOnly: routing.force_local_only,
          metadata: routing.metadata ?? {},
        }
      : defaults.routing,
  } satisfies CaptureIntentConfig;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DetectRequest;
    const text = body.text?.trim();
    if (!text) {
      return jsonError("text is required.", 400);
    }

    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    let tripContext: Record<string, unknown> = {};
    if (body.tripId) {
      const { data: trip } = await supabase
        .from("trips")
        .select("id,name,destination,start_date,end_date")
        .eq("id", body.tripId)
        .maybeSingle();
      if (trip) {
        tripContext = {
          trip,
        };
      }
    }
    const engineOptions = {
      ...(body.engineOptions ?? {}),
      lockedContext: {
        ...(body.engineOptions?.lockedContext ?? {}),
        ...(body.tripId ? { journeyId: body.tripId } : {}),
      },
    };

    const result = await detectCaptureIntentOnServer({
      text,
      inputTypes: body.inputTypes,
      config: await loadConfig(supabase),
      context: {
        ...tripContext,
        captureEngine: engineOptions,
      },
      engineOptions,
    });

    return NextResponse.json({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not detect Capture intent.",
      500,
    );
  }
}
