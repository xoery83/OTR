import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  normalizeParserText,
  type ParserSource,
} from "@/lib/parser-upgrade";

type ParserAliasDraft = {
  alias_text?: string;
  canonical_type?: string;
  canonical_id?: string | null;
  canonical_value?: string;
  scope?: "journey" | "global";
  status?: "pending" | "enabled" | "disabled";
};

type ParserRuleDraft = {
  scope?: "journey" | "global";
  source?: ParserSource;
  intent?: string | null;
  pattern_type?: "keyword" | "regex" | "semantic_template" | "llm_generated";
  pattern?: string;
  slot_mapping?: Record<string, unknown>;
  priority?: number;
  confidence?: number;
  status?: "pending" | "enabled" | "disabled";
};

type SuggestRequest = {
  action: "suggest";
  source: ParserSource;
  journeyId?: string | null;
  originalText: string;
  currentParseResult?: unknown;
  errorTypes?: string[];
  guidance?: string | null;
  language?: string | null;
  contextSnapshot?: unknown;
};

type SaveRequest = {
  action: "save";
  source: ParserSource;
  journeyId?: string | null;
  originalText: string;
  wrongParseResult?: unknown;
  correctedParseResult: unknown;
  errorTypes?: string[];
  language?: string | null;
  aliases?: ParserAliasDraft[];
  rules?: ParserRuleDraft[];
  scope?: "journey" | "global";
};

type ParserUpgradeRequest = SuggestRequest | SaveRequest;

const allowedCanonicalTypes = new Set([
  "person",
  "place",
  "currency",
  "payment_method",
  "split_method",
  "plan_type",
]);

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

function openAiEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return normalizedBaseUrl.endsWith("/v1")
    ? `${normalizedBaseUrl}/chat/completions`
    : normalizedBaseUrl.includes("api.openai.com")
      ? `${normalizedBaseUrl}/v1/chat/completions`
      : `${normalizedBaseUrl}/chat/completions`;
}

function providerConfig() {
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      endpoint: openAiEndpoint(
        process.env.OPENAI_BASE_URL ||
          process.env.OPENAI_API_URL ||
          "https://api.openai.com/v1",
      ),
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    };
  }

  if (process.env.DEEPSEEK_API_KEY) {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY,
      endpoint: `${(
        process.env.DEEPSEEK_BASE_URL ||
        process.env.DEEPSEEK_API_URL ||
        "https://api.deepseek.com"
      ).replace(/\/$/, "")}/chat/completions`,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    };
  }

  return null;
}

function parseJson(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fencedMatch ? fencedMatch[1] : trimmed);
}

async function suggestWithModel(input: SuggestRequest) {
  const config = providerConfig();
  if (!config) {
    return {
      corrected_parse_result: input.currentParseResult ?? {},
      proposed_aliases: [],
      proposed_rules: [],
      confidence: 0.3,
      explanation:
        "No LLM provider is configured. Edit the corrected parse manually, then save it as an exact example.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
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
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You improve a travel parser using data only. Never generate code. Return strict JSON with keys: corrected_parse_result, proposed_aliases, proposed_rules, confidence, explanation. corrected_parse_result must use the same shape as the current parser result when possible. For Capture source, intent must be one of memory, planner_update, expense, navigation, assistant; use planner_update instead of journey_update. proposed_rules are database rules, not executable code. Use only keyword, regex, semantic_template, or llm_generated pattern_type.",
          },
          {
            role: "user",
            content: JSON.stringify({
              source: input.source,
              original_text: input.originalText,
              current_parse_result: input.currentParseResult ?? null,
              error_types: input.errorTypes ?? [],
              user_guidance: input.guidance ?? null,
              language: input.language ?? null,
              context_snapshot: input.contextSnapshot ?? null,
            }),
          },
        ],
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text);
    }

    const payload = JSON.parse(text) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Model returned an empty response.");
    return parseJson(content);
  } finally {
    clearTimeout(timeout);
  }
}

function cleanAliases(
  aliases: ParserAliasDraft[] | undefined,
  journeyId: string | null,
  defaultScope: "journey" | "global",
) {
  return (aliases ?? [])
    .filter(
      (alias) =>
        alias.alias_text?.trim() &&
        alias.canonical_value?.trim() &&
        alias.canonical_type &&
        allowedCanonicalTypes.has(alias.canonical_type),
    )
    .map((alias) => ({
      journey_id: (alias.scope ?? defaultScope) === "global" ? null : journeyId,
      alias_text: alias.alias_text!.trim(),
      canonical_type: alias.canonical_type!,
      canonical_id: alias.canonical_id ?? null,
      canonical_value: alias.canonical_value!.trim(),
      scope: alias.scope ?? defaultScope,
      status: alias.status ?? "enabled",
    }));
}

function cleanRules(
  rules: ParserRuleDraft[] | undefined,
  source: ParserSource,
  journeyId: string | null,
  defaultScope: "journey" | "global",
) {
  return (rules ?? [])
    .filter((rule) => rule.pattern?.trim())
    .map((rule) => {
      const scope = rule.scope ?? defaultScope;
      const highRisk = /expense|ledger|payment|split|amount|payer/i.test(
        `${rule.intent ?? ""} ${JSON.stringify(rule.slot_mapping ?? {})}`,
      );
      return {
        journey_id: scope === "global" ? null : journeyId,
        scope,
        source: rule.source ?? source,
        intent: rule.intent ?? null,
        pattern_type: rule.pattern_type ?? "llm_generated",
        pattern: rule.pattern!.trim(),
        slot_mapping: rule.slot_mapping ?? {},
        priority: rule.priority ?? 100,
        confidence: rule.confidence ?? 0.8,
        status: rule.status ?? (scope === "global" || highRisk ? "pending" : "enabled"),
      };
    });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ParserUpgradeRequest;
    const supabase = getSupabaseForRequest(request);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonError("You must be logged in.", 401);
    }

    if (!body.originalText?.trim()) {
      return jsonError("originalText is required.", 400);
    }

    if (body.action === "suggest") {
      const suggestion = await suggestWithModel(body);
      return NextResponse.json({ suggestion });
    }

    const journeyId = body.journeyId ?? null;
    const scope = body.scope ?? "journey";
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("account_role")
      .eq("id", userData.user.id)
      .single();

    if (profileError) throw profileError;
    const isAdmin =
      (profile as { account_role?: string } | null)?.account_role === "admin";
    if (scope === "global" && !isAdmin) {
      return jsonError("Only system admins can save global parser upgrades.", 403);
    }

    const [exampleResult, correctionResult] = await Promise.all([
      supabase
        .from("parser_examples")
        .insert({
          journey_id: scope === "global" ? null : journeyId,
          source: body.source,
          original_text: body.originalText,
          normalized_text: normalizeParserText(body.originalText),
          corrected_parse_result: body.correctedParseResult,
          language: body.language ?? null,
          created_by: userData.user.id,
        })
        .select("id")
        .single(),
      supabase
        .from("parser_corrections")
        .insert({
          journey_id: journeyId,
          source: body.source,
          original_text: body.originalText,
          wrong_parse_result: body.wrongParseResult ?? null,
          corrected_parse_result: body.correctedParseResult,
          error_types: body.errorTypes ?? [],
          created_by: userData.user.id,
        })
        .select("id")
        .single(),
    ]);

    if (exampleResult.error) throw exampleResult.error;
    if (correctionResult.error) throw correctionResult.error;

    const aliases = cleanAliases(body.aliases, journeyId, scope).map((alias) => ({
      ...alias,
      created_by: userData.user.id,
    }));
    const rules = cleanRules(body.rules, body.source, journeyId, scope).map((rule) => ({
      ...rule,
      created_by: userData.user.id,
    }));

    const [aliasResult, ruleResult] = await Promise.all([
      aliases.length > 0
        ? supabase.from("parser_aliases").insert(aliases).select("id")
        : Promise.resolve({ data: [], error: null }),
      rules.length > 0
        ? supabase.from("parser_rules").insert(rules).select("id")
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (aliasResult.error) throw aliasResult.error;
    if (ruleResult.error) throw ruleResult.error;

    return NextResponse.json({
      saved: {
        exampleId: exampleResult.data.id,
        correctionId: correctionResult.data.id,
        aliasIds: (aliasResult.data ?? []).map((row: { id: string }) => row.id),
        ruleIds: (ruleResult.data ?? []).map((row: { id: string }) => row.id),
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not upgrade parser.",
      500,
    );
  }
}
