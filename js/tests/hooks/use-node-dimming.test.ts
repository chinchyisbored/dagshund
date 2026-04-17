import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  resetMockConnections,
  setMockConnections,
  xyflowMockFactory,
} from "../helpers/xyflow-mock.ts";

mock.module("@xyflow/react", xyflowMockFactory);

// Import AFTER the mock is installed so useNodeConnections resolves to the stub.
const { renderHook } = await import("@testing-library/react");
const { useNodeDimming } = await import("../../src/hooks/use-node-dimming.ts");
const { compose, withInteractionState } = await import("../helpers/providers.tsx");

beforeEach(() => {
  resetMockConnections();
});

describe("useNodeDimming", () => {
  test("no interaction state: full opacity, no dim", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "unchanged"), {
      wrapper: compose(withInteractionState()),
    });
    expect(result.current.opacityClass).toBe("opacity-100");
    expect(result.current.hasIncoming).toBe(false);
    expect(result.current.hasOutgoing).toBe(false);
    expect(result.current.isLateralIsolated).toBe(false);
    expect(result.current.hasLateralEdges).toBe(false);
  });

  test("hover with node outside connected set dims to 0.3", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "added"), {
      wrapper: compose(
        withInteractionState({ hoveredNodeId: "other", connectedIds: new Set(["other"]) }),
      ),
    });
    // buildGlowStyle uses 0.3 opacity as CSS on the glow-style object.
    expect(result.current.glowStyle.opacity).toBe(0.3);
  });

  test("filter-matched node gets opacity-100 class override", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "unchanged"), {
      wrapper: compose(withInteractionState({ filterMatchedIds: new Set(["n1"]) })),
    });
    expect(result.current.opacityClass).toBe("opacity-100");
  });

  test("filter-unmatched node dims to 0.3", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "added"), {
      wrapper: compose(withInteractionState({ filterMatchedIds: new Set(["other"]) })),
    });
    expect(result.current.glowStyle.opacity).toBe(0.3);
  });

  test("selection-dimmed node (not in selectedConnectedIds) dims to 0.5", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "added"), {
      wrapper: compose(
        withInteractionState({
          selectedNodeId: "other",
          selectedConnectedIds: new Set(["other"]),
        }),
      ),
    });
    expect(result.current.glowStyle.opacity).toBe(0.5);
  });

  test("lateral isolation dims nodes outside the isolated set", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "added"), {
      wrapper: compose(
        withInteractionState({
          isolatedLateralIds: new Set(["other"]),
          isolatedLateralNodeId: "other",
        }),
      ),
    });
    expect(result.current.glowStyle.opacity).toBe(0.3);
    expect(result.current.isLateralIsolated).toBe(false);
  });

  test("isLateralIsolated reflects exact match against isolatedLateralNodeId", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "unchanged"), {
      wrapper: compose(
        withInteractionState({
          isolatedLateralIds: new Set(["n1"]),
          isolatedLateralNodeId: "n1",
        }),
      ),
    });
    expect(result.current.isLateralIsolated).toBe(true);
  });

  test("lateral toggle dims non-lateral nodes when showLateralEdges is on", () => {
    const { result } = renderHook(() => useNodeDimming("n1", "added"), {
      wrapper: compose(
        withInteractionState({
          showLateralEdges: true,
          lateralNodeIds: new Set(["other"]),
        }),
      ),
    });
    expect(result.current.glowStyle.opacity).toBe(0.3);
  });

  test("hasIncoming is true when a non-lateral connection exists", () => {
    setMockConnections({ target: [{ targetHandle: null }] });
    const { result } = renderHook(() => useNodeDimming("n1", "unchanged"), {
      wrapper: compose(withInteractionState()),
    });
    expect(result.current.hasIncoming).toBe(true);
  });

  test("hasIncoming ignores connections whose targetHandle starts with 'lateral-'", () => {
    setMockConnections({ target: [{ targetHandle: "lateral-foo" }] });
    const { result } = renderHook(() => useNodeDimming("n1", "unchanged"), {
      wrapper: compose(withInteractionState()),
    });
    expect(result.current.hasIncoming).toBe(false);
  });

  test("hasOutgoing ignores lateral connections similarly", () => {
    setMockConnections({
      source: [{ sourceHandle: "lateral-foo" }, { sourceHandle: null }],
    });
    const { result } = renderHook(() => useNodeDimming("n1", "unchanged"), {
      wrapper: compose(withInteractionState()),
    });
    expect(result.current.hasOutgoing).toBe(true);
  });

  test("lateralHandles for the node id is surfaced", () => {
    const handles = new Map<string, ReadonlySet<string>>([["n1", new Set(["h1", "h2"])]]);
    const { result } = renderHook(() => useNodeDimming("n1", "unchanged"), {
      wrapper: compose(withInteractionState({ lateralHandlesByNode: handles })),
    });
    expect([...(result.current.lateralHandles ?? [])].toSorted()).toEqual(["h1", "h2"]);
  });
});
