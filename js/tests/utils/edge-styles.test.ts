import { describe, expect, test } from "bun:test";
import type { Edge } from "@xyflow/react";
import { computeEdgeStyle } from "../../src/utils/edge-styles.ts";

const makeEdge = (source: string, target: string, style?: Record<string, unknown>): Edge => ({
  id: `${source}→${target}`,
  source,
  target,
  ...(style !== undefined ? { style } : {}),
});

describe("computeEdgeStyle", () => {
  test("hover: directly connected edge gets brightness filter", () => {
    const edge = makeEdge("a", "b");
    const connected = new Set(["a", "b"]);

    const result = computeEdgeStyle(edge, "a", null, connected, null, null, null);

    expect(result.style).toHaveProperty("filter", "brightness(1.5)");
    expect(result.style).toHaveProperty("strokeWidth", 2.5);
  });

  test("hover: between-connected edge keeps base style", () => {
    const edge = makeEdge("b", "c");
    const connected = new Set(["a", "b", "c"]);

    const result = computeEdgeStyle(edge, "a", null, connected, null, null, null);

    expect(result.style).not.toHaveProperty("filter");
    expect(result.style).not.toHaveProperty("opacity");
  });

  test("hover: unconnected edge is dimmed", () => {
    const edge = makeEdge("x", "y");
    const connected = new Set(["a", "b"]);

    const result = computeEdgeStyle(edge, "a", null, connected, null, null, null);

    expect(result.style).toHaveProperty("opacity", 0.15);
  });

  test("filter: relevant edge keeps base style", () => {
    const edge = makeEdge("a", "b");
    const matched = new Set(["a"]);

    const result = computeEdgeStyle(edge, null, null, null, null, matched, null);

    expect(result.style).not.toHaveProperty("opacity");
  });

  test("filter: irrelevant edge is dimmed", () => {
    const edge = makeEdge("x", "y");
    const matched = new Set(["a"]);

    const result = computeEdgeStyle(edge, null, null, null, null, matched, null);

    expect(result.style).toHaveProperty("opacity", 0.15);
  });

  test("lateral isolation: touching edge stays visible", () => {
    const edge = makeEdge("a", "b");
    const isolated = new Set(["a", "b"]);

    const result = computeEdgeStyle(edge, null, null, null, null, null, isolated);

    expect(result.style).not.toHaveProperty("opacity");
  });

  test("lateral isolation: non-touching edge is dimmed", () => {
    const edge = makeEdge("x", "y");
    const isolated = new Set(["a", "b"]);

    const result = computeEdgeStyle(edge, null, null, null, null, null, isolated);

    expect(result.style).toHaveProperty("opacity", 0.15);
  });

  test("selection: directly connected edge gets thicker stroke", () => {
    const edge = makeEdge("a", "b");
    const selected = new Set(["a", "b"]);

    const result = computeEdgeStyle(edge, null, "a", null, selected, null, null);

    expect(result.style).toHaveProperty("strokeWidth", 2.5);
    expect(result.style).not.toHaveProperty("filter");
  });

  test("selection: unconnected edge is dimmed at 0.3", () => {
    const edge = makeEdge("x", "y");
    const selected = new Set(["a", "b"]);

    const result = computeEdgeStyle(edge, null, "a", null, selected, null, null);

    expect(result.style).toHaveProperty("opacity", 0.3);
  });

  test("hover takes priority over filter", () => {
    const edge = makeEdge("a", "b");
    const connected = new Set(["a", "b"]);
    const matched = new Set(["x"]);

    const result = computeEdgeStyle(edge, "a", null, connected, null, matched, null);

    expect(result.style).toHaveProperty("filter", "brightness(1.5)");
  });

  test("no interaction preserves base style", () => {
    const edge = makeEdge("a", "b", { stroke: "red" });

    const result = computeEdgeStyle(edge, null, null, null, null, null, null);

    expect(result.style).toEqual({ stroke: "red" });
  });
});
