import { describe, expect, test } from "bun:test";
import type { NodeSearchEntry } from "../../src/utils/node-search-text.ts";
import { matchSearchToken, parseSearchQuery } from "../../src/utils/search-query-parser.ts";

describe("parseSearchQuery", () => {
  test("empty string returns empty array", () => {
    expect(parseSearchQuery("")).toEqual([]);
  });

  test("single fuzzy token", () => {
    expect(parseSearchQuery("ingest")).toEqual([{ kind: "fuzzy", value: "ingest" }]);
  });

  test("exact quoted phrase", () => {
    expect(parseSearchQuery('"ingest pipeline"')).toEqual([
      { kind: "exact", value: "ingest pipeline" },
    ]);
  });

  test("type prefix", () => {
    expect(parseSearchQuery("type:job")).toEqual([{ kind: "type", value: "job" }]);
  });

  test("status prefix", () => {
    expect(parseSearchQuery("status:added")).toEqual([{ kind: "status", value: "added" }]);
  });

  test("combined tokens", () => {
    expect(parseSearchQuery("type:job ingest")).toEqual([
      { kind: "type", value: "job" },
      { kind: "fuzzy", value: "ingest" },
    ]);
  });

  test("empty type: prefix is dropped", () => {
    expect(parseSearchQuery("type:")).toEqual([]);
  });

  test("empty status: prefix is dropped", () => {
    expect(parseSearchQuery("status:")).toEqual([]);
  });

  test("unmatched quote falls through to fuzzy", () => {
    expect(parseSearchQuery('"hello')).toEqual([{ kind: "fuzzy", value: '"hello' }]);
  });

  test('empty quotes ("") fall through to fuzzy', () => {
    expect(parseSearchQuery('""')).toEqual([{ kind: "fuzzy", value: '""' }]);
  });
});

describe("matchSearchToken", () => {
  const entry: NodeSearchEntry = {
    text: "ingest pipeline\0pipeline",
    badgeText: "pipeline",
    label: "ingest pipeline",
    diffState: "added",
  };

  test("fuzzy matches substring in text", () => {
    expect(matchSearchToken({ kind: "fuzzy", value: "ingest" }, entry)).toBe(true);
  });

  test("fuzzy rejects missing substring", () => {
    expect(matchSearchToken({ kind: "fuzzy", value: "transform" }, entry)).toBe(false);
  });

  test("exact matches full label", () => {
    expect(matchSearchToken({ kind: "exact", value: "ingest pipeline" }, entry)).toBe(true);
  });

  test("exact rejects partial label", () => {
    expect(matchSearchToken({ kind: "exact", value: "ingest" }, entry)).toBe(false);
  });

  test("type matches badge text", () => {
    expect(matchSearchToken({ kind: "type", value: "pipeline" }, entry)).toBe(true);
  });

  test("type rejects missing badge", () => {
    expect(matchSearchToken({ kind: "type", value: "job" }, entry)).toBe(false);
  });

  test("status matches diffState", () => {
    expect(matchSearchToken({ kind: "status", value: "added" }, entry)).toBe(true);
  });

  test("status rejects wrong diffState", () => {
    expect(matchSearchToken({ kind: "status", value: "removed" }, entry)).toBe(false);
  });
});
