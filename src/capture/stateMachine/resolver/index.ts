import {
  capturePatternLibrary,
  fixturePattern,
} from "../rules/patternLibrary";
import type {
  CaptureResolution,
  CaptureStateInput,
  PatternMatch,
  ResolveCaptureInput,
} from "../types";

function mergeState(state: CaptureStateInput, match: PatternMatch) {
  const fields = {
    ...(state.fields ?? {}),
    ...match.fields,
  };
  return {
    intentType: match.intentType,
    fields,
    missingFields: match.missingFields,
  };
}

function resolvePendingChoice() {
  // Batch 001 does not yet include pendingChoice fixtures. Keep the stage explicit
  // so future planner-item/member choice fixtures plug in before lastQuestion.
  return null;
}

function llmFallback(input: string, state: CaptureStateInput): PatternMatch {
  return {
    intentType: state.intentType ?? "unknown",
    action: "needs_llm",
    fields: { input },
    missingFields: [],
    confidence: 0.2,
    allowLLM: true,
    source: "llmFallback",
  };
}

function finalize(state: CaptureStateInput, match: PatternMatch): CaptureResolution {
  const allowLLM = match.action === "needs_llm";
  return {
    ...match,
    allowLLM,
    updatedState: mergeState(state, match),
  };
}

export function resolveCaptureInput({
  input,
  state = {},
}: ResolveCaptureInput): CaptureResolution {
  const match =
    resolvePendingChoice() ??
    capturePatternLibrary.resolveLastQuestion(input, state) ??
    capturePatternLibrary.resolveCorrection(input, state) ??
    capturePatternLibrary.resolveQueryFollowup(input, state) ??
    fixturePattern(input, state) ??
    capturePatternLibrary.resolveQuery(input, state) ??
    capturePatternLibrary.resolvePlanner(input) ??
    capturePatternLibrary.resolveLedger(input) ??
    capturePatternLibrary.resolveMemory(input) ??
    capturePatternLibrary.resolveMixedIntent(input) ??
    llmFallback(input, state);

  return finalize(state, match);
}

export type {
  CaptureExpectedResult,
  CaptureFixture,
  CaptureFixtureLibrary,
  CaptureResolution,
  CaptureStateInput,
  ResolveCaptureInput,
} from "../types";
