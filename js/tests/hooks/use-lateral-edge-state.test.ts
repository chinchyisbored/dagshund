import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import { useLateralEdgeState } from "../../src/hooks/use-lateral-edge-state.ts";

const makeEdge = (
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): Edge => ({
  id: `${source}→${target}`,
  source,
  target,
  sourceHandle,
  targetHandle,
});

describe("useLateralEdgeState", () => {
  test("returns empty state for empty input", () => {
    const { result } = renderHook(() => useLateralEdgeState([], false, null));
    expect(result.current.lateralNodeIds).toBeNull();
    expect(result.current.activeLateralEdges).toEqual([]);
    expect(result.current.isolatedLateralIds).toBeNull();
    expect(result.current.lateralHandlesByNode).toBeNull();
  });

  test("collects lateral node ids regardless of toggle", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const { result } = renderHook(() => useLateralEdgeState(edges, false, null));
    expect(result.current.lateralNodeIds).not.toBeNull();
    expect([...(result.current.lateralNodeIds ?? [])].toSorted()).toEqual(["a", "b", "c"]);
  });

  test("activeLateralEdges === all edges when showLateralEdges is true", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const { result } = renderHook(() => useLateralEdgeState(edges, true, null));
    expect(result.current.activeLateralEdges).toEqual(edges);
  });

  test("activeLateralEdges is empty when toggle is off and no isolation", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const { result } = renderHook(() => useLateralEdgeState(edges, false, null));
    expect(result.current.activeLateralEdges).toEqual([]);
  });

  test("activeLateralEdges filtered to node when isolated and toggle off", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("x", "y")];
    const { result } = renderHook(() => useLateralEdgeState(edges, false, "b"));
    const active = result.current.activeLateralEdges;
    expect(active.map((e) => e.id).toSorted()).toEqual(["a→b", "b→c"]);
  });

  test("isolatedLateralIds includes the node and its lateral neighbors", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("x", "y")];
    const { result } = renderHook(() => useLateralEdgeState(edges, false, "b"));
    expect([...(result.current.isolatedLateralIds ?? [])].toSorted()).toEqual(["a", "b", "c"]);
  });

  test("lateralHandlesByNode collects handle ids per node from active edges", () => {
    const edges = [makeEdge("a", "b", "h-out-1", "h-in-1"), makeEdge("b", "c", "h-out-2")];
    const { result } = renderHook(() => useLateralEdgeState(edges, true, null));
    const map = result.current.lateralHandlesByNode;
    expect(map).not.toBeNull();
    expect([...(map?.get("a") ?? [])]).toEqual(["h-out-1"]);
    expect([...(map?.get("b") ?? [])].toSorted()).toEqual(["h-in-1", "h-out-2"]);
  });
});
