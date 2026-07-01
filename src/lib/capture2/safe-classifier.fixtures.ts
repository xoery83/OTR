import type { Capture2SafeClassification } from "./safe-classifier";

export type Capture2SafeClassifierFixture = {
  input: string;
  expected: Pick<Capture2SafeClassification, "intent" | "action"> & {
    target?: string;
  };
};

export const capture2SafeClassifierFixtures: Capture2SafeClassifierFixture[] = [
  {
    input: "看看今天还有什么行程",
    expected: {
      intent: "journey_query",
      action: "answer_query",
      target: "journey",
    },
  },
  {
    input: "今天终于到了瀑布",
    expected: {
      intent: "deferred",
      action: "defer",
      target: "unknown",
    },
  },
  {
    input: "停车50欧",
    expected: {
      intent: "expense",
      action: "open_expense_form",
      target: "ledger",
    },
  },
  {
    input: "今晚订了酒店",
    expected: {
      intent: "planner",
      action: "open_planner_form",
      target: "planner",
    },
  },
  {
    input: "导航去酒店",
    expected: {
      intent: "navigation",
      action: "open_map",
      target: "navigation",
    },
  },
  {
    input: "修改刚才那条",
    expected: {
      intent: "deferred",
      action: "defer",
      target: "mutation",
    },
  },
];
