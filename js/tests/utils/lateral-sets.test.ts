import { describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import {
  buildLateralHandlesByNode,
  collectIsolatedLateralIds,
  collectLateralNodeIds,
  filterIsolatedLateralEdges,
} from "../../src/utils/lateral-sets.ts";

const makeEdge = (
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): Edge => ({
  id: `lateral::${source}→${target}`,
  source,
  target,
  ...(sourceHandle !== undefined ? { sourceHandle } : {}),
  ...(targetHandle !== undefined ? { targetHandle } : {}),
});

describe("collectLateralNodeIds", () => {
  test("returns null for empty edges", () => {
    expect(collectLateralNodeIds([])).toBeNull();
  });

  test("collects all source and target node IDs", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];

    const result = collectLateralNodeIds(edges);

    expect(result).toEqual(new Set(["a", "b", "c"]));
  });

  test("deduplicates shared nodes", () => {
    const edges = [makeEdge("a", "b"), makeEdge("a", "c")];

    const result = collectLateralNodeIds(edges);

    expect(result?.size).toBe(3);
  });
});

describe("filterIsolatedLateralEdges", () => {
  test("returns empty for null isolation node", () => {
    const edges = [makeEdge("a", "b")];

    expect(filterIsolatedLateralEdges(edges, null)).toEqual([]);
  });

  test("returns only edges touching the isolated node", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("x", "y")];

    const result = filterIsolatedLateralEdges(edges, "b");

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["lateral::a→b", "lateral::b→c"]);
  });
});

describe("collectIsolatedLateralIds", () => {
  test("returns null for null isolation node", () => {
    expect(collectIsolatedLateralIds([], null)).toBeNull();
  });

  test("collects isolated node plus its lateral neighbors", () => {
    const edges = [makeEdge("a", "b"), makeEdge("b", "c"), makeEdge("x", "y")];

    const result = collectIsolatedLateralIds(edges, "b");

    expect(result).toEqual(new Set(["a", "b", "c"]));
  });

  test("includes isolated node even with no edges", () => {
    const result = collectIsolatedLateralIds([], "z");

    expect(result).toEqual(new Set(["z"]));
  });
});

describe("buildLateralHandlesByNode", () => {
  test("returns null for empty edges", () => {
    expect(buildLateralHandlesByNode([])).toBeNull();
  });

  test("maps node IDs to their active handle IDs", () => {
    const edges = [
      makeEdge("a", "b", "lateral-out-0", "lateral-in-0"),
      makeEdge("a", "c", "lateral-out-1", "lateral-in-0"),
    ];

    const result = buildLateralHandlesByNode(edges);

    expect(result?.get("a")).toEqual(new Set(["lateral-out-0", "lateral-out-1"]));
    expect(result?.get("b")).toEqual(new Set(["lateral-in-0"]));
    expect(result?.get("c")).toEqual(new Set(["lateral-in-0"]));
  });

  test("skips null and undefined handles", () => {
    const edges: Edge[] = [{ id: "e1", source: "a", target: "b" }];

    const result = buildLateralHandlesByNode(edges);

    expect(result?.size).toBe(0);
  });
});
