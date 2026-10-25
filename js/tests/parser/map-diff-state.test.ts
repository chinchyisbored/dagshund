import { describe, expect, test } from "bun:test";
import { mapActionToDiffState } from "../../src/parser/map-diff-state.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import cases from "./action-diff-state-cases.json";

describe("mapActionToDiffState parsed action cases", () => {
  for (const testCase of cases) {
    test(testCase.name, () => {
      const entry = testCase.action === undefined ? {} : { action: testCase.action };
      const parsed = parsePlanJson({ plan: { "resources.jobs.example": entry } });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("action case must parse");

      const action = parsed.data.plan?.["resources.jobs.example"]?.action;
      expect(String(mapActionToDiffState(action))).toBe(testCase.expected);
    });
  }
});
