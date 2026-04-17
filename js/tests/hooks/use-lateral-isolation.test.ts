import { describe, expect, mock, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useLateralIsolation } from "../../src/hooks/use-lateral-isolation.ts";
import { withLateralIsolation } from "../helpers/providers.tsx";

describe("useLateralIsolation", () => {
  test("returns null when no provider is installed", () => {
    const { result } = renderHook(() => useLateralIsolation());
    expect(result.current).toBeNull();
  });

  test("returns the callback from the provider and forwards arguments", () => {
    const isolate = mock((_nodeId: string) => {});
    const { result } = renderHook(() => useLateralIsolation(), {
      wrapper: withLateralIsolation(isolate),
    });
    expect(result.current).toBe(isolate);
    result.current?.("node-42");
    expect(isolate).toHaveBeenCalledTimes(1);
    expect(isolate).toHaveBeenCalledWith("node-42");
  });
});
