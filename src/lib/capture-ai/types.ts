export type CaptureIntentKey =
  | "memory"
  | "planner_update"
  | "expense"
  | "navigation"
  | "assistant";

export type CaptureInputType = "text" | "voice" | "image" | "attachment";

export type CaptureEngineEntryPoint =
  | "global_capture"
  | "planner_item_memory"
  | "day_planner_add"
  | "planner_import"
  | "ledger_add"
  | "map_search"
  | "assistant_chat"
  | string;

export type CaptureIntentBias = CaptureIntentKey | "planner_import" | string;

export type CaptureEngineOptions = {
  entryPoint?: CaptureEngineEntryPoint;
  intentBias?: CaptureIntentBias;
  intentLock?: CaptureIntentKey;
  mode?: "single_action" | "bulk_parse" | "chat";
  lockedContext?: Record<string, unknown>;
};

export type CaptureIntentRule = {
  id?: string;
  intentKey: CaptureIntentKey;
  displayName: string;
  description: string;
  enabled: boolean;
  confidenceThreshold: number;
  autoExecute: boolean;
  requiresConfirmation: boolean;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type CapturePromptTemplate = {
  id?: string;
  templateKey:
    | "intent_detection"
    | "planner"
    | "expense"
    | "memory"
    | "navigation"
    | "assistant"
    | "clarification";
  displayName: string;
  prompt: string;
  metadata: Record<string, unknown>;
};

export type CaptureIntentConfig = {
  rules: CaptureIntentRule[];
  prompts: CapturePromptTemplate[];
  routing: CaptureRoutingConfig;
};

export type CaptureRoutingConfig = {
  enableLocalParser: boolean;
  enableLocalIntentEngine: boolean;
  enableLlmRouter: boolean;
  localConfidenceThreshold: number;
  complexityThreshold: number;
  forceAllRequestsToLlm: boolean;
  forceLocalOnly: boolean;
  metadata: Record<string, unknown>;
};

export type CaptureLocalPreparseResult = {
  amount?: number;
  amountText?: string;
  currency?: string;
  dateHints: string[];
  timeHints: string[];
  durationHints: string[];
  keywords: string[];
  possibleActions: CaptureIntentKey[];
  sentenceCount: number;
  hasImage: boolean;
  hasAttachment: boolean;
};

export type CaptureComplexityResult = {
  score: number;
  reasons: string[];
  shouldUseLlm: boolean;
};

export type CaptureRoutingResult = {
  source: "local" | "llm" | "fallback";
  provider: string;
  model: string;
  preparse: CaptureLocalPreparseResult;
  complexity: CaptureComplexityResult;
  localCandidate?: {
    intent?: CaptureIntentKey;
    confidence?: number;
  };
  engineOptions?: CaptureEngineOptions;
  providerErrors?: string[];
};

export type CaptureActionGraphNode = {
  id: string;
  intent: CaptureIntentKey;
  type: string;
  icon?: string;
  title: string;
  summary: string;
  details: {
    label: string;
    value: string;
    source?: CaptureFieldSource;
    evidence?: string;
  }[];
  facts?: CaptureActionFieldFact[];
  mandatoryMissing: string[];
  optionalMissing: string[];
  payload: Record<string, unknown>;
};

export type CaptureFieldSource = "explicit" | "default" | "inferred";

export type CaptureActionFieldFact = {
  key: string;
  label: string;
  value: string;
  source: CaptureFieldSource;
  evidence?: string;
};

export type CaptureActionGraphRelation = {
  from: string;
  to: string;
  type: string;
  label: string;
};

export type CaptureActionGraph = {
  nodes: CaptureActionGraphNode[];
  relations: CaptureActionGraphRelation[];
};

export type CaptureIntentDetection = {
  intent: CaptureIntentKey;
  confidence: number;
  entities: Record<string, unknown>;
  actionGraph: CaptureActionGraph;
  missingInformation: string[];
  clarificationQuestions: {
    id: string;
    question: string;
    options?: string[];
  }[];
  reason: string;
  proposedAction: {
    type: string;
    label: string;
    description: string;
    payload?: Record<string, unknown>;
  };
  requiresConfirmation: boolean;
  needsClarification: boolean;
  interactionLevel: "auto_execute" | "clarification" | "full_form" | "confirm";
  shouldAutoExecute: boolean;
  fallbackToMemory: boolean;
  provider: string;
  model: string;
  routing?: CaptureRoutingResult;
  rawResponse?: unknown;
};

export type CaptureSessionState = {
  id: string;
  status: "idle" | "collecting_fields" | "ready_to_confirm" | "completed";
  currentIntent?: CaptureIntentKey;
  currentFields: Record<string, unknown>;
  missingFields: string[];
  lastQuestion?: {
    field: string;
    question: string;
  };
  pendingChoices?: {
    type: string;
    options: unknown[];
  };
  targetObject?: Record<string, unknown>;
  actionGraph?: CaptureActionGraph;
  confidence?: number;
  completedActions: {
    intent: CaptureIntentKey;
    actionGraph: CaptureActionGraph;
    completedAt: string;
  }[];
};

export type CaptureIntentTestInput = {
  tripId?: string;
  text: string;
  inputTypes?: CaptureInputType[];
  engineOptions?: CaptureEngineOptions;
  sessionContext?: CaptureSessionState;
  exampleOnly?: boolean;
};
