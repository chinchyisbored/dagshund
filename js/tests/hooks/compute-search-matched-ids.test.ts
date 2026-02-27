import { describe, expect, test } from "bun:test";
import type { Node } from "@xyflow/react";
import { computeSearchMatchedIds } from "../../src/hooks/use-node-search.ts";
import type { NodeSearchEntry } from "../../src/utils/node-search-text.ts";

/** Build a minimal React Flow node stub with DagNodeData in .data. */
const stubNode = (id: string, label: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    label,
    nodeKind: "resource",
    diffState: "unchanged",
    resourceKey: `resources.jobs.${id}`,
    changes: undefined,
    resourceState: undefined,
    taskChangeSummary: undefined,
  },
});

const buildIndex = (
  entries: ReadonlyArray<readonly [string, string, string]>,
): ReadonlyMap<string, NodeSearchEntry> =>
  new Map(entries.map(([id, text, badgeText]) => [id, { text, badgeText }]));

/** Assert the result is non-null and return it for further assertions. */
const expectMatched = (result: ReadonlySet<string> | null): ReadonlySet<string> => {
  expect(result).not.toBeNull();
  return result as ReadonlySet<string>;
};

describe("computeSearchMatchedIds", () => {
  const nodes = [
    stubNode("a", "Ingest Pipeline"),
    stubNode("b", "Transform Job"),
    stubNode("c", "ingest_loader"),
  ];

  const index = buildIndex([
    ["a", "ingest pipeline\0pipeline", "pipeline"],
    ["b", "transform job\0job", "job"],
    ["c", "ingest_loader\0job", "job"],
  ]);

  test("returns null for empty query", () => {
    expect(computeSearchMatchedIds("", nodes, index)).toBeNull();
  });

  test("fuzzy matches substring in text", () => {
    const result = expectMatched(computeSearchMatchedIds("ingest", nodes, index));
    expect([...result].toSorted()).toEqual(["a", "c"]);
  });

  test("fuzzy match is case-sensitive on pre-lowercased index", () => {
    const result = expectMatched(computeSearchMatchedIds("Ingest", nodes, index));
    // Index text is lowercase, so uppercase query doesn't match
    expect(result.size).toBe(0);
  });

  test("exact match compares full label (lowercased)", () => {
    const result = expectMatched(computeSearchMatchedIds('"ingest pipeline"', nodes, index));
    expect([...result]).toEqual(["a"]);
  });

  test("exact match requires full label, not substring", () => {
    const result = expectMatched(computeSearchMatchedIds('"ingest"', nodes, index));
    expect(result.size).toBe(0);
  });

  test("badge match filters on badgeText", () => {
    const result = expectMatched(computeSearchMatchedIds("type:pipeline", nodes, index));
    expect([...result]).toEqual(["a"]);
  });

  test("badge match with empty term returns empty set", () => {
    const result = expectMatched(computeSearchMatchedIds("type:", nodes, index));
    expect(result.size).toBe(0);
  });

  test("badge match can match multiple nodes", () => {
    const result = expectMatched(computeSearchMatchedIds("type:job", nodes, index));
    expect([...result].toSorted()).toEqual(["b", "c"]);
  });

  test("returns empty set when nothing matches", () => {
    const result = expectMatched(computeSearchMatchedIds("nonexistent", nodes, index));
    expect(result.size).toBe(0);
  });

  test("single-char quoted string is not treated as exact match", () => {
    // '"x"' has length 3, which is the minimum for exact mode.
    // '""' (length 2) should fall through to fuzzy.
    const result = expectMatched(computeSearchMatchedIds('""', nodes, index));
    // Fuzzy search for '""' — won't match anything in the index
    expect(result.size).toBe(0);
  });
});
