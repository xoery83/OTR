import {
  commandBehaviorRules,
  currencyRules,
  expenseCategoryRules,
  queryTargetRules,
  questionBehaviorRules,
  recordSignalRules,
  sentenceShapeRules,
  type Capture2Layer1Intent,
  type Capture2RouteTarget,
  type Capture2Rule,
} from "./safe-rules";

export type Capture2SafeIntent =
  | "journey_query"
  | "navigation"
  | "expense"
  | "planner"
  | "deferred";

export type Capture2SafeClassification = {
  intent: Capture2SafeIntent;
  confidence: number;
  reason: string;
  action:
    | "answer_query"
    | "open_map"
    | "open_expense_form"
    | "open_planner_form"
    | "open_planner_page"
    | "open_ledger_page"
    | "defer";
  extracted: {
    title?: string;
    amount?: string;
    currency?: string;
    category?: string;
    locationName?: string;
    eventType?: string;
    reservationType?: string;
    rawTarget?: string;
    layer1?: Capture2Layer1Intent;
    target?: Capture2RouteTarget;
    ruleId?: string;
  };
};

type Layer1Result = {
  layer1: Capture2Layer1Intent;
  rule?: Capture2Rule;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function firstMatchingRule(text: string, rules: Capture2Rule[]) {
  return rules.find((rule) => rule.patterns.some((pattern) => pattern.test(text)));
}

function firstCurrency(text: string) {
  for (const [pattern, currency] of currencyRules) {
    if (pattern.test(text)) return currency;
  }
  return "";
}

function firstExpenseCategory(text: string) {
  for (const [pattern, category] of expenseCategoryRules) {
    if (pattern.test(text)) return category;
  }
  return "other";
}

const chineseDigitValues: Record<string, number> = {
  零: 0,
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

const chineseUnitValues: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000,
};

function parseChineseInteger(value: string) {
  let total = 0;
  let section = 0;
  let number = 0;

  for (const char of value) {
    if (char in chineseDigitValues) {
      number = chineseDigitValues[char];
      continue;
    }

    const unit = chineseUnitValues[char];
    if (!unit) return null;
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
      number = 0;
      continue;
    }
    section += (number || 1) * unit;
    number = 0;
  }

  return total + section + number;
}

function parseChineseAmount(value: string) {
  const [integerPart, decimalPart] = value.split("点");
  const integerValue = parseChineseInteger(integerPart);
  if (integerValue === null) return "";
  if (!decimalPart) return String(integerValue);

  const decimalDigits = Array.from(decimalPart)
    .map((char) => chineseDigitValues[char])
    .filter((digit) => digit !== undefined)
    .join("");
  return decimalDigits ? `${integerValue}.${decimalDigits}` : String(integerValue);
}

function extractAmount(text: string) {
  const match =
    text.match(/(?:¥|￥|€|\$|£)?\s*(\d+(?:[.,]\d+)?)\s*(?:欧元|欧|美元|美金|英镑|日元|人民币|元|块|纽币|新西兰元|澳元|丹麦克朗|eur|usd|gbp|jpy|cny|rmb|nzd|aud|dkk)?/i) ??
    null;
  if (match?.[1]) return match[1].replace(",", ".");

  const chineseMatch = text.match(
    /((?:零|一|二|两|三|四|五|六|七|八|九|十|百|千|万)+(?:点(?:零|一|二|两|三|四|五|六|七|八|九)+)?)\s*(?:欧元|欧|美元|美金|英镑|日元|人民币|元|块|纽币|新西兰元|澳元|丹麦克朗)/i,
  );
  return chineseMatch?.[1] ? parseChineseAmount(chineseMatch[1]) : "";
}

function cleanExpenseTitle(text: string) {
  return (
    text
      .replace(/(?:新增|添加|加一个|花了|花费|消费|支付|付了|付|支出|账单|记一笔|记录|录入)/g, "")
      .replace(/(?:¥|￥|€|\$|£)?\s*\d+(?:[.,]\d+)?\s*(?:欧元|欧|美元|美金|英镑|日元|人民币|元|块|纽币|新西兰元|澳元|丹麦克朗|eur|usd|gbp|jpy|cny|rmb|nzd|aud|dkk)?/gi, "")
      .replace(/(?:一共|总共|总计)/g, "")
      .replace(/(?:零|一|二|两|三|四|五|六|七|八|九|十|百|千|万)+(?:点(?:零|一|二|两|三|四|五|六|七|八|九)+)?\s*(?:欧元|欧|美元|美金|英镑|日元|人民币|元|块|纽币|新西兰元|澳元|丹麦克朗)/gi, "")
      .trim() || "费用支出"
  );
}

function navigationTarget(text: string) {
  const match =
    text.match(/(?:导航去|导航到|带我去|打开地图去|地图搜|地图搜索)\s*(.+)$/i) ??
    text.match(/(?:打开地图|导航|地图)\s*[:：]?\s*(.+)?$/i);
  const target = normalizeText(match?.[1] ?? "");
  if (!target || /^(一下|吧|看看)?$/.test(target)) return "";
  return target;
}

function inferPlannerEventType(text: string) {
  if (/酒店|住宿|hotel/i.test(text)) return "hotel";
  if (/航班|机票|flight/i.test(text)) return "flight";
  if (/午饭|晚饭|早餐|餐厅|饭|meal|restaurant/i.test(text)) return "meal";
  if (/车|船|交通|地铁|公交|transport|ferry/i.test(text)) return "transport";
  return "activity";
}

function inferReservationType(text: string) {
  if (/酒店|住宿|hotel/i.test(text)) return "hotel";
  if (/机票|航班|飞机|flight/i.test(text)) return "flight";
  if (/船票|渡轮|ferry|门票|ticket/i.test(text)) return "reservation";
  return undefined;
}

function classifyLayer1(text: string): Layer1Result {
  const commandRule = firstMatchingRule(text, commandBehaviorRules);
  if (commandRule) return { layer1: "command", rule: commandRule };

  const questionRule = firstMatchingRule(text, questionBehaviorRules);
  if (questionRule) return { layer1: "question", rule: questionRule };

  const sentenceShapeRule = firstMatchingRule(text, sentenceShapeRules);
  if (sentenceShapeRule) return { layer1: "command", rule: sentenceShapeRule };

  const recordRule = firstMatchingRule(text, recordSignalRules);
  if (recordRule) return { layer1: "record", rule: recordRule };

  return { layer1: "unknown" };
}

function routeQuestion(text: string, layer1: Layer1Result): Capture2SafeClassification {
  const targetRule = firstMatchingRule(text, queryTargetRules);
  const confidence = Math.max(layer1.rule?.confidence ?? 0.86, targetRule?.confidence ?? 0.84);
  return {
    intent: "journey_query",
    confidence,
    reason: `${layer1.rule?.reason ?? "Question detected."} ${
      targetRule?.reason ?? "Question routed to Journey context."
    }`.trim(),
    action: "answer_query",
    extracted: {
      title: text,
      layer1: "question",
      target: targetRule?.target ?? "journey",
      ruleId: targetRule?.id ?? layer1.rule?.id,
    },
  };
}

function routeCommand(text: string, layer1: Layer1Result): Capture2SafeClassification {
  const target = layer1.rule?.target ?? "unknown";
  if (target === "navigation") {
    const targetName = navigationTarget(text);
    return {
      intent: "navigation",
      confidence: layer1.rule?.confidence ?? 0.9,
      reason: layer1.rule?.reason ?? "Navigation command matched.",
      action: "open_map",
      extracted: {
        rawTarget: targetName || text,
        locationName: targetName,
        layer1: "command",
        target,
        ruleId: layer1.rule?.id,
      },
    };
  }

  if (target === "ledger") {
    return {
      intent: "expense",
      confidence: layer1.rule?.confidence ?? 0.88,
      reason: layer1.rule?.reason ?? "Expense command matched.",
      action: "open_expense_form",
      extracted: {
        title: cleanExpenseTitle(text),
        amount: extractAmount(text),
        currency: firstCurrency(text),
        category: firstExpenseCategory(text),
        layer1: "command",
        target,
        ruleId: layer1.rule?.id,
      },
    };
  }

  if (target === "planner") {
    return {
      intent: "planner",
      confidence: layer1.rule?.confidence ?? 0.84,
      reason: layer1.rule?.reason ?? "Planner command matched.",
      action: "open_planner_form",
      extracted: {
        title: text,
        eventType: inferPlannerEventType(text),
        reservationType: inferReservationType(text),
        layer1: "command",
        target,
        ruleId: layer1.rule?.id,
      },
    };
  }

  if (target === "planner_page") {
    return {
      intent: "planner",
      confidence: layer1.rule?.confidence ?? 0.82,
      reason: layer1.rule?.reason ?? "Open Planner command matched.",
      action: "open_planner_page",
      extracted: {
        title: text,
        layer1: "command",
        target,
        ruleId: layer1.rule?.id,
      },
    };
  }

  if (target === "ledger_page") {
    return {
      intent: "expense",
      confidence: layer1.rule?.confidence ?? 0.82,
      reason: layer1.rule?.reason ?? "Open Ledger command matched.",
      action: "open_ledger_page",
      extracted: {
        title: text,
        layer1: "command",
        target,
        ruleId: layer1.rule?.id,
      },
    };
  }

  return {
    intent: "deferred",
    confidence: layer1.rule?.confidence ?? 0.55,
    reason: layer1.rule?.reason ?? "Command is not safe to execute automatically.",
    action: "defer",
    extracted: {
      title: text,
      layer1: "command",
      target,
      ruleId: layer1.rule?.id,
    },
  };
}

export function classifyCapture2SafeIntent(input: string): Capture2SafeClassification {
  const text = normalizeText(input);
  if (!text) {
    return {
      intent: "deferred",
      confidence: 0,
      reason: "Empty input.",
      action: "defer",
      extracted: {},
    };
  }

  const layer1 = classifyLayer1(text);
  if (layer1.layer1 === "question") return routeQuestion(text, layer1);
  if (layer1.layer1 === "command") return routeCommand(text, layer1);

  if (layer1.layer1 === "record") {
    return {
      intent: "deferred",
      confidence: layer1.rule?.confidence ?? 0.6,
      reason: layer1.rule?.reason ?? "Record-like input deferred by Safe Mode.",
      action: "defer",
      extracted: {
        title: text,
        layer1: "record",
        target: "unknown",
        ruleId: layer1.rule?.id,
      },
    };
  }

  return {
    intent: "deferred",
    confidence: 0.45,
    reason: "Safe Mode default.",
    action: "defer",
    extracted: {
      layer1: "unknown",
      target: "unknown",
    },
  };
}
