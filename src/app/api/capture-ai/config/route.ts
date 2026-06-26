import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  defaultCaptureIntentConfig,
} from "@/lib/capture-ai/server";
import type {
  CaptureIntentConfig,
  CaptureIntentKey,
  CapturePromptTemplate,
  CaptureRoutingConfig,
} from "@/lib/capture-ai/types";

type RuleRow = {
  id: string;
  intent_key: CaptureIntentKey;
  display_name: string;
  description: string | null;
  enabled: boolean;
  confidence_threshold: number;
  auto_execute: boolean;
  requires_confirmation: boolean;
  sort_order: number;
  metadata: Record<string, unknown> | null;
};

type PromptRow = {
  id: string;
  template_key: CapturePromptTemplate["templateKey"];
  display_name: string;
  prompt: string;
  metadata: Record<string, unknown> | null;
};

type RoutingRow = {
  enable_local_parser: boolean;
  enable_local_intent_engine: boolean;
  enable_llm_router: boolean;
  local_confidence_threshold: number;
  complexity_threshold: number;
  force_all_requests_to_llm: boolean;
  force_local_only: boolean;
  metadata: Record<string, unknown> | null;
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

function mapRouting(row: RoutingRow | null | undefined): CaptureRoutingConfig {
  const defaults = defaultCaptureIntentConfig().routing;
  if (!row) return defaults;

  return {
    enableLocalParser: row.enable_local_parser,
    enableLocalIntentEngine: row.enable_local_intent_engine,
    enableLlmRouter: row.enable_llm_router,
    localConfidenceThreshold: Number(row.local_confidence_threshold),
    complexityThreshold: Number(row.complexity_threshold),
    forceAllRequestsToLlm: row.force_all_requests_to_llm,
    forceLocalOnly: row.force_local_only,
    metadata: row.metadata ?? {},
  };
}

function mapConfig(
  ruleRows: RuleRow[],
  promptRows: PromptRow[],
  routingRow?: RoutingRow | null,
): CaptureIntentConfig {
  return {
    rules: ruleRows.map((row) => ({
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
    prompts: promptRows.map((row) => ({
      id: row.id,
      templateKey: row.template_key,
      displayName: row.display_name,
      prompt: row.prompt,
      metadata: row.metadata ?? {},
    })),
    routing: mapRouting(routingRow),
  };
}

async function readConfig(supabase: ReturnType<typeof getSupabaseForRequest>) {
  const [
    { data: rules, error: ruleError },
    { data: prompts, error: promptError },
    { data: routing, error: routingError },
  ] =
    await Promise.all([
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

  if (ruleError || promptError || routingError) {
    throw ruleError || promptError || routingError;
  }

  if (!rules?.length || !prompts?.length) {
    return defaultCaptureIntentConfig();
  }

  return mapConfig(
    (rules ?? []) as RuleRow[],
    (prompts ?? []) as PromptRow[],
    routing as RoutingRow | null,
  );
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    return NextResponse.json({ config: await readConfig(supabase) });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not load Capture AI config.",
      500,
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as CaptureIntentConfig;
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    const { error: ruleError } = await supabase
      .from("capture_intent_rules")
      .upsert(
        body.rules.map((rule) => ({
          intent_key: rule.intentKey,
          display_name: rule.displayName,
          description: rule.description,
          enabled: rule.enabled,
          confidence_threshold: rule.confidenceThreshold,
          auto_execute: rule.autoExecute,
          requires_confirmation: rule.requiresConfirmation,
          sort_order: rule.sortOrder,
          metadata: rule.metadata ?? {},
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "intent_key" },
      );
    if (ruleError) throw ruleError;

    const { error: promptError } = await supabase
      .from("capture_prompt_templates")
      .upsert(
        body.prompts.map((prompt) => ({
          template_key: prompt.templateKey,
          display_name: prompt.displayName,
          prompt: prompt.prompt,
          metadata: prompt.metadata ?? {},
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "template_key" },
      );
    if (promptError) throw promptError;

    const routing = body.routing ?? defaultCaptureIntentConfig().routing;
    const { error: routingError } = await supabase
      .from("capture_routing_config")
      .upsert(
        {
          id: "default",
          enable_local_parser: routing.enableLocalParser,
          enable_local_intent_engine: routing.enableLocalIntentEngine,
          enable_llm_router: routing.enableLlmRouter,
          local_confidence_threshold: routing.localConfidenceThreshold,
          complexity_threshold: routing.complexityThreshold,
          force_all_requests_to_llm: routing.forceAllRequestsToLlm,
          force_local_only: routing.forceLocalOnly,
          metadata: routing.metadata ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    if (routingError) throw routingError;

    return NextResponse.json({ config: await readConfig(supabase) });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not save Capture AI config.",
      500,
    );
  }
}
