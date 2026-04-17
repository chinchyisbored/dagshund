import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { usePlan } from "../../src/hooks/use-plan-context.ts";
import type { Plan } from "../../src/types/plan-schema.ts";
import { withPlan } from "../helpers/providers.tsx";

describe("usePlan", () => {
  test("returns undefined without provider", () => {
    const { result } = renderHook(() => usePlan());
    expect(result.current).toBeUndefined();
  });

  test("returns the plan value from provider", () => {
    const plan: Plan = { plan_version: 1, cli_version: "test", serial: 42 };
    const { result } = renderHook(() => usePlan(), { wrapper: withPlan(plan) });
    expect(result.current).toBe(plan);
  });
});
