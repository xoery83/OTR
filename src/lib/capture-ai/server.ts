import type {
  CaptureActionGraph,
  CaptureActionFieldFact,
  CaptureActionGraphNode,
  CaptureComplexityResult,
  CaptureEngineOptions,
  CaptureIntentConfig,
  CaptureIntentDetection,
  CaptureIntentKey,
  CaptureIntentRule,
  CaptureLocalPreparseResult,
  CaptureRoutingResult,
} from "./types";

type AiProviderConfig = {
  name: "openai" | "deepseek";
  apiKey: string;
  endpoint: string;
  model: string;
  responseFormat: { type: "json_object" };
};

const defaultRules: CaptureIntentRule[] = [
  {
    intentKey: "memory",
    displayName: "Memory",
    description: "Default fallback for travel notes, photos, and moments.",
    enabled: true,
    confidenceThreshold: 0.7,
    autoExecute: true,
    requiresConfirmation: false,
    sortOrder: 10,
    metadata: {},
  },
  {
    intentKey: "planner_update",
    displayName: "Planner",
    description: "Create or modify travel plans.",
    enabled: true,
    confidenceThreshold: 0.82,
    autoExecute: false,
    requiresConfirmation: true,
    sortOrder: 20,
    metadata: {},
  },
  {
    intentKey: "expense",
    displayName: "Expense",
    description: "Create travel expenses.",
    enabled: true,
    confidenceThreshold: 0.82,
    autoExecute: false,
    requiresConfirmation: true,
    sortOrder: 30,
    metadata: {},
  },
  {
    intentKey: "navigation",
    displayName: "Navigation",
    description: "Open map, place search, or route-oriented actions.",
    enabled: true,
    confidenceThreshold: 0.8,
    autoExecute: true,
    requiresConfirmation: false,
    sortOrder: 40,
    metadata: {},
  },
  {
    intentKey: "assistant",
    displayName: "AI Assistant",
    description: "Answer travel questions inside Capture.",
    enabled: true,
    confidenceThreshold: 0.78,
    autoExecute: false,
    requiresConfirmation: false,
    sortOrder: 50,
    metadata: {},
  },
];

export function defaultCaptureIntentConfig(): CaptureIntentConfig {
  return {
    rules: defaultRules,
    routing: {
      enableLocalParser: true,
      enableLocalIntentEngine: true,
      enableLlmRouter: true,
      localConfidenceThreshold: 0.82,
      complexityThreshold: 0.55,
      forceAllRequestsToLlm: false,
      forceLocalOnly: false,
      metadata: {},
    },
    prompts: [
      {
        templateKey: "intent_detection",
        displayName: "Capture Intent Detection Prompt",
        prompt:
          "Classify the user capture into one primary intent: memory, planner_update, expense, navigation, assistant. Also produce an actionGraph that may contain multiple related actions from one capture, such as hotel stay plus linked accommodation expense. Return strict JSON with intent, confidence from 0 to 1, entities, actionGraph, missingInformation, clarificationQuestions, reason, and proposedAction. Put only execution-blocking fields in missingInformation; put optional fields in actionGraph node optionalMissing. Pick memory if uncertain.",
        metadata: {},
      },
      {
        templateKey: "planner",
        displayName: "Planner Prompt",
        prompt:
          "Extract planner create/update information: action, title, date, time, location, target item, and whether confirmation is required.",
        metadata: {},
      },
      {
        templateKey: "expense",
        displayName: "Expense Prompt",
        prompt:
          "Extract amount, currency, merchant, timestamp, category, payer, and split members. Ask for missing payer, split members, or category.",
        metadata: {},
      },
      {
        templateKey: "memory",
        displayName: "Memory Prompt",
        prompt:
          "Create a concise travel memory with timestamp, day, GPS if available, photos, and people if available.",
        metadata: {},
      },
      {
        templateKey: "navigation",
        displayName: "Navigation Prompt",
        prompt:
          "Extract map action, place query, route request, destination, and current context.",
        metadata: {},
      },
      {
        templateKey: "assistant",
        displayName: "AI Assistant Prompt",
        prompt: "Answer or prepare the travel assistant task without database writes.",
        metadata: {},
      },
      {
        templateKey: "clarification",
        displayName: "Clarification Prompt",
        prompt:
          "When intent is understood but required information is missing, ask one concise conversational question at a time. Prefer selectable options when possible. Avoid opening full forms unless the user asks for More Details or the object is structurally complex.",
        metadata: {},
      },
    ],
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

function parseModelJson(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fencedMatch ? fencedMatch[1] : trimmed) as Partial<CaptureIntentDetection>;
}

function ruleForIntent(config: CaptureIntentConfig, intent: CaptureIntentKey) {
  return (
    config.rules.find((rule) => rule.intentKey === intent) ??
    defaultRules.find((rule) => rule.intentKey === intent)!
  );
}

function normalizeActionNode(
  value: unknown,
  index: number,
  fallbackIntent: CaptureIntentKey,
): CaptureActionGraphNode | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const details = Array.isArray(record.details)
    ? record.details
        .map((detail) => {
          if (!detail || typeof detail !== "object") return null;
          const detailRecord = detail as Record<string, unknown>;
          const source =
            detailRecord.source === "explicit" ||
            detailRecord.source === "default" ||
            detailRecord.source === "inferred"
              ? detailRecord.source
              : undefined;
          const evidence = detailRecord.evidence
            ? String(detailRecord.evidence)
            : undefined;
          return {
            label: String(detailRecord.label || ""),
            value: String(detailRecord.value || ""),
            ...(source ? { source } : {}),
            ...(evidence ? { evidence } : {}),
          };
        })
        .filter((detail): detail is CaptureActionGraphNode["details"][number] =>
          Boolean(detail?.label && detail.value),
        )
    : [];
  const facts = Array.isArray(record.facts)
    ? record.facts
        .map((fact) => {
          if (!fact || typeof fact !== "object") return null;
          const factRecord = fact as Record<string, unknown>;
          const source = factRecord.source;
          if (
            source !== "explicit" &&
            source !== "default" &&
            source !== "inferred"
          ) {
            return null;
          }
          return {
            key: String(factRecord.key || ""),
            label: String(factRecord.label || ""),
            value: String(factRecord.value || ""),
            source,
            ...(factRecord.evidence
              ? { evidence: String(factRecord.evidence) }
              : {}),
          };
        })
        .filter((fact): fact is CaptureActionFieldFact =>
          Boolean(fact?.key && fact.label && fact.value),
        )
    : [];

  return {
    id: String(record.id || `action_${index + 1}`),
    intent: (record.intent as CaptureIntentKey) || fallbackIntent,
    type: String(record.type || fallbackIntent),
    icon: record.icon ? String(record.icon) : undefined,
    title: String(record.title || record.label || "Capture action"),
    summary: String(record.summary || record.description || ""),
    details,
    facts,
    mandatoryMissing: Array.isArray(record.mandatoryMissing)
      ? record.mandatoryMissing.map(String).filter(Boolean)
      : [],
    optionalMissing: Array.isArray(record.optionalMissing)
      ? record.optionalMissing.map(String).filter(Boolean)
      : [],
    payload:
      record.payload && typeof record.payload === "object"
        ? (record.payload as Record<string, unknown>)
        : {},
  };
}

function actionGraphValidationWarnings(
  graph: CaptureActionGraph,
  routing?: CaptureRoutingResult,
) {
  const warnings: string[] = [];
  const hasExplicitDuration = (routing?.preparse.durationHints.length ?? 0) > 0;

  graph.nodes = graph.nodes.map((node) => {
    if (node.intent === "expense") {
      const payload = node.payload ?? {};
      const participantIds = Array.isArray(payload.participantMemberIds)
        ? payload.participantMemberIds.filter(Boolean)
        : [];
      const missing = new Set(node.mandatoryMissing);

      if (!payload.payerMemberId && !payload.payer) {
        missing.add("payer");
      }
      if (participantIds.length === 0 && !payload.splitMembers) {
        missing.add("splitMembers");
      }

      if (missing.size !== node.mandatoryMissing.length) {
        warnings.push(
          "Expense requires payer and split members before ledger execution.",
        );
      }

      return {
        ...node,
        mandatoryMissing: [...missing],
        optionalMissing: node.optionalMissing.filter(
          (item) => item !== "payer" && item !== "splitMembers",
        ),
      };
    }

    const isAccommodation =
      node.type.includes("hotel") || node.type.includes("accommodation");
    if (!isAccommodation) return node;

    const payload = { ...node.payload };
    const hasNights = payload.nights !== null && payload.nights !== undefined;
    if (!hasNights || hasExplicitDuration) return { ...node, payload };

    delete payload.nights;
    warnings.push(
      "Removed hotel stay duration because the user did not explicitly state nights or days.",
    );

    return {
      ...node,
      summary: node.summary
        .replace(/[，,]\s*住\s*\d+\s*晚/g, "")
        .replace(/\bfor\s+\d+\s+nights?\b/gi, "")
        .trim(),
      details: node.details.filter(
        (detail) => !/时长|晚数|duration|nights?/i.test(detail.label),
      ),
      facts: node.facts?.filter((fact) => fact.key !== "nights"),
      payload,
    };
  });

  return warnings;
}

function normalizeActionGraph(
  detection: Partial<CaptureIntentDetection>,
  intent: CaptureIntentKey,
  proposedAction: CaptureIntentDetection["proposedAction"],
): CaptureActionGraph {
  const graph = detection.actionGraph;
  const nodes = Array.isArray(graph?.nodes)
    ? graph.nodes
        .map((node, index) => normalizeActionNode(node, index, intent))
        .filter((node): node is CaptureActionGraphNode => Boolean(node))
    : [];
  const relations = Array.isArray(graph?.relations)
    ? graph.relations
        .map((relation) => {
          if (!relation || typeof relation !== "object") return null;
          const record = relation as Record<string, unknown>;
          return {
            from: String(record.from || ""),
            to: String(record.to || ""),
            type: String(record.type || "related_to"),
            label: String(record.label || "related to"),
          };
        })
        .filter((relation): relation is CaptureActionGraph["relations"][number] =>
          Boolean(relation?.from && relation.to),
        )
    : [];

  if (nodes.length > 0) {
    return { nodes, relations };
  }

  return {
    nodes: [
      {
        id: "action_1",
        intent,
        type: proposedAction.type,
        title: proposedAction.label,
        summary: proposedAction.description,
        details: [],
        mandatoryMissing: [],
        optionalMissing: [],
        payload: proposedAction.payload ?? {},
      },
    ],
    relations: [],
  };
}

function normalizeDetection(
  detection: Partial<CaptureIntentDetection>,
  config: CaptureIntentConfig,
  provider: string,
  model: string,
  routing?: CaptureRoutingResult,
  engineOptions?: CaptureEngineOptions,
): CaptureIntentDetection {
  const allowed = new Set<CaptureIntentKey>([
    "memory",
    "planner_update",
    "expense",
    "navigation",
    "assistant",
  ]);
  const incomingIntent = detection.intent;
  const detectedIntent =
    incomingIntent && allowed.has(incomingIntent) ? incomingIntent : "memory";
  const candidateIntent =
    engineOptions?.intentLock && allowed.has(engineOptions.intentLock)
      ? engineOptions.intentLock
      : detectedIntent;
  const candidateRule = ruleForIntent(config, candidateIntent);
  const confidence =
    typeof detection.confidence === "number"
      ? Math.max(0, Math.min(1, detection.confidence))
      : 0.5;
  const fallbackToMemory =
    !engineOptions?.intentLock &&
    (!candidateRule.enabled || confidence < candidateRule.confidenceThreshold);
  const intent = fallbackToMemory ? "memory" : candidateIntent;
  const rule = ruleForIntent(config, intent);
  const missingInformation = fallbackToMemory
    ? []
    : Array.isArray(detection.missingInformation)
      ? detection.missingInformation.map(String).filter(Boolean)
      : [];
  const clarificationQuestions = fallbackToMemory
    ? []
    : Array.isArray(detection.clarificationQuestions)
      ? detection.clarificationQuestions
          .map((question, index) => {
            if (!question || typeof question !== "object") return null;
            const record = question as Record<string, unknown>;
            const options = Array.isArray(record.options)
              ? record.options.map(String).filter(Boolean)
              : [];
            return {
              id: String(record.id || `question_${index + 1}`),
              question: String(record.question || ""),
              ...(options.length > 0 ? { options } : {}),
            };
          })
          .filter(
            (
              question,
            ): question is {
              id: string;
              question: string;
              options?: string[];
            } => Boolean(question?.question),
          )
      : [];
  const proposedAction =
    detection.proposedAction && typeof detection.proposedAction === "object"
      ? {
          type: String(detection.proposedAction.type || intent),
          label: String(detection.proposedAction.label || rule.displayName),
          description: String(
            detection.proposedAction.description || rule.description || "",
          ),
          payload:
            detection.proposedAction.payload &&
            typeof detection.proposedAction.payload === "object"
              ? detection.proposedAction.payload
              : {},
        }
      : {
          type: intent,
          label: rule.displayName,
          description: rule.description || "",
          payload: {},
      };
  const actionGraph = normalizeActionGraph(detection, intent, proposedAction);
  const validationWarnings = actionGraphValidationWarnings(actionGraph, routing);
  const graphMissingInformation = actionGraph.nodes.flatMap(
    (node) => node.mandatoryMissing,
  );
  const finalMissingInformation = fallbackToMemory
    ? []
    : [...new Set([...missingInformation, ...graphMissingInformation])];
  const existingQuestionIds = new Set(
    clarificationQuestions.map((question) => question.id),
  );
  const finalClarificationQuestions = fallbackToMemory
    ? []
    : [
        ...clarificationQuestions,
        ...(finalMissingInformation.includes("payer") &&
        !existingQuestionIds.has("payer")
          ? [{ id: "payer", question: "谁支付的？" }]
          : []),
        ...(finalMissingInformation.includes("splitMembers") &&
        !existingQuestionIds.has("splitMembers")
          ? [
              {
                id: "splitMembers",
                question: "这笔费用由谁分摊？",
                options: ["所有人", "只和部分成员分摊"],
              },
            ]
          : []),
      ];
  const finalNeedsClarification =
    !fallbackToMemory &&
    (finalMissingInformation.length > 0 ||
      finalClarificationQuestions.length > 0);
  const finalInteractionLevel = fallbackToMemory
    ? "auto_execute"
    : finalNeedsClarification
      ? "clarification"
      : rule.requiresConfirmation
        ? "confirm"
        : rule.autoExecute
          ? "auto_execute"
          : "confirm";

  return {
    intent,
    confidence: fallbackToMemory ? Math.min(confidence, rule.confidenceThreshold) : confidence,
    entities:
      detection.entities && typeof detection.entities === "object"
        ? {
            ...detection.entities,
            ...(validationWarnings.length > 0
              ? { validationWarnings }
              : {}),
          }
        : validationWarnings.length > 0
          ? { validationWarnings }
          : {},
    missingInformation: finalMissingInformation,
    clarificationQuestions: finalClarificationQuestions,
    reason:
      detection.reason ||
      (fallbackToMemory
        ? "Confidence was below threshold or intent is disabled; falling back to Memory."
        : "Matched capture intent."),
    proposedAction,
    actionGraph,
    requiresConfirmation: fallbackToMemory ? false : rule.requiresConfirmation,
    needsClarification: finalNeedsClarification,
    interactionLevel: finalInteractionLevel,
    shouldAutoExecute:
      finalInteractionLevel === "auto_execute",
    fallbackToMemory,
    provider,
    model,
    routing,
    rawResponse: detection.rawResponse,
  };
}

const currencyAliases: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "¥": "CNY",
  "￥": "CNY",
  usd: "USD",
  nzd: "NZD",
  eur: "EUR",
  isk: "ISK",
  dkk: "DKK",
  gbp: "GBP",
  rmb: "CNY",
  cny: "CNY",
  纽币: "NZD",
  新西兰元: "NZD",
  美元: "USD",
  欧元: "EUR",
  人民币: "CNY",
  冰岛克朗: "ISK",
};

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function normalizeCurrency(value: string | undefined) {
  if (!value) return undefined;
  return currencyAliases[value.toLocaleLowerCase()] ?? currencyAliases[value] ?? value.toUpperCase();
}

function localPreparse(
  text: string,
  inputTypes: string[] = ["text"],
): CaptureLocalPreparseResult {
  const lower = text.toLocaleLowerCase();
  const amountMatch = text.match(
    /([¥￥€$]|isk|dkk|nzd|usd|eur|gbp|rmb|cny)?\s*(\d+(?:[,.]\d{1,2})?)\s*(isk|dkk|nzd|usd|eur|gbp|rmb|cny|冰岛克朗|纽币|人民币|美元|欧元)?/i,
  );
  const keywordPatterns: [string, RegExp][] = [
    ["hotel", /hotel|住宿|入住|accommodation|airbnb|酒店|旅馆|民宿/],
    ["fuel", /fuel|gas|petrol|加油|汽油|油费/],
    ["parking", /parking|停车/],
    ["restaurant", /restaurant|dinner|lunch|coffee|餐厅|晚餐|午餐|吃饭|咖啡/],
    ["navigate", /navigate|route|map|导航|路线|地图/],
    ["nearby", /nearest|nearby|附近|最近/],
    ["toilet", /toilet|bathroom|厕所|洗手间/],
    ["planner", /planner|schedule|plan|leave|arrive|tomorrow|tonight|日程|计划|出发|抵达|明天|今晚/],
    ["question", /[?？]|what|why|how|是什么|为什么|怎么/],
    ["writing", /summarize|summary|caption|diary|write|总结|日记|文案|写/],
  ];
  const keywords = keywordPatterns
    .filter(([, pattern]) => pattern.test(lower))
    .map(([keyword]) => keyword);
  const possibleActions: CaptureIntentKey[] = [];
  if (keywords.some((keyword) => ["fuel", "parking", "restaurant"].includes(keyword)) || amountMatch) {
    possibleActions.push("expense");
  }
  if (keywords.includes("hotel") || keywords.includes("planner")) {
    possibleActions.push("planner_update");
  }
  if (keywords.some((keyword) => ["navigate", "nearby", "toilet"].includes(keyword))) {
    possibleActions.push("navigation");
  }
  if (keywords.some((keyword) => ["question", "writing"].includes(keyword))) {
    possibleActions.push("assistant");
  }
  if (possibleActions.length === 0) {
    possibleActions.push("memory");
  }

  return {
    amount: amountMatch ? Number(amountMatch[2].replace(",", "")) : undefined,
    amountText: amountMatch?.[2],
    currency: normalizeCurrency(amountMatch?.[1] || amountMatch?.[3]),
    dateHints: unique(
      [...text.matchAll(/today|tomorrow|tonight|next\s+\w+|今天|明天|今晚|后天/gim)].map(
        (match) => match[0],
      ),
    ),
    timeHints: unique(
      [...text.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b|上午|下午|晚上|早上|中午|morning|afternoon|evening|night/gim)].map(
        (match) => match[0],
      ),
    ),
    durationHints: unique(
      [...text.matchAll(/(?:\d+|一|两|二|三|四|五)\s*(?:晚|天|nights?|days?)/gim)].map(
        (match) => match[0],
      ),
    ),
    keywords,
    possibleActions: unique(possibleActions),
    sentenceCount: text.split(/[。！？.!?]+/).filter((sentence) => sentence.trim()).length || 1,
    hasImage: inputTypes.includes("image"),
    hasAttachment: inputTypes.includes("attachment") || inputTypes.includes("file"),
  };
}

function wordNumber(value: string | undefined) {
  if (!value) return undefined;
  if (value === "两" || value === "二") return 2;
  const map: Record<string, number> = { 一: 1, 三: 3, 四: 4, 五: 5 };
  return map[value] ?? Number(value);
}

function localIntentEngine(
  text: string,
  preparse: CaptureLocalPreparseResult,
  engineOptions?: CaptureEngineOptions,
): Partial<CaptureIntentDetection> {
  const lower = text.toLocaleLowerCase();
  const amountText = preparse.amountText;
  const currency = preparse.currency || "NZD";
  const isAccommodation = /hotel|住宿|入住|住|accommodation|airbnb|酒店|旅馆|民宿/.test(lower);
  const nightsMatch = text.match(/(\d+|一|两|二|三|四|五)\s*(?:晚|天|nights?)/i);
  const nights = wordNumber(nightsMatch?.[1]);
  const skyTowerMatch = /sky\s*tower|skytower|天空塔/i.test(text);
  const lockedIntent = engineOptions?.intentLock;
  const biasedIntent = engineOptions?.intentBias;

  if (lockedIntent === "memory" || biasedIntent === "memory") {
    const hasExplicitExtraIntent =
      preparse.possibleActions.some((intent) => intent !== "memory") &&
      /顺便|also|and|并且|另外|费用|花了|改到|取消|导航|route|navigate/i.test(text);
    if (lockedIntent === "memory" || !hasExplicitExtraIntent) {
      return {
        intent: "memory",
        confidence: lockedIntent === "memory" ? 0.98 : 0.9,
        entities: {
          preparse,
          lockedContext: engineOptions?.lockedContext ?? {},
        },
        missingInformation: [],
        clarificationQuestions: [],
        reason: lockedIntent
          ? "Entry point locked this capture to Memory."
          : "Entry point biased this capture toward Memory and no explicit extra action was found.",
        proposedAction: {
          type: "create_memory",
          label: "Create Memory",
          description: "Save this capture as a journey memory using the locked context.",
        },
      };
    }
  }

  if (lockedIntent === "planner_update" || biasedIntent === "planner_update") {
    const hasExplicitExpense = preparse.possibleActions.includes("expense");
    const hasExplicitNavigation = preparse.possibleActions.includes("navigation");
    if (lockedIntent === "planner_update" || (!hasExplicitExpense && !hasExplicitNavigation)) {
      return {
        intent: "planner_update",
        confidence: lockedIntent === "planner_update" ? 0.98 : 0.9,
        entities: {
          preparse,
          sourceText: text,
          lockedContext: engineOptions?.lockedContext ?? {},
        },
        missingInformation: [],
        clarificationQuestions: [],
        reason: lockedIntent
          ? "Entry point locked this capture to Planner."
          : "Entry point biased this capture toward Planner.",
        proposedAction: {
          type: "planner_update",
          label: "Update Planner",
          description: "Create or update a planner item using the locked context.",
        },
      };
    }
  }

  if (isAccommodation && amountText) {
    const nightsText = nights ? String(nights) : "";
    const tonightMatch = text.match(/今晚|tonight/i)?.[0];
    const locationEvidence = skyTowerMatch
      ? text.match(/sky\s*tower|skytower|天空塔/i)?.[0]
      : undefined;
    const staySummaryParts = [
      /今晚|tonight/i.test(text) ? "今晚入住" : "新增住宿",
      skyTowerMatch ? "Sky Tower 附近" : "住宿区域",
      nightsText ? `住${nightsText}晚` : "",
    ].filter(Boolean);
    return {
      intent: "planner_update",
      confidence: 0.86,
      entities: {
        preparse,
        accommodation: {
          area: skyTowerMatch ? "Sky Tower area" : null,
          date: /今晚|tonight/i.test(text) ? "tonight" : null,
          nights: nights ?? null,
        },
        expense: {
          amount: amountText,
          currency,
          category: "accommodation",
        },
      },
      missingInformation: [],
      clarificationQuestions: [],
      reason:
        "Detected an accommodation plan with a related accommodation cost; primary action is planner update with linked expense.",
      proposedAction: {
        type: "action_graph",
        label: "Create accommodation plan and linked expense",
        description: "Add a hotel stay and link the estimated accommodation cost.",
      },
      actionGraph: {
        nodes: [
          {
            id: "hotel_stay",
            intent: "planner_update",
            type: "hotel_stay",
            icon: "🏨",
            title: "新增住宿",
            summary: staySummaryParts.join("，"),
            details: [
              {
                label: "入住",
                value: /今晚|tonight/i.test(text) ? "今晚" : "待确认",
                source: /今晚|tonight/i.test(text) ? "explicit" : "default",
                evidence: tonightMatch,
              },
              {
                label: "地点",
                value: skyTowerMatch ? "Sky Tower附近" : "住宿区域",
                source: skyTowerMatch ? "explicit" : "default",
                evidence: locationEvidence,
              },
              ...(nightsText
                ? [
                    {
                      label: "时长",
                      value: `${nightsText}晚`,
                      source: "explicit" as const,
                      evidence: nightsMatch?.[0],
                    },
                  ]
                : []),
            ],
            facts: [
              {
                key: "checkInDate",
                label: "入住",
                value: /今晚|tonight/i.test(text) ? "今晚" : "待确认",
                source: /今晚|tonight/i.test(text) ? "explicit" : "default",
                evidence: tonightMatch,
              },
              {
                key: "location",
                label: "地点",
                value: skyTowerMatch ? "Sky Tower附近" : "住宿区域",
                source: skyTowerMatch ? "explicit" : "default",
                evidence: locationEvidence,
              },
              ...(nightsText
                ? [
                    {
                      key: "nights",
                      label: "时长",
                      value: `${nightsText}晚`,
                      source: "explicit" as const,
                      evidence: nightsMatch?.[0],
                    },
                  ]
                : []),
            ],
            mandatoryMissing: [],
            optionalMissing: ["hotelName", "bookingReference", "participants"],
            payload: {
              date: /今晚|tonight/i.test(text) ? "tonight" : null,
              area: skyTowerMatch ? "Sky Tower area" : null,
              nights: nights ?? null,
            },
          },
          {
            id: "accommodation_expense",
            intent: "expense",
            type: "accommodation_expense",
            icon: "💰",
            title: "记录住宿费用",
            summary: `约${amountText} ${currency}`,
            details: [
              {
                label: "金额",
                value: `约${amountText} ${currency}`,
                source: "explicit",
                evidence: amountText,
              },
              { label: "类别", value: "住宿", source: "explicit", evidence: "住宿" },
            ],
            facts: [
              {
                key: "amount",
                label: "金额",
                value: `约${amountText} ${currency}`,
                source: "explicit",
                evidence: amountText,
              },
              {
                key: "category",
                label: "类别",
                value: "住宿",
                source: "explicit",
                evidence: "住宿",
              },
            ],
            mandatoryMissing: [],
            optionalMissing: ["payer", "splitMembers"],
            payload: {
              amount: amountText,
              currency,
              category: "accommodation",
            },
          },
        ],
        relations: [
          {
            from: "accommodation_expense",
            to: "hotel_stay",
            type: "belongs_to",
            label: "费用关联到住宿",
          },
        ],
      },
    };
  }

  if (
    amountText &&
    /fuel|gas|parking|dinner|lunch|hotel|receipt|invoice|paid|cost|费用|花了|付款|停车|油|加油|晚餐|午餐|发票|收据/.test(
      lower,
    )
  ) {
    return {
      intent: "expense",
      confidence: 0.9,
      entities: {
        preparse,
        amount: amountText,
        currency: preparse.currency ?? null,
      },
      missingInformation: [
        ...(!preparse.currency ? ["currency"] : []),
        "payer",
        "splitMembers",
        "category",
      ],
      clarificationQuestions: [
        { id: "payer", question: "Who paid?" },
        {
          id: "splitMembers",
          question: "Should everyone share this expense?",
          options: ["Yes", "No"],
        },
      ],
      reason: "Detected amount and expense-related words.",
      proposedAction: {
        type: "create_expense",
        label: "Create expense",
        description: "Review payer, split members, category, and amount.",
      },
    };
  }

  if (/navigate|nearest|nearby|route|map|find|open map|导航|附近|最近|路线|地图|厕所|超市/.test(lower)) {
    return {
      intent: "navigation",
      confidence: 0.86,
      entities: { preparse, query: text },
      missingInformation: /hotel|住宿|酒店/.test(lower) ? ["destination"] : [],
      clarificationQuestions: /hotel|住宿|酒店/.test(lower)
        ? [{ id: "destination", question: "Which hotel?" }]
        : [],
      reason: "Detected map, navigation, or place-search language.",
      proposedAction: {
        type: "open_map",
        label: "Open Map",
        description: "Open map and carry this query forward.",
      },
    };
  }

  if (/[?？]|what|why|how|weather|caption|diary|summarize|help me|是什么|为什么|天气|总结|日记|文案/.test(lower)) {
    return {
      intent: "assistant",
      confidence: 0.84,
      entities: { preparse, question: text },
      missingInformation: [],
      clarificationQuestions: [],
      reason: "Detected a question or assistant task.",
      proposedAction: {
        type: "assistant_reply",
        label: "Ask AI Assistant",
        description: "Keep the conversation inside Capture.",
      },
    };
  }

  if (/tomorrow|tonight|leave|arrive|cancel|move|add a stop|schedule|plan|明天|今晚|出发|抵达|取消|改到|挪到|添加|加一个|日程|集合/.test(lower)) {
    return {
      intent: "planner_update",
      confidence: 0.88,
      entities: { preparse, sourceText: text },
      missingInformation: /change|move|cancel|改|挪|取消/.test(lower)
        ? ["targetPlannerItem"]
        : [],
      clarificationQuestions: /change|move|cancel|改|挪|取消/.test(lower)
        ? [{ id: "targetPlannerItem", question: "Which plan would you like to modify?" }]
        : [],
      reason: "Detected planner create/update language.",
      proposedAction: {
        type: "planner_update",
        label: "Update Planner",
        description: "Review the planner change before saving.",
      },
    };
  }

  return {
    intent: "memory",
    confidence: 0.76,
    entities: { preparse },
    missingInformation: [],
    clarificationQuestions: [],
    reason: "No stronger intent was detected.",
    proposedAction: {
      type: "create_memory",
      label: "Create Memory",
      description: "Save this capture as a journey memory.",
    },
  };
}

function evaluateComplexity(input: {
  text: string;
  preparse: CaptureLocalPreparseResult;
  localCandidate?: Partial<CaptureIntentDetection>;
  config: CaptureIntentConfig;
  context?: Record<string, unknown>;
}): CaptureComplexityResult {
  const { text, preparse, localCandidate, config, context } = input;
  const reasons: string[] = [];
  let score = 0;

  if (config.routing.forceAllRequestsToLlm) {
    return {
      score: 1,
      reasons: ["Debug setting forces every request to LLM."],
      shouldUseLlm: true,
    };
  }
  if (config.routing.forceLocalOnly) {
    return {
      score: 0,
      reasons: ["Debug setting forces local-only routing."],
      shouldUseLlm: false,
    };
  }

  if (preparse.hasImage) {
    score += 0.6;
    reasons.push("Image input requires vision-aware routing.");
  }
  if (preparse.hasAttachment) {
    score += 0.65;
    reasons.push("Attachment input requires document-aware routing.");
  }
  if (preparse.sentenceCount > 1) {
    score += 0.25;
    reasons.push("Capture has multiple sentences.");
  }
  if (preparse.possibleActions.length > 1) {
    score += 0.35;
    reasons.push("Capture may contain multiple actions.");
  }
  if (/instead|but|however|because|change|move|cancel|不是|改成|但是|不过|因为|取消|挪到/.test(text.toLocaleLowerCase())) {
    score += 0.3;
    reasons.push("Capture may modify or conflict with existing plans.");
  }
  if (/summarize|summary|caption|diary|write|recommend|weather|总结|日记|文案|推荐|天气|写/.test(text.toLocaleLowerCase())) {
    score += 0.5;
    reasons.push("Capture asks for writing, summary, recommendation, or reasoning.");
  }
  if (/which|哪个|哪一个|酒店|hotel|route|today'?s route|今天路线/.test(text.toLocaleLowerCase()) && context && Object.keys(context).length > 0) {
    score += 0.25;
    reasons.push("Capture likely needs Journey context or itinerary lookup.");
  }
  if (
    typeof localCandidate?.confidence === "number" &&
    localCandidate.confidence < config.routing.localConfidenceThreshold
  ) {
    score += 0.4;
    reasons.push("Local confidence is below the configured threshold.");
  }

  const normalizedScore = Math.max(0, Math.min(1, score));
  return {
    score: normalizedScore,
    reasons,
    shouldUseLlm: normalizedScore >= config.routing.complexityThreshold,
  };
}

export async function detectCaptureIntentOnServer(input: {
  text: string;
  inputTypes?: string[];
  config: CaptureIntentConfig;
  context?: Record<string, unknown>;
  engineOptions?: CaptureEngineOptions;
}) {
  const text = input.text.trim();
  const inputTypes = input.inputTypes ?? ["text"];
  const emptyPreparse: CaptureLocalPreparseResult = {
    dateHints: [],
    timeHints: [],
    durationHints: [],
    keywords: [],
    possibleActions: ["memory"],
    sentenceCount: 1,
    hasImage: inputTypes.includes("image"),
    hasAttachment: inputTypes.includes("attachment") || inputTypes.includes("file"),
  };
  const preparse = input.config.routing.enableLocalParser
    ? localPreparse(text, inputTypes)
    : emptyPreparse;
  const localCandidate = input.config.routing.enableLocalIntentEngine
    ? localIntentEngine(text, preparse, input.engineOptions)
    : undefined;
  const complexity = evaluateComplexity({
    text,
    preparse,
    localCandidate,
    config: input.config,
    context: input.context,
  });
  const localRouting: CaptureRoutingResult = {
    source: "local",
    provider: "local",
    model: "rules-v1",
    preparse,
    complexity,
    localCandidate: {
      intent: localCandidate?.intent,
      confidence: localCandidate?.confidence,
    },
    engineOptions: input.engineOptions,
  };

  if (
    localCandidate &&
    input.config.routing.enableLocalIntentEngine &&
    (!complexity.shouldUseLlm || input.config.routing.forceLocalOnly)
  ) {
    return normalizeDetection(
      {
        ...localCandidate,
        rawResponse: {
          route: "local_intent_engine",
          preparse,
          complexity,
        },
      },
      input.config,
      "local",
      "rules-v1",
      localRouting,
      input.engineOptions,
    );
  }

  if (
    !input.config.routing.enableLlmRouter ||
    input.config.routing.forceLocalOnly ||
    !complexity.shouldUseLlm
  ) {
    return normalizeDetection(
      {
        ...(localCandidate ?? {
          intent: "memory" as CaptureIntentKey,
          confidence: 0.74,
          entities: { preparse },
          missingInformation: [],
          clarificationQuestions: [],
          reason: "Local engine is disabled or LLM routing is unavailable; saved as Memory.",
          proposedAction: {
            type: "create_memory",
            label: "Create Memory",
            description: "Save this capture as a journey memory.",
          },
        }),
        rawResponse: {
          route: "local_fallback",
          preparse,
          complexity,
        },
      },
      input.config,
      "local",
      "rules-v1",
      { ...localRouting, source: "fallback" },
      input.engineOptions,
    );
  }

  const intentPrompt =
    input.config.prompts.find((prompt) => prompt.templateKey === "intent_detection")
      ?.prompt ?? defaultCaptureIntentConfig().prompts[0].prompt;
  const prompt = `${intentPrompt}

Supported intents:
- memory
- planner_update
- expense
- navigation
- assistant

Capture input types: ${(input.inputTypes ?? ["text"]).join(", ")}
Capture Engine options JSON: ${JSON.stringify(input.engineOptions ?? {})}
Context JSON: ${JSON.stringify(input.context ?? {})}
Local pre-parser JSON: ${JSON.stringify(preparse)}
Local candidate JSON: ${JSON.stringify(localCandidate ?? null)}
Complexity JSON: ${JSON.stringify(complexity)}
User capture:
${text}

Return JSON only. Shape:
{
  "intent": "memory|planner_update|expense|navigation|assistant",
  "confidence": 0.0,
  "entities": {},
  "actionGraph": {
    "nodes": [
      {
        "id": "stable_id",
        "intent": "planner_update|expense|memory|navigation|assistant",
        "type": "hotel_stay|accommodation_expense|...",
        "icon": "🏨",
        "title": "user-facing action title",
        "summary": "short natural language summary",
        "details": [{"label":"When","value":"Tonight","source":"explicit","evidence":"tonight"}],
        "facts": [{"key":"checkInDate","label":"When","value":"Tonight","source":"explicit|default|inferred","evidence":"exact user words when explicit"}],
        "mandatoryMissing": [],
        "optionalMissing": [],
        "payload": {}
      }
    ],
    "relations": [{"from":"node_id","to":"node_id","type":"belongs_to","label":"费用关联到住宿"}]
  },
  "missingInformation": [],
  "clarificationQuestions": [{"id":"","question":"","options":[]}],
  "reason": "",
  "proposedAction": {"type":"","label":"","description":"","payload":{}}
}

Field source policy:
- explicit: directly stated by the user; include evidence.
- default: safe system default; do not pretend the user said it.
- inferred: model guess or reasoning; normal UI will hide it unless confirmed.
- Do not put inferred/default values in summary as if they were user facts.
- For hotel stays, nights/check-out must be explicit; otherwise omit nights.`;

  const configs = getProviderConfigs();
  const errors: string[] = [];

  for (const provider of configs) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(provider.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You are OTR Capture Intent Engine. Return only valid compact JSON. Use entryPoint, intentBias, intentLock, and lockedContext to improve routing. intentBias is a preference, not a lock; still include additional actionGraph nodes when the user clearly asks for them. intentLock is strict. Do not ask for information already present in lockedContext. Pick one primary intent, but include an actionGraph with multiple nodes when one capture implies multiple related actions. Use mandatoryMissing only for fields required before execution; put nice-to-have fields in optionalMissing and do not ask about them. Never infer hotel stay duration; include nights or checkout date only when the user explicitly states it.",
            },
            { role: "user", content: prompt },
          ],
          response_format: provider.responseFormat,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await response.text();
      if (!response.ok) {
        errors.push(`${provider.name}: ${body.slice(0, 200)}`);
        continue;
      }
      const payload = JSON.parse(body) as {
        choices?: { message?: { content?: string | null } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        errors.push(`${provider.name}: empty response`);
        continue;
      }
      const parsed = parseModelJson(content);
      return normalizeDetection(
        { ...parsed, rawResponse: parsed },
        input.config,
        provider.name,
        provider.model,
        {
          source: "llm",
          provider: provider.name,
          model: provider.model,
          preparse,
          complexity,
          localCandidate: {
            intent: localCandidate?.intent,
            confidence: localCandidate?.confidence,
          },
          engineOptions: input.engineOptions,
        },
        input.engineOptions,
      );
    } catch (error) {
      errors.push(
        `${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return normalizeDetection(
    {
      ...(localCandidate ?? {
        intent: "memory" as CaptureIntentKey,
        confidence: 0.74,
        entities: { preparse },
        missingInformation: [],
        clarificationQuestions: [],
        reason: "LLM router failed and no local candidate was available; saved as Memory.",
        proposedAction: {
          type: "create_memory",
          label: "Create Memory",
          description: "Save this capture as a journey memory.",
        },
      }),
      rawResponse: {
        fallback: "local_after_llm_failure",
        providerErrors: errors,
        preparse,
        complexity,
      },
    },
    input.config,
    "local",
      "rules-v1",
    {
      ...localRouting,
      source: "fallback",
      providerErrors: errors,
    },
    input.engineOptions,
  );
}
