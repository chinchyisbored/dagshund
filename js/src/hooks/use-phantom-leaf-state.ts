import type { Edge, Node } from "@xyflow/react";
import { useMemo } from "react";
import { getNodeData } from "../utils/node-data.ts";
import { isPhantomLeaf } from "../utils/resource-key.ts";

type PhantomLeafState = {
  /** Filtered nodes with phantom leaves + orphaned ancestors removed (when OFF). */
  readonly visibleNodes: readonly Node[];
  /** Filtered edges touching only visible nodes. */
  readonly visibleEdges: readonly Edge[];
  /** Count of non-hierarchy phantom nodes (for toggle label). Always computed. */
  readonly phantomLeafCount: number;
  /** Full set of hidden node IDs (leaf + orphaned ancestors), for filtering lateral edges. */
  readonly hiddenPhantomIds: ReadonlySet<string>;
};

/** Identify all phantom leaf node IDs from the full node set. */
const collectPhantomLeafIds = (nodes: readonly Node[]): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const node of nodes) {
    const data = getNodeData(node);
    if (data.nodeKind === "phantom" && isPhantomLeaf(node.id)) {
      ids.add(node.id);
    }
  }
  return ids;
};

/** Build a set of target node IDs reachable from each source via the given edges. */
const buildChildMap = (edges: readonly Edge[]): ReadonlyMap<string, ReadonlySet<string>> => {
  // Local mutation for accumulation — invisible to callers.
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    let children = map.get(edge.source);
    if (children === undefined) {
      children = new Set();
      map.set(edge.source, children);
    }
    children.add(edge.target);
  }
  return map;
};

/** Cascade-prune orphaned phantom ancestors after removing phantom leaves.
 *  Iteratively removes phantom (non-root) nodes whose children are all hidden.
 *  Converges in ≤ tree depth iterations (typically 2-3). */
const cascadePruneOrphanedPhantoms = (
  nodes: readonly Node[],
  edges: readonly Edge[],
  phantomLeafIds: ReadonlySet<string>,
): ReadonlySet<string> => {
  // Local mutation — building the hidden set incrementally.
  const hidden = new Set(phantomLeafIds);
  const childMap = buildChildMap(edges);

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (hidden.has(node.id)) continue;
      const data = getNodeData(node);
      if (data.nodeKind !== "phantom") continue;

      const children = childMap.get(node.id);
      if (children === undefined) continue;

      let hasVisibleChild = false;
      for (const childId of children) {
        if (!hidden.has(childId)) {
          hasVisibleChild = true;
          break;
        }
      }
      if (!hasVisibleChild) {
        hidden.add(node.id);
        changed = true;
      }
    }
  }

  return hidden;
};

/** Filter nodes and edges based on phantom leaf toggle state.
 *  When OFF: hides phantom leaves, cascade-prunes orphaned phantom ancestors,
 *  and removes all edges touching hidden nodes.
 *  When ON: passes through unfiltered (current behavior). */
export const usePhantomLeafState = (
  nodes: readonly Node[],
  edges: readonly Edge[],
  showPhantomLeaves: boolean,
): PhantomLeafState => {
  const phantomLeafIds = useMemo(() => collectPhantomLeafIds(nodes), [nodes]);

  const phantomLeafCount = phantomLeafIds.size;

  const hiddenPhantomIds = useMemo(
    () =>
      showPhantomLeaves || phantomLeafIds.size === 0
        ? new Set<string>()
        : cascadePruneOrphanedPhantoms(nodes, edges, phantomLeafIds),
    [nodes, edges, phantomLeafIds, showPhantomLeaves],
  );

  const visibleNodes = useMemo(
    () => (hiddenPhantomIds.size === 0 ? nodes : nodes.filter((n) => !hiddenPhantomIds.has(n.id))),
    [nodes, hiddenPhantomIds],
  );

  const visibleEdges = useMemo(
    () =>
      hiddenPhantomIds.size === 0
        ? edges
        : edges.filter((e) => !hiddenPhantomIds.has(e.source) && !hiddenPhantomIds.has(e.target)),
    [edges, hiddenPhantomIds],
  );

  return { visibleNodes, visibleEdges, phantomLeafCount, hiddenPhantomIds };
};
