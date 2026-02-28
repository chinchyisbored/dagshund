import type { Node } from "@xyflow/react";
import { useMemo, useState } from "react";
import { getNodeData } from "../utils/node-data.ts";
import { extractNodeSearchText, type NodeSearchEntry } from "../utils/node-search-text.ts";
import { matchSearchToken, parseSearchQuery } from "../utils/search-query-parser.ts";

/** Parse query into tokens and return IDs where ALL tokens match. Null = no active search. */
export const computeSearchMatchedIds = (
  query: string,
  searchIndex: ReadonlyMap<string, NodeSearchEntry>,
): ReadonlySet<string> | null => {
  if (query === "") return null;

  const tokens = parseSearchQuery(query);
  if (tokens.length === 0) return null;

  const matched = new Set<string>();
  for (const [nodeId, entry] of searchIndex) {
    if (tokens.every((token) => matchSearchToken(token, entry))) {
      matched.add(nodeId);
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
    () => computeSearchMatchedIds(searchQuery, nodeSearchIndex),
    [searchQuery, nodeSearchIndex],
  );

  return { searchQuery, setSearchQuery, searchMatchedIds };
};
