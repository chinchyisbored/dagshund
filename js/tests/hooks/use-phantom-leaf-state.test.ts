import { describe, expect, test } from "bun:test";
import type { Edge, Node } from "@xyflow/react";
import { usePhantomLeafState } from "../../src/hooks/use-phantom-leaf-state.ts";
import type { DagNodeData } from "../../src/types/graph-types.ts";
import { renderHook } from "../helpers/render-hook.ts";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

const makeNode = (id: string, nodeKind: DagNodeData["nodeKind"]): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    label: id,
    nodeKind,
    diffState: "unchanged",
    resourceKey: id,
    changes: undefined,
    resourceState: undefined,
    // as: DagNodeData is a discriminated union — TS can't narrow from a generic nodeKind param
  } as DagNodeData,
});

const makeEdge = (source: string, target: string): Edge => ({
  id: `${source}→${target}`,
  source,
  target,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Small graph with cascade-pruning scenario:
 *
 *   uc-root (root)
 *     └─ catalog::prod (phantom)
 *         └─ schema::prod.staging (phantom)
 *             ├─ source-table::prod.staging.t1 (phantom leaf)
 *             └─ source-table::prod.staging.t2 (phantom leaf)
 */
const cascadeNodes: readonly Node[] = [
  makeNode("uc-root", "root"),
  makeNode("catalog::prod", "phantom"),
  makeNode("schema::prod.staging", "phantom"),
  makeNode("source-table::prod.staging.t1", "phantom"),
  makeNode("source-table::prod.staging.t2", "phantom"),
];

const cascadeEdges: readonly Edge[] = [
  makeEdge("uc-root", "catalog::prod"),
  makeEdge("catalog::prod", "schema::prod.staging"),
  makeEdge("schema::prod.staging", "source-table::prod.staging.t1"),
  makeEdge("schema::prod.staging", "source-table::prod.staging.t2"),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePhantomLeafState", () => {
  test("returns all nodes and edges when showPhantomLeaves is true", () => {
    const result = renderHook(() => usePhantomLeafState(cascadeNodes, cascadeEdges, true));
    expect(result.visibleNodes).toEqual(cascadeNodes);
    expect(result.visibleEdges).toEqual(cascadeEdges);
    expect(result.phantomLeafCount).toBe(2);
    expect(result.hiddenPhantomIds.size).toBe(0);
  });

  test("hides phantom leaves and cascade-prunes orphaned ancestors", () => {
    const result = renderHook(() => usePhantomLeafState(cascadeNodes, cascadeEdges, false));
    // Both source-table phantoms hidden → schema phantom orphaned → catalog phantom orphaned
    // Only uc-root (root nodeKind) survives
    expect(result.visibleNodes.map((n) => n.id)).toEqual(["uc-root"]);
    expect(result.visibleEdges).toEqual([]);
    expect(result.phantomLeafCount).toBe(2);
    expect(result.hiddenPhantomIds.size).toBe(4);
  });

  test("preserves phantom ancestor with at least one visible real child", () => {
    // Add a real resource node under schema::prod.staging
    const nodes: readonly Node[] = [
      ...cascadeNodes,
      makeNode("resources.volumes.data_vol", "resource"),
    ];
    const edges: readonly Edge[] = [
      ...cascadeEdges,
      makeEdge("schema::prod.staging", "resources.volumes.data_vol"),
    ];

    const result = renderHook(() => usePhantomLeafState(nodes, edges, false));
    const visibleIds = result.visibleNodes.map((n) => n.id);
    // Phantom leaves hidden, but schema + catalog survive because schema has a real child
    expect(visibleIds).toContain("uc-root");
    expect(visibleIds).toContain("catalog::prod");
    expect(visibleIds).toContain("schema::prod.staging");
    expect(visibleIds).toContain("resources.volumes.data_vol");
    expect(visibleIds).not.toContain("source-table::prod.staging.t1");
    expect(visibleIds).not.toContain("source-table::prod.staging.t2");
    expect(result.hiddenPhantomIds.size).toBe(2);
  });

  test("does not prune non-phantom parents even if all children are hidden", () => {
    // Root node with only phantom leaf children
    const nodes: readonly Node[] = [
      makeNode("uc-root", "root"),
      makeNode("source-table::x.y.z", "phantom"),
    ];
    const edges: readonly Edge[] = [makeEdge("uc-root", "source-table::x.y.z")];

    const result = renderHook(() => usePhantomLeafState(nodes, edges, false));
    // Root is preserved (nodeKind "root", not "phantom")
    expect(result.visibleNodes.map((n) => n.id)).toEqual(["uc-root"]);
    expect(result.hiddenPhantomIds.size).toBe(1);
  });

  test("handles database-instance phantom leaves", () => {
    const nodes: readonly Node[] = [
      makeNode("workspace-root", "root"),
      makeNode("database-instance::my_db", "phantom"),
    ];
    const edges: readonly Edge[] = [makeEdge("workspace-root", "database-instance::my_db")];

    const result = renderHook(() => usePhantomLeafState(nodes, edges, false));
    expect(result.visibleNodes.map((n) => n.id)).toEqual(["workspace-root"]);
    expect(result.phantomLeafCount).toBe(1);
    expect(result.hiddenPhantomIds.has("database-instance::my_db")).toBe(true);
  });

  test("returns unfiltered when no phantom leaves exist", () => {
    const nodes: readonly Node[] = [
      makeNode("uc-root", "root"),
      makeNode("catalog::prod", "phantom"),
      makeNode("resources.schemas.analytics", "resource"),
    ];
    const edges: readonly Edge[] = [
      makeEdge("uc-root", "catalog::prod"),
      makeEdge("catalog::prod", "resources.schemas.analytics"),
    ];

    const result = renderHook(() => usePhantomLeafState(nodes, edges, false));
    expect(result.visibleNodes).toEqual(nodes);
    expect(result.visibleEdges).toEqual(edges);
    expect(result.phantomLeafCount).toBe(0);
    expect(result.hiddenPhantomIds.size).toBe(0);
  });

  test("removes edges touching hidden nodes", () => {
    const result = renderHook(() => usePhantomLeafState(cascadeNodes, cascadeEdges, false));
    // All four edges touch at least one hidden node
    expect(result.visibleEdges).toEqual([]);
  });

  test("cascade-prunes diamond-shaped phantom ancestry", () => {
    // Two phantom schemas share one phantom catalog parent:
    //   catalog::prod (phantom)
    //     ├─ schema::prod.a (phantom)
    //     │    └─ source-table::prod.a.t1 (phantom leaf)
    //     └─ schema::prod.b (phantom)
    //          └─ source-table::prod.b.t2 (phantom leaf)
    const nodes: readonly Node[] = [
      makeNode("uc-root", "root"),
      makeNode("catalog::prod", "phantom"),
      makeNode("schema::prod.a", "phantom"),
      makeNode("schema::prod.b", "phantom"),
      makeNode("source-table::prod.a.t1", "phantom"),
      makeNode("source-table::prod.b.t2", "phantom"),
    ];
    const edges: readonly Edge[] = [
      makeEdge("uc-root", "catalog::prod"),
      makeEdge("catalog::prod", "schema::prod.a"),
      makeEdge("catalog::prod", "schema::prod.b"),
      makeEdge("schema::prod.a", "source-table::prod.a.t1"),
      makeEdge("schema::prod.b", "source-table::prod.b.t2"),
    ];

    const result = renderHook(() => usePhantomLeafState(nodes, edges, false));
    // Both leaves hidden → both schemas orphaned → catalog orphaned → only root survives
    expect(result.visibleNodes.map((n) => n.id)).toEqual(["uc-root"]);
    expect(result.visibleEdges).toEqual([]);
    expect(result.hiddenPhantomIds.size).toBe(5);
  });

  test("handles empty graph", () => {
    const result = renderHook(() => usePhantomLeafState([], [], false));
    expect(result.visibleNodes).toEqual([]);
    expect(result.visibleEdges).toEqual([]);
    expect(result.phantomLeafCount).toBe(0);
    expect(result.hiddenPhantomIds.size).toBe(0);
  });
});
