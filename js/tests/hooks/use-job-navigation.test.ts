import { describe, expect, mock, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import { useJobNavigation } from "../../src/hooks/contexts.ts";
import { withJobNavigation } from "../helpers/providers.tsx";

describe("useJobNavigation", () => {
  test("returns null when no provider is installed", () => {
    const { result } = renderHook(() => useJobNavigation());
    expect(result.current).toBeNull();
  });

  test("returns the callback from the provider and forwards arguments", () => {
    const navigate = mock((_jobKey: string) => {});
    const { result } = renderHook(() => useJobNavigation(), {
      wrapper: withJobNavigation(navigate),
    });
    expect(result.current).toBe(navigate);
    result.current?.("resources.jobs.ingest");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("resources.jobs.ingest");
  });
});
