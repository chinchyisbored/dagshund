import { describe, expect, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { useAsyncLayout } from "../../src/hooks/use-async-layout.ts";
import type { LayoutResult } from "../../src/types/layout-result.ts";
import type { Plan } from "../../src/types/plan-schema.ts";

const emptyLayout: LayoutResult = { nodes: [], edges: [] };
const plan: Plan = {};

describe("useAsyncLayout", () => {
  test("starts in loading state", () => {
    const neverResolves = (): Promise<LayoutResult> => new Promise(() => {});
    const { result } = renderHook(() => useAsyncLayout(plan, neverResolves));
    expect(result.current.status).toBe("loading");
  });

  test("transitions to ready when transformLayout resolves", async () => {
    const resolveWith = async (): Promise<LayoutResult> => emptyLayout;
    const { result } = renderHook(() => useAsyncLayout(plan, resolveWith));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status === "ready") {
      expect(result.current.layout).toBe(emptyLayout);
    }
  });

  test("transitions to error when transformLayout rejects", async () => {
    const rejectWith = async (): Promise<LayoutResult> => {
      throw new Error("layout broken");
    };
    const { result } = renderHook(() => useAsyncLayout(plan, rejectWith));
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toBe("layout broken");
    }
  });

  test("falls back to generic message when rejection is not an Error", async () => {
    const rejectWith = async (): Promise<LayoutResult> => {
      throw "oops";
    };
    const { result } = renderHook(() => useAsyncLayout(plan, rejectWith));
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toBe("Layout failed");
    }
  });
});
