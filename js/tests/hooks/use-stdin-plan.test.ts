import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { useStdinPlan } from "../../src/hooks/use-stdin-plan.ts";

type WindowWithPlan = typeof globalThis & { __DAGSHUND_PLAN__?: unknown };

const originalFetch = globalThis.fetch;

const setFetchResponse = (body: unknown): void => {
  globalThis.fetch = mock(async () => ({
    json: async () => body,
  })) as unknown as typeof fetch;
};

const setFetchReject = (err: unknown): void => {
  globalThis.fetch = mock(async () => {
    throw err;
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  delete (globalThis as WindowWithPlan).__DAGSHUND_PLAN__;
});

afterEach(() => {
  delete (globalThis as WindowWithPlan).__DAGSHUND_PLAN__;
  globalThis.fetch = originalFetch;
});

describe("useStdinPlan", () => {
  test("reads the embedded plan off window.__DAGSHUND_PLAN__", async () => {
    (globalThis as WindowWithPlan).__DAGSHUND_PLAN__ = { plan_version: 1 };
    const { result } = renderHook(() => useStdinPlan());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status === "ready") {
      expect(result.current.plan.plan_version).toBe(1);
    }
  });

  test("reports an error when the embedded plan fails to parse", async () => {
    (globalThis as WindowWithPlan).__DAGSHUND_PLAN__ = "not a plan";
    const { result } = renderHook(() => useStdinPlan());
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  test("fetches /api/plan when no embedded plan is present", async () => {
    setFetchResponse({ plan_version: 2 });
    const { result } = renderHook(() => useStdinPlan());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status === "ready") {
      expect(result.current.plan.plan_version).toBe(2);
    }
  });

  test("returns empty status when /api/plan responds with null", async () => {
    setFetchResponse(null);
    const { result } = renderHook(() => useStdinPlan());
    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  test("returns error when fetch throws", async () => {
    setFetchReject(new Error("net broke"));
    const { result } = renderHook(() => useStdinPlan());
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toBe("net broke");
    }
  });
});
