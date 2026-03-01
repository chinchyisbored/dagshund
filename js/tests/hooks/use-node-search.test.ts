import { describe, expect, test } from "bun:test";
import { computeSearchMatchedIds } from "../../src/hooks/use-node-search.ts";
import type { NodeSearchEntry } from "../../src/utils/node-search-text.ts";

const buildIndex = (
  entries: ReadonlyArray<
    readonly [id: string, text: string, badgeText: string, label: string, diffState: string]
  >,
): ReadonlyMap<string, NodeSearchEntry> =>
  new Map(
    entries.map(([id, text, badgeText, label, diffState]) => [
      id,
      { text, badgeText, label, diffState },
    ]),
  );

/** Assert the result is non-null and return it for further assertions. */
const expectMatched = (result: ReadonlySet<string> | null): ReadonlySet<string> => {
  expect(result).not.toBeNull();
  return result as ReadonlySet<string>;
};

describe("computeSearchMatchedIds", () => {
  const index = buildIndex([
    ["a", "ingest pipeline\0pipeline", "pipeline", "ingest pipeline", "added"],
    ["b", "transform job\0job", "job", "transform job", "unchanged"],
    ["c", "ingest_loader\0job", "job", "ingest_loader", "modified"],
    ["d", "export pipeline\0pipeline", "pipeline", "export pipeline", "unchanged"],
  ]);

  test("returns null for empty query", () => {
    expect(computeSearchMatchedIds("", index)).toBeNull();
  });

  test("fuzzy matches substring in text", () => {
    const result = expectMatched(computeSearchMatchedIds("ingest", index));
    expect([...result].toSorted()).toEqual(["a", "c"]);
  });

  test("fuzzy match is case-sensitive on pre-lowercased index", () => {
    const result = expectMatched(computeSearchMatchedIds("Ingest", index));
    expect(result.size).toBe(0);
  });

  test("exact match compares full label", () => {
    const result = expectMatched(computeSearchMatchedIds('"ingest pipeline"', index));
    expect([...result]).toEqual(["a"]);
  });

  test("exact match requires full label, not substring", () => {
    const result = expectMatched(computeSearchMatchedIds('"ingest"', index));
    expect(result.size).toBe(0);
  });

  test("badge match filters on badgeText", () => {
    const result = expectMatched(computeSearchMatchedIds("type:pipeline", index));
    expect([...result].toSorted()).toEqual(["a", "d"]);
  });

  test("badge match with empty term returns null", () => {
    expect(computeSearchMatchedIds("type:", index)).toBeNull();
  });

  test("badge match can match multiple nodes", () => {
    const result = expectMatched(computeSearchMatchedIds("type:job", index));
    expect([...result].toSorted()).toEqual(["b", "c"]);
  });

  test("returns empty set when nothing matches", () => {
    const result = expectMatched(computeSearchMatchedIds("nonexistent", index));
    expect(result.size).toBe(0);
  });

  test("empty quotes fall through to fuzzy", () => {
    const result = expectMatched(computeSearchMatchedIds('""', index));
    expect(result.size).toBe(0);
  });

  test("combined: type:job ingest matches only jobs with ingest", () => {
    const result = expectMatched(computeSearchMatchedIds("type:job ingest", index));
    expect([...result]).toEqual(["c"]);
  });

  test("status:added matches only added nodes", () => {
    const result = expectMatched(computeSearchMatchedIds("status:added", index));
    expect([...result]).toEqual(["a"]);
  });

  test("multi-type AND returns empty (nothing is both job and pipeline)", () => {
    const result = expectMatched(computeSearchMatchedIds("type:job type:pipeline", index));
    expect(result.size).toBe(0);
  });

  test("AND of words matches nodes containing both substrings", () => {
    const result = expectMatched(computeSearchMatchedIds("ingest pipeline", index));
    expect([...result]).toEqual(["a"]);
  });

  test("status:unchanged returns unchanged nodes", () => {
    const result = expectMatched(computeSearchMatchedIds("status:unchanged", index));
    expect([...result].toSorted()).toEqual(["b", "d"]);
  });

  test("status:bogus returns empty set", () => {
    const result = expectMatched(computeSearchMatchedIds("status:bogus", index));
    expect(result.size).toBe(0);
  });
});
