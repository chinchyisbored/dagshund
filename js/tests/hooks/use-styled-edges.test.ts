import { describe, expect, test } from "bun:test";
import { renderHook } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import { useStyledEdges } from "../../src/hooks/use-styled-edges.ts";

const makeEdge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
});

const edges: readonly Edge[] = [
  makeEdge("ab", "a", "b"),
  makeEdge("bc", "b", "c"),
  makeEdge("cd", "c", "d"),
];

describe("useStyledEdges", () => {
  test("returns baseEdges unchanged when no interaction state is active", () => {
    const { result } = renderHook(() => useStyledEdges(edges, null, null, null, null, null, null));
    expect(result.current).toBe(edges);
  });

  test("hover: edge touching hovered node gets strokeWidth 2.5 + brightness", () => {
    const connected = new Set(["a", "b"]);
    const { result } = renderHook(() =>
      useStyledEdges(edges, "a", null, connected, null, null, null),
    );
    const ab = result.current.find((e) => e.id === "ab");
    expect(ab?.style).toMatchObject({ strokeWidth: 2.5, filter: "brightness(1.5)" });
  });

  test("hover: edges not touching connected nodes are dimmed to 0.15 opacity", () => {
    const connected = new Set(["a", "b"]);
    const { result } = renderHook(() =>
      useStyledEdges(edges, "a", null, connected, null, null, null),
    );
    const cd = result.current.find((e) => e.id === "cd");
    expect(cd?.style).toMatchObject({ opacity: 0.15 });
  });

  test("filter: edges touching matched nodes keep base style; others dim", () => {
    const matched = new Set(["b"]);
    const { result } = renderHook(() =>
      useStyledEdges(edges, null, null, null, null, matched, null),
    );
    const ab = result.current.find((e) => e.id === "ab");
    const cd = result.current.find((e) => e.id === "cd");
    expect(ab?.style).toEqual({});
    expect(cd?.style).toMatchObject({ opacity: 0.15 });
  });

  test("lateral isolation: edges fully inside isolated set keep base style", () => {
    const isolated = new Set(["a", "b"]);
    const { result } = renderHook(() =>
      useStyledEdges(edges, null, null, null, null, null, isolated),
    );
    const ab = result.current.find((e) => e.id === "ab");
    const bc = result.current.find((e) => e.id === "bc");
    expect(ab?.style).toEqual({});
    expect(bc?.style).toMatchObject({ opacity: 0.15 });
  });

  test("selection: direct edge thickens, between-connected preserved, others dim to 0.3", () => {
    const selectedConnected = new Set(["a", "b"]);
    const { result } = renderHook(() =>
      useStyledEdges(edges, null, "a", null, selectedConnected, null, null),
    );
    const ab = result.current.find((e) => e.id === "ab");
    const cd = result.current.find((e) => e.id === "cd");
    expect(ab?.style).toMatchObject({ strokeWidth: 2.5 });
    expect(cd?.style).toMatchObject({ opacity: 0.3 });
  });
});
