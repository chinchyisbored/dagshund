import type { Node } from "@xyflow/react";
import { useMemo, useState } from "react";
import { getNodeData } from "../utils/node-data.ts";
import { extractNodeSearchText, type NodeSearchEntry } from "../utils/node-search-text.ts";

/** Pure search dispatch: exact ("quoted"), badge (type:), or fuzzy substring. */
export const computeSearchMatchedIds = (
  query: string,
  baseNodes: readonly Node[],
  searchIndex: ReadonlyMap<string, NodeSearchEntry>,
): ReadonlySet<string> | null => {
  if (query === "") return null;

  const isExact = query.startsWith('"') && query.endsWith('"') && query.length > 2;
  const isBadge = query.startsWith("type:");

  const matched = new Set<string>();
  if (isExact) {
    const exactTerm = query.slice(1, -1);
    for (const node of baseNodes) {
      if (getNodeData(node).label.toLowerCase() === exactTerm) matched.add(node.id);
    }
  } else if (isBadge) {
    const badgeTerm = query.slice(5);
    if (badgeTerm.length > 0) {
      for (const [nodeId, entry] of searchIndex) {
        if (entry.badgeText.includes(badgeTerm)) matched.add(nodeId);
      }
    }
  } else {
    for (const [nodeId, entry] of searchIndex) {
      if (entry.text.includes(query)) matched.add(nodeId);
    }
  }

  return matched;
};

type NodeSearchResult = {
  readonly searchQuery: string;
  readonly setSearchQuery: (query: string) => void;
  readonly searchMatchedIds: ReadonlySet<string> | null;
};

/** Owns search query state, builds a search index over nodes, and computes matches. */
export const useNodeSearch = (baseNodes: readonly Node[]): NodeSearchResult => {
  const [searchQuery, setSearchQuery] = useState("");

  const nodeSearchIndex = useMemo((): ReadonlyMap<string, NodeSearchEntry> => {
    const index = new Map<string, NodeSearchEntry>();
    for (const node of baseNodes) {
      index.set(node.id, extractNodeSearchText(getNodeData(node)));
    }
    return index;
  }, [baseNodes]);

  const searchMatchedIds = useMemo(
    () => computeSearchMatchedIds(searchQuery, baseNodes, nodeSearchIndex),
    [searchQuery, baseNodes, nodeSearchIndex],
  );

  return { searchQuery, setSearchQuery, searchMatchedIds };
};
