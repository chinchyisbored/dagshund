import { describe, expect, test } from "bun:test";
import type { DiffState } from "../../src/types/diff-state.ts";
import { buildGraphEdge, toEdgeDiffState } from "../../src/types/graph-types.ts";

describe("toEdgeDiffState", () => {
  test("preserves added", () => {
    expect(toEdgeDiffState("added")).toBe("added");
  });

  test("preserves removed", () => {
    expect(toEdgeDiffState("removed")).toBe("removed");
  });

  test("maps modified to unchanged", () => {
    expect(toEdgeDiffState("modified")).toBe("unchanged");
  });

  test("preserves unchanged", () => {
    expect(toEdgeDiffState("unchanged")).toBe("unchanged");
  });

  test("maps unknown to unchanged", () => {
    expect(toEdgeDiffState("unknown")).toBe("unchanged");
  });

  test("covers all DiffState values", () => {
    const allStates: readonly DiffState[] = [
      "added",
      "removed",
      "modified",
      "unchanged",
      "unknown",
    ];

    for (const state of allStates) {
      const result = toEdgeDiffState(state);
      expect(["added", "removed", "unchanged"]).toContain(result);
    }
  });
});

describe("buildGraphEdge", () => {
  test("produces correct ID format", () => {
    const edge = buildGraphEdge("a", "b");

    expect(edge.id).toBe("a→b");
  });

  test("sets source and target", () => {
    const edge = buildGraphEdge("src", "tgt");

    expect(edge.source).toBe("src");
    expect(edge.target).toBe("tgt");
  });

  test("defaults diffState to unchanged", () => {
    const edge = buildGraphEdge("a", "b");

    expect(edge.diffState).toBe("unchanged");
  });

  test("accepts explicit diffState", () => {
    const edge = buildGraphEdge("a", "b", "added");

    expect(edge.diffState).toBe("added");
  });

  test("prepends idPrefix to ID", () => {
    const edge = buildGraphEdge("a", "b", "unchanged", "lateral::");

    expect(edge.id).toBe("lateral::a→b");
  });

  test("sets label to undefined", () => {
    const edge = buildGraphEdge("a", "b");

    expect(edge.label).toBeUndefined();
  });
});
