export type CaptureFixture = {
  id: string;
  lang: "zh" | "en" | string;
  category: string;
  description: string;
  input: string;
  initialState: CaptureStateInput;
  expected: CaptureExpectedResult;
};

export type CaptureFixtureLibrary = {
  version: string;
  name: string;
  description: string;
  importTarget: string;
  recommendedUse: string[];
  fixtures: CaptureFixture[];
};

export type CaptureStateInput = {
  intentType?: string;
  fields?: Record<string, unknown>;
  missingFields?: string[];
  lastQuestion?: {
    field?: string;
  };
  pendingChoice?: {
    type?: string;
    options?: unknown[];
  };
  [key: string]: unknown;
};

export type CaptureExpectedResult = {
  intentType: string;
  action: string;
  fields: Record<string, unknown>;
  missingFields: string[];
  confidenceMin: number;
};

export type CaptureResolution = {
  intentType: string;
  action: string;
  fields: Record<string, unknown>;
  missingFields: string[];
  confidence: number;
  allowLLM: boolean;
  source: "pendingChoice" | "lastQuestion" | "correction" | "query" | "planner" | "ledger" | "memory" | "mixedIntent" | "llmFallback";
  matchedFixtureId?: string;
  updatedState: {
    intentType: string;
    fields: Record<string, unknown>;
    missingFields: string[];
  };
};

export type ResolveCaptureInput = {
  input: string;
  state?: CaptureStateInput;
};

export type PatternMatch = Omit<CaptureResolution, "updatedState">;
