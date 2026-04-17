import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useTabVisibility } from "../../src/hooks/contexts.ts";
import { withTabVisibility } from "../helpers/providers.tsx";

describe("useTabVisibility", () => {
  test("returns true by default (no provider)", () => {
    const { result } = renderHook(() => useTabVisibility());
    expect(result.current).toBe(true);
  });

  test("returns provider value when wrapped", () => {
    const { result } = renderHook(() => useTabVisibility(), { wrapper: withTabVisibility(false) });
    expect(result.current).toBe(false);
  });
});
