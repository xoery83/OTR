import fixtureLibrary from "../fixtures/capture-fixtures-batch-001.json";
import type {
  CaptureFixture,
  CaptureFixtureLibrary,
  CaptureStateInput,
  PatternMatch,
} from "../types";

const library = fixtureLibrary as CaptureFixtureLibrary;

const zhNumberMap: Record<string, number> = {
  零: 0,
  "〇": 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const currencyPatterns: [string, RegExp][] = [
  ["EUR", /€|欧|欧元|euros?|eur/i],
  ["NZD", /纽币|新西兰元|nzd/i],
  ["AUD", /澳币|澳元|澳大利亚元|aud|australian dollars?/i],
  ["CHF", /瑞郎|瑞士法郎|chf|swiss francs?/i],
  ["ISK", /冰岛克朗|克朗|icelandic krona|isk/i],
  ["USD", /\$|美元|usd|dollars?/i],
  ["CNY", /人民币|rmb|cny|¥|￥/i],
];

function normalizeInput(input: string) {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?？!！。.\s]+$/g, "")
    .toLocaleLowerCase();
}

function exactFixture(input: string, state: CaptureStateInput) {
  const normalized = normalizeInput(input);
  return library.fixtures.find((fixture) => {
    if (normalizeInput(fixture.input) !== normalized) return false;
    return JSON.stringify(fixture.initialState ?? {}) === JSON.stringify(state ?? {});
  });
}

function fixtureResult(
  fixture: CaptureFixture,
  source: PatternMatch["source"],
): PatternMatch {
  return {
    intentType: fixture.expected.intentType,
    action: fixture.expected.action,
    fields: { ...fixture.expected.fields },
    missingFields: [...fixture.expected.missingFields],
    confidence: Math.max(fixture.expected.confidenceMin, fixture.expected.confidenceMin + 0.02),
    allowLLM: fixture.expected.action === "needs_llm",
    source,
    matchedFixtureId: fixture.id,
  };
}

function parseNumber(value: string | undefined) {
  if (!value) return undefined;
  if (/^\d+(?:[,.]\d+)?$/.test(value)) return Number(value.replace(",", ""));
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (zhNumberMap[value.slice(1)] ?? 0);
  if (value.endsWith("十")) return (zhNumberMap[value.slice(0, 1)] ?? 0) * 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (zhNumberMap[tens] ?? 0) * 10 + (zhNumberMap[ones] ?? 0);
  }
  return zhNumberMap[value];
}

function parseAmount(input: string) {
  const matches = [...input.matchAll(/(\d+(?:[,.]\d+)?|[一二两三四五六七八九十]{1,3})/g)];
  const match = matches.at(-1);
  return parseNumber(match?.[1]);
}

function parseCurrency(input: string) {
  let currency: string | undefined;
  currencyPatterns.forEach(([code, pattern]) => {
    if (pattern.test(input)) {
      currency = code;
    }
  });
  return currency;
}

function addDays(date: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const next = new Date(`${date}T00:00:00`);
  if (Number.isNaN(next.getTime())) return undefined;
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function parseDate(input: string, state?: CaptureStateInput) {
  const baseDate =
    typeof state?.fields?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(state.fields.date)
      ? state.fields.date
      : undefined;
  if (/yesterday|昨天/.test(input)) return "yesterday";
  if (/tomorrow|明天|明晚/.test(input)) return baseDate ? addDays(baseDate, 1) ?? "tomorrow" : "tomorrow";
  if (/today|今晚|今天|刚才/.test(input)) return "today";
  const explicitDate = parseExplicitDate(input);
  if (explicitDate) return explicitDate;
  return undefined;
}

function parseExplicitDate(input: string) {
  const match = input.match(/(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*(?:日|号)?/);
  if (!match) return undefined;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return undefined;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const year = new Date().getFullYear();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isDateOnlyFollowup(input: string) {
  const date = parseDate(input);
  if (!date) return false;
  const stripped = input
    .replace(/(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*(?:日|号)?/g, "")
    .replace(/yesterday|today|tomorrow|tonight|昨天|今天|今晚|明天|明晚|刚才/gi, "")
    .replace(/[呢?？,，。.\s]/g, "");
  return stripped.length === 0;
}

function lodgingNightForDate(date: string) {
  if (date === "tomorrow") return "tomorrow_night";
  if (date === "today") return "tonight";
  return "specified_night";
}

function parseTime(input: string) {
  const match = input.match(
    /(上午|早上|中午|下午|晚上|今晚)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})(?::(\d{2}))?\s*(am|pm|点|时)?/i,
  );
  if (!match) return undefined;
  const period = match[1] ?? "";
  const suffix = (match[4] ?? "").toLocaleLowerCase();
  const hourValue = parseNumber(match[2]);
  if (hourValue === undefined) return undefined;
  let hour = hourValue;
  const minute = match[3] ? Number(match[3]) : 0;
  if ((period === "下午" || period === "晚上" || period === "今晚" || suffix === "pm") && hour < 12) {
    hour += 12;
  }
  if ((period === "上午" || period === "早上" || suffix === "am") && hour === 12) {
    hour = 0;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function stripMissing(missingFields: string[] | undefined, fields: string[]) {
  return (missingFields ?? []).filter((field) => !fields.includes(field));
}

function detectPayer(input: string) {
  const trimmed = input.trim();
  if (/^(我付的|我付|i paid)$/i.test(trimmed)) return "current_user";
  const zhPayer = trimmed.match(/^(.+?)付的?$/)?.[1]?.trim();
  if (zhPayer) return zhPayer;
  const enPaid = trimmed.match(/^([A-Z][A-Za-z]*)\s+paid/i)?.[1];
  if (enPaid) return enPaid;
  if (/^[A-Z][A-Za-z]+$/.test(trimmed)) return trimmed;
  return undefined;
}

function resolveLastQuestion(input: string, state: CaptureStateInput): PatternMatch | null {
  if (!state.lastQuestion?.field) return null;
  if (state.lastQuestion.field === "payer") {
    const payer = detectPayer(input);
    if (!payer) return null;
    return {
      intentType: state.intentType ?? "create_expense",
      action: "update_state",
      fields: { payer },
      missingFields: stripMissing(state.missingFields, ["payer"]),
      confidence: 0.94,
      allowLLM: false,
      source: "lastQuestion",
    };
  }
  return null;
}

function resolveCorrection(input: string, state: CaptureStateInput): PatternMatch | null {
  if (!state.intentType) return null;
  const correction = /不是|改成|改为|not\b|change it to/i.test(input);
  if (!correction) return null;

  const amount = parseAmount(input);
  if (amount !== undefined && /(不是|not\b)/i.test(input)) {
    return {
      intentType: "correction",
      action: "update_state",
      fields: { amount },
      missingFields: state.missingFields ?? [],
      confidence: 0.94,
      allowLLM: false,
      source: "correction",
    };
  }

  const currency = parseCurrency(input);
  if (currency) {
    return {
      intentType: "correction",
      action: "update_state",
      fields: { currency },
      missingFields: state.missingFields ?? [],
      confidence: 0.94,
      allowLLM: false,
      source: "correction",
    };
  }

  const date = parseDate(input);
  if (date) {
    return {
      intentType: "correction",
      action: "update_state",
      fields: { date },
      missingFields: state.missingFields ?? [],
      confidence: 0.94,
      allowLLM: false,
      source: "correction",
    };
  }

  if (/午饭|lunch/i.test(input)) {
    return {
      intentType: "correction",
      action: "update_state",
      fields: { title: /lunch/i.test(input) ? "lunch" : "午饭", category: "food" },
      missingFields: state.missingFields ?? [],
      confidence: 0.94,
      allowLLM: false,
      source: "correction",
    };
  }

  return null;
}

function resolveQuery(input: string, state: CaptureStateInput = {}): PatternMatch | null {
  const fixture = library.fixtures.find(
    (item) => item.category === "query" && normalizeInput(item.input) === normalizeInput(input),
  );
  if (fixture) return fixtureResult(fixture, "query");

  const date = parseDate(input, state);
  if (
    date &&
    /(住|住宿|酒店|hotel|staying|stay)/i.test(
      input,
    )
  ) {
    const lodgingDate = date;
    return {
      intentType: "query_lodging",
      action: "answer",
      fields: {
        date: lodgingDate,
        lodgingNight: lodgingNightForDate(lodgingDate),
      },
      missingFields: [],
      confidence: 0.9,
      allowLLM: false,
      source: "query",
    };
  }

  if (
    date &&
    /安排|行程|活动|景点|计划|干嘛|做什么|what.*(?:plan|doing|schedule|activit)|(?:plan|schedule|activit)/i.test(input)
  ) {
    return {
      intentType: "query_planner",
      action: "answer",
      fields: { date },
      missingFields: [],
      confidence: 0.9,
      allowLLM: false,
      source: "query",
    };
  }

  if (
    date &&
    /(花了多少钱|花多少钱|花费|消费|支出|账单|how much.*(?:spend|spent)|(?:spend|spent))/i.test(input)
  ) {
    return {
      intentType: "query_ledger",
      action: "answer",
      fields: {
        date,
        aggregate: "sum",
      },
      missingFields: [],
      confidence: 0.9,
      allowLLM: false,
      source: "query",
    };
  }

  return null;
}

function resolveQueryFollowup(input: string, state: CaptureStateInput): PatternMatch | null {
  if (!isDateOnlyFollowup(input)) return null;
  const date = parseDate(input, state);
  if (!date) return null;

  if (state.intentType === "query_lodging") {
    return {
      intentType: "query_lodging",
      action: "answer",
      fields: {
        date,
        lodgingNight: lodgingNightForDate(date),
      },
      missingFields: [],
      confidence: 0.91,
      allowLLM: false,
      source: "query",
    };
  }

  if (state.intentType === "query_planner") {
    const previousTimeFilter =
      typeof state.fields?.timeFilter === "string" ? state.fields.timeFilter : undefined;
    return {
      intentType: "query_planner",
      action: "answer",
      fields: {
        date,
        ...(previousTimeFilter && date === "today" ? { timeFilter: previousTimeFilter } : {}),
      },
      missingFields: [],
      confidence: 0.91,
      allowLLM: false,
      source: "query",
    };
  }

  return null;
}

function resolvePlanner(input: string): PatternMatch | null {
  const fixture = library.fixtures.find(
    (item) => item.category === "planner" && normalizeInput(item.input) === normalizeInput(input),
  );
  if (fixture) return fixtureResult(fixture, "planner");

  if (/改到|改成|move|change/i.test(input) && /午饭|lunch/i.test(input)) {
    const time = parseTime(input);
    if (!time) return null;
    return {
      intentType: "update_planner_item",
      action: "confirm",
      fields: {
        date: parseDate(input) ?? "today",
        targetHint: /lunch/i.test(input) ? "lunch" : "午饭",
        fieldToUpdate: "time",
        newTime: time,
      },
      missingFields: [],
      confidence: 0.88,
      allowLLM: false,
      source: "planner",
    };
  }

  return null;
}

function resolveLedger(input: string): PatternMatch | null {
  const fixture = library.fixtures.find(
    (item) => item.category === "ledger" && normalizeInput(item.input) === normalizeInput(input),
  );
  if (fixture) return fixtureResult(fixture, "ledger");
  return null;
}

function resolveMemory(input: string): PatternMatch | null {
  const fixture = library.fixtures.find(
    (item) =>
      item.category === "memory_mixed" &&
      item.expected.action !== "needs_llm" &&
      normalizeInput(item.input) === normalizeInput(input),
  );
  return fixture ? fixtureResult(fixture, "memory") : null;
}

function resolveMixedIntent(input: string): PatternMatch | null {
  const fixture = library.fixtures.find(
    (item) =>
      item.category === "memory_mixed" &&
      item.expected.action === "needs_llm" &&
      normalizeInput(item.input) === normalizeInput(input),
  );
  return fixture ? fixtureResult(fixture, "mixedIntent") : null;
}

export function fixturePattern(input: string, state: CaptureStateInput): PatternMatch | null {
  const fixture = exactFixture(input, state);
  if (!fixture) return null;
  const source =
    fixture.expected.action === "needs_llm"
      ? "mixedIntent"
      : fixture.initialState.lastQuestion
        ? "lastQuestion"
        : fixture.category === "followup_correction"
          ? "correction"
          : fixture.category === "query"
            ? "query"
            : fixture.category === "planner"
              ? "planner"
              : fixture.category === "ledger"
                ? "ledger"
                : "memory";
  return fixtureResult(fixture, source);
}

export const capturePatternLibrary = {
  version: library.version,
  fixtures: library.fixtures,
  resolveLastQuestion,
  resolveCorrection,
  resolveQueryFollowup,
  resolveQuery,
  resolvePlanner,
  resolveLedger,
  resolveMemory,
  resolveMixedIntent,
};
