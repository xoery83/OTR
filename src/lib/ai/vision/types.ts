import "server-only";

export type VisionMode = "basic" | "vision" | "reasoning";

export type VisionProviderName = "local" | "openai" | "qwen";

export type AnalyzeImageInput = {
  imageUrl: string;
  prompt?: string;
  mode?: VisionMode;
  timeoutMs?: number;
};

export type VisionAnalysis = {
  summary: string;
  tags: string[];
  people: string[];
  locationHints: string[];
  activities: string[];
  objects: string[];
  food: string[];
  ocrText: string;
  confidence: number;
  provider: string;
  model: string;
};

export type VisionProviderInput = Required<
  Pick<AnalyzeImageInput, "imageUrl" | "prompt" | "mode" | "timeoutMs">
>;

export type VisionProviderResult = VisionAnalysis & {
  rawResponse: unknown;
};

export type VisionProvider = {
  name: VisionProviderName;
  analyzeImage(input: VisionProviderInput): Promise<VisionProviderResult>;
};

export class VisionProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VisionProviderError";
  }
}

export function emptyVisionAnalysis(
  provider: VisionProviderName,
  model: string,
): VisionAnalysis {
  return {
    summary: "",
    tags: [],
    people: [],
    locationHints: [],
    activities: [],
    objects: [],
    food: [],
    ocrText: "",
    confidence: 0,
    provider,
    model,
  };
}

