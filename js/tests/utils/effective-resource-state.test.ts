import { describe, expect, test } from "bun:test";
import { planSchema } from "../../src/types/plan-schema.ts";
import { selectEffectiveResourceState } from "../../src/utils/effective-resource-state.ts";
import cases from "./effective-state-cases.json";

describe("selectEffectiveResourceState", () => {
  test("selects each parsed-input contract vector", () => {
    for (const testCase of cases) {
      const parsed = planSchema.safeParse({ plan: { "resources.jobs.vector": testCase.entry } });
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      const entry = parsed.data.plan?.["resources.jobs.vector"];
      expect(entry).toBeDefined();
      if (!entry) continue;

      const selected = selectEffectiveResourceState(entry);
      expect(selected.origin === testCase.origin).toBe(true);
      expect(selected.snapshot).toEqual(testCase.snapshot);
    }
  });

  test("preserves malformed present wrappers as selected invalid data", () => {
    expect(
      selectEffectiveResourceState({ new_state: null, remote_state: { name: "old" } }),
    ).toEqual({
      origin: "new",
      snapshot: null,
    });
    expect(
      selectEffectiveResourceState({ new_state: "bad", remote_state: { name: "old" } }),
    ).toEqual({
      origin: "new",
      snapshot: "bad",
    });
  });
});
