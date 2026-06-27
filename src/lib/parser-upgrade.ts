import type { SupabaseClient } from "@supabase/supabase-js";

export type ParserSource =
  | "capture"
  | "planner_import"
  | "ledger_import"
  | "memory_import";

export type ParserExampleMatch = {
  id: string;
  correctedParseResult: unknown;
  confidence: number;
};

type ParserExampleRow = {
  id: string;
  normalized_text?: string | null;
  corrected_parse_result: unknown;
  usage_count?: number | null;
};

export function normalizeParserText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeParserLooseText(value: string) {
  return normalizeParserText(value).replace(
    /[。！？!?.,，、；;：:"“”'‘’（）()\[\]【】\s]/g,
    "",
  );
}

async function bumpExampleUsage(
  supabase: SupabaseClient,
  id: string,
  usageCount: unknown,
) {
  await supabase
    .from("parser_examples")
    .update({ usage_count: Number(usageCount ?? 0) + 1 })
    .eq("id", id);
}

async function queryExactExamples(input: {
  supabase: SupabaseClient;
  source: ParserSource;
  journeyId: string | null;
  normalizedText?: string;
  limit?: number;
}) {
  const select = input.normalizedText
    ? "id,corrected_parse_result,usage_count"
    : "id,normalized_text,corrected_parse_result,usage_count";
  const limit = input.limit ?? 1;

  const journeyQuery = input.journeyId
    ? input.supabase
        .from("parser_examples")
        .select(select)
        .eq("source", input.source)
        .eq("journey_id", input.journeyId)
        .order("usage_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit)
    : null;
  const globalQuery = input.supabase
    .from("parser_examples")
    .select(select)
    .eq("source", input.source)
    .is("journey_id", null)
    .order("usage_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.normalizedText) {
    journeyQuery?.eq("normalized_text", input.normalizedText);
    globalQuery.eq("normalized_text", input.normalizedText);
  }

  const [journeyResult, globalResult] = await Promise.all([
    journeyQuery,
    globalQuery,
  ]);

  return [
    ...(((journeyResult && !journeyResult.error
      ? journeyResult.data
      : []) ?? []) as unknown as ParserExampleRow[]),
    ...(((!globalResult.error ? globalResult.data : []) ?? []) as unknown as ParserExampleRow[]),
  ];
}

export async function findExactParserExample(input: {
  supabase: SupabaseClient;
  source: ParserSource;
  journeyId: string | null;
  originalText: string;
}): Promise<ParserExampleMatch | null> {
  const normalizedText = normalizeParserText(input.originalText);
  const looseText = normalizeParserLooseText(input.originalText);

  try {
    const exactRows = await queryExactExamples({
      supabase: input.supabase,
      source: input.source,
      journeyId: input.journeyId,
      normalizedText,
      limit: 1,
    });
    const data = exactRows[0];

    if (!data) {
      if (input.source !== "capture") return null;
    } else {
      await bumpExampleUsage(input.supabase, data.id, data.usage_count);

      return {
        id: data.id,
        correctedParseResult: data.corrected_parse_result,
        confidence: 0.99,
      };
    }
  } catch {
    // Fall through to the Capture-specific relaxed lookup below.
  }

  if (input.source !== "capture") return null;

  try {
    const data = await queryExactExamples({
      supabase: input.supabase,
      source: input.source,
      journeyId: input.journeyId,
      limit: 100,
    });

    if (!data.length) return null;

    const matched = data.find((row) => {
      const stored = String(row.normalized_text ?? "");
      const storedLoose = normalizeParserLooseText(stored);
      return (
        stored === normalizedText ||
        storedLoose === looseText ||
        storedLoose.endsWith(looseText) ||
        stored.endsWith(`\n${normalizedText}`) ||
        stored.split("\n").some((line) => line.trim() === normalizedText) ||
        stored
          .split("\n")
          .some((line) => normalizeParserLooseText(line) === looseText)
      );
    });

    if (!matched) return null;

    await bumpExampleUsage(input.supabase, matched.id, matched.usage_count);

    return {
      id: matched.id,
      correctedParseResult: matched.corrected_parse_result,
      confidence: 0.95,
    };
  } catch {
    return null;
  }
}

export async function writeParserParseLog(input: {
  supabase: SupabaseClient;
  journeyId: string | null;
  source: ParserSource;
  originalText: string;
  parseResult: unknown;
  parseMethod: "rule" | "example" | "alias" | "llm" | "correction" | "local";
  matchedRuleId?: string | null;
  confidence?: number | null;
  userId?: string | null;
}) {
  try {
    await input.supabase.from("parser_parse_logs").insert({
      journey_id: input.journeyId,
      source: input.source,
      original_text: input.originalText,
      parse_result: input.parseResult,
      parse_method: input.parseMethod,
      matched_rule_id: input.matchedRuleId ?? null,
      confidence: input.confidence ?? null,
      created_by: input.userId ?? null,
    });
  } catch {
    // Parser logging must never block the user-facing parser.
  }
}
