import { capture2SafeClassifierFixtures } from "../src/lib/capture2/safe-classifier.fixtures";
import { classifyCapture2SafeIntent } from "../src/lib/capture2/safe-classifier";

let failureCount = 0;

for (const fixture of capture2SafeClassifierFixtures) {
  const result = classifyCapture2SafeIntent(fixture.input);
  const expected = fixture.expected;
  const target = result.extracted.target;
  const passed =
    result.intent === expected.intent &&
    result.action === expected.action &&
    (!expected.target || target === expected.target);

  if (!passed) {
    failureCount += 1;
    console.error(
      JSON.stringify(
        {
          input: fixture.input,
          expected,
          actual: {
            intent: result.intent,
            action: result.action,
            target,
            reason: result.reason,
          },
        },
        null,
        2,
      ),
    );
  }
}

if (failureCount > 0) {
  console.error(`Capture2 Safe Classifier fixtures failed: ${failureCount}`);
  process.exit(1);
}

console.log(
  `Capture2 Safe Classifier fixtures passed: ${capture2SafeClassifierFixtures.length}`,
);
