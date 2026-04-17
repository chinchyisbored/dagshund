import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useValueFormat } from "../../src/hooks/use-value-format.ts";
import { withValueFormat } from "../helpers/providers.tsx";

describe("useValueFormat", () => {
  test("defaults to 'json' with no provider", () => {
    const { result } = renderHook(() => useValueFormat());
    expect(result.current).toBe("json");
  });

  test("returns the format configured by the provider", () => {
    const { result } = renderHook(() => useValueFormat(), {
      wrapper: withValueFormat("yaml"),
    });
    expect(result.current).toBe("yaml");
  });
});
