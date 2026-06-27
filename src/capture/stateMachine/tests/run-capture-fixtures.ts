import fixtureLibrary from "../fixtures/capture-fixtures-batch-001.json";
import { resolveCaptureInput } from "../resolver";
import type { CaptureFixtureLibrary } from "../types";

const library = fixtureLibrary as CaptureFixtureLibrary;

type Failure = {
  id: string;
  input: string;
  message: string;
};

function sameArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function valueEquals(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function run() {
  const failures: Failure[] = [];
  let passCount = 0;

  for (const fixture of library.fixtures) {
    const result = resolveCaptureInput({
      input: fixture.input,
      state: fixture.initialState,
    });
    const expected = fixture.expected;
    const errors: string[] = [];

    if (result.intentType !== expected.intentType) {
      errors.push(`intent ${result.intentType} !== ${expected.intentType}`);
    }
    if (result.action !== expected.action) {
      errors.push(`action ${result.action} !== ${expected.action}`);
    }
    if (result.confidence < expected.confidenceMin) {
      errors.push(
        `confidence ${result.confidence.toFixed(2)} < ${expected.confidenceMin.toFixed(2)}`,
      );
    }
    if (!sameArray(result.missingFields, expected.missingFields)) {
      errors.push(
        `missingFields ${JSON.stringify(result.missingFields)} !== ${JSON.stringify(
          expected.missingFields,
        )}`,
      );
    }
    for (const [key, value] of Object.entries(expected.fields)) {
      if (!valueEquals(result.fields[key], value)) {
        errors.push(
          `field ${key} ${JSON.stringify(result.fields[key])} !== ${JSON.stringify(
            value,
          )}`,
        );
      }
    }
    if (expected.action !== "needs_llm" && result.allowLLM) {
      errors.push("non-needs_llm fixture allowed LLM");
    }
    if (expected.action === "needs_llm" && !result.allowLLM) {
      errors.push("needs_llm fixture did not allow LLM");
    }

    if (errors.length > 0) {
      failures.push({
        id: fixture.id,
        input: fixture.input,
        message: errors.join("; "),
      });
      console.log(
        `FAIL ${fixture.id} confidence=${result.confidence.toFixed(2)} missing=${JSON.stringify(
          result.missingFields,
        )} ${errors.join("; ")}`,
      );
    } else {
      passCount += 1;
      console.log(
        `PASS ${fixture.id} confidence=${result.confidence.toFixed(2)} missing=${JSON.stringify(
          result.missingFields,
        )}`,
      );
    }
  }

  console.log("");
  console.log(
    `Capture fixtures: ${passCount}/${library.fixtures.length} passed from ${library.name}`,
  );

  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((failure) => {
      console.log(`- ${failure.id}: ${failure.input} -> ${failure.message}`);
    });
    process.exit(1);
  }
}

run();
