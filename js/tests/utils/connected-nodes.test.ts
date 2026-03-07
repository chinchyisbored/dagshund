import { describe, expect, test } from "bun:test";
import type { Edge, Node } from "@xyflow/react";
import {
  buildConnectedNodeIds,
  resolveLateralContext,
  resolvePhantomContext,
} from "../../src/utils/connected-nodes.ts";

const makeNode = (
  id: string,
  overrides: Record<string, unknown> & { parentId?: string } = {},
): Node => ({
  id,
  position: { x: 0, y: 0 },
  parentId: overrides.parentId,
  data: {
    nodeKind: "task",
    label: id,
    diffState: "unchanged",
    resourceKey: `resources.jobs.${id}`,
    taskKey: id,
    changes: undefined,
    resourceState: undefined,
    ...overrides,
  },
});

const makeEdge = (source: string, target: string, id?: string): Edge => ({
  id: id ?? `${source}→${target}`,
  source,
  target,
});

describe("buildConnectedNodeIds", () => {
  test("includes the target node itself", () => {
    const result = buildConnectedNodeIds([], [], "a");

    expect(result.has("a")).toBe(true);
    expect(result.size).toBe(1);
  });

  test("includes nodes connected by outgoing edges", () => {
    const edges = [makeEdge("a", "b"), makeEdge("a", "c")];

    const result = buildConnectedNodeIds([], edges, "a");

    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(true);
  });

  test("includes nodes connected by incoming edges", () => {
    const edges = [makeEdge("x", "a"), makeEdge("y", "a")];

    const result = buildConnectedNodeIds([], edges, "a");

    expect(result.has("x")).toBe(true);
    expect(result.has("y")).toBe(true);
  });

  test("includes child nodes (parentId match)", () => {
    const nodes = [
      makeNode("child1", { parentId: "parent" }),
      makeNode("child2", { parentId: "parent" }),
    ];

    const result = buildConnectedNodeIds(nodes, [], "parent");

    expect(result.has("child1")).toBe(true);
    expect(result.has("child2")).toBe(true);
  });

  test("does not include unrelated nodes", () => {
    const nodes = [makeNode("other")];
    const edges = [makeEdge("x", "y")];

    const result = buildConnectedNodeIds(nodes, edges, "a");

    expect(result.has("other")).toBe(false);
    expect(result.has("x")).toBe(false);
    expect(result.has("y")).toBe(false);
  });

  test("combines edge connections and child nodes", () => {
    const nodes = [makeNode("child", { parentId: "a" })];
    const edges = [makeEdge("a", "neighbor")];

    const result = buildConnectedNodeIds(nodes, edges, "a");

    expect(result.has("a")).toBe(true);
    expect(result.has("child")).toBe(true);
    expect(result.has("neighbor")).toBe(true);
    expect(result.size).toBe(3);
  });
});

describe("resolvePhantomContext", () => {
  test("returns undefined when no related edges exist", () => {
    const result = resolvePhantomContext("phantom", [], []);

    expect(result).toBeUndefined();
  });

  test("resolves hierarchy phantom from outgoing edges (children)", () => {
    const nodes = [
      makeNode("phantom"),
      makeNode("child1", {
        nodeKind: "resource",
        label: "analytics",
        resourceKey: "resources.schemas.analytics",
      }),
    ];
    const edges = [makeEdge("phantom", "child1")];

    const result = resolvePhantomContext("phantom", nodes, edges);

    expect(result).toBeDefined();
    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0]?.label).toBe("analytics");
    expect(result?.sources[0]?.resourceKey).toBe("resources.schemas.analytics");
    expect(result?.sources[0]?.resourceType).toBe("schema");
  });

  test("resolves leaf phantom from incoming lateral edges", () => {
    const nodes = [
      makeNode("phantom"),
      makeNode("source1", {
        nodeKind: "resource",
        label: "sync_table",
        resourceKey: "resources.synced_database_tables.sync_table",
      }),
    ];
    const edges = [makeEdge("source1", "phantom", "lateral::source1→phantom")];

    const result = resolvePhantomContext("phantom", nodes, edges);

    expect(result).toBeDefined();
    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0]?.label).toBe("sync_table");
  });

  test("prefers hierarchy (outgoing edges) over lateral edges", () => {
    const nodes = [
      makeNode("phantom"),
      makeNode("child", {
        nodeKind: "resource",
        label: "child_res",
        resourceKey: "resources.schemas.child",
      }),
      makeNode("lateral_src", {
        nodeKind: "resource",
        label: "lat_res",
        resourceKey: "resources.jobs.lat",
      }),
    ];
    const edges = [
      makeEdge("phantom", "child"),
      makeEdge("lateral_src", "phantom", "lateral::lat→phantom"),
    ];

    const result = resolvePhantomContext("phantom", nodes, edges);

    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0]?.label).toBe("child_res");
  });

  test("collects multiple children for hierarchy phantom", () => {
    const nodes = [
      makeNode("phantom"),
      makeNode("c1", {
        nodeKind: "resource",
        label: "table_a",
        resourceKey: "resources.schemas.table_a",
      }),
      makeNode("c2", {
        nodeKind: "resource",
        label: "table_b",
        resourceKey: "resources.schemas.table_b",
      }),
    ];
    const edges = [makeEdge("phantom", "c1"), makeEdge("phantom", "c2")];

    const result = resolvePhantomContext("phantom", nodes, edges);

    expect(result?.sources).toHaveLength(2);
    const labels = result?.sources.map((s) => s.label);
    expect(labels).toContain("table_a");
    expect(labels).toContain("table_b");
  });

  test("ignores non-lateral incoming edges for leaf phantom resolution", () => {
    const nodes = [
      makeNode("phantom"),
      makeNode("parent", {
        nodeKind: "job",
        label: "parent_job",
        resourceKey: "resources.jobs.parent",
      }),
    ];
    // hierarchy edge going INTO the phantom (not from it) — not a child, not lateral
    const edges = [makeEdge("parent", "phantom")];

    const result = resolvePhantomContext("phantom", nodes, edges);

    // No outgoing edges (no children), and the incoming edge is not lateral
    expect(result).toBeUndefined();
  });
});

describe("resolveLateralContext", () => {
  test("returns undefined when no lateral edges exist", () => {
    const result = resolveLateralContext("a", [], []);

    expect(result).toBeUndefined();
  });

  test("returns undefined when edges exist but none are lateral", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("a", "b")];

    const result = resolveLateralContext("a", nodes, edges);

    expect(result).toBeUndefined();
  });

  test("resolves depends-on from outgoing lateral edges", () => {
    const nodes = [
      makeNode("a", {
        nodeKind: "resource",
        label: "my_job",
        resourceKey: "resources.jobs.my_job",
      }),
      makeNode("b", {
        nodeKind: "resource",
        label: "my_schema",
        resourceKey: "resources.schemas.my_schema",
      }),
    ];
    const edges = [makeEdge("a", "b", "lateral::a→b")];

    const result = resolveLateralContext("a", nodes, edges);

    expect(result).toBeDefined();
    expect(result?.dependsOn).toHaveLength(1);
    expect(result?.dependsOn[0]?.nodeId).toBe("b");
    expect(result?.dependsOn[0]?.label).toBe("my_schema");
    expect(result?.dependsOn[0]?.resourceKey).toBe("resources.schemas.my_schema");
    expect(result?.dependsOn[0]?.resourceType).toBe("schema");
    expect(result?.dependedOnBy).toHaveLength(0);
  });

  test("resolves depended-on-by from incoming lateral edges", () => {
    const nodes = [
      makeNode("a", {
        nodeKind: "resource",
        label: "target_res",
        resourceKey: "resources.schemas.target",
      }),
      makeNode("b", {
        nodeKind: "resource",
        label: "source_res",
        resourceKey: "resources.jobs.source",
      }),
    ];
    const edges = [makeEdge("b", "a", "lateral::b→a")];

    const result = resolveLateralContext("a", nodes, edges);

    expect(result).toBeDefined();
    expect(result?.dependsOn).toHaveLength(0);
    expect(result?.dependedOnBy).toHaveLength(1);
    expect(result?.dependedOnBy[0]?.nodeId).toBe("b");
    expect(result?.dependedOnBy[0]?.label).toBe("source_res");
  });

  test("resolves both directions simultaneously", () => {
    const nodes = [
      makeNode("a", {
        nodeKind: "resource",
        label: "center",
        resourceKey: "resources.jobs.center",
      }),
      makeNode("dep", {
        nodeKind: "resource",
        label: "dependency",
        resourceKey: "resources.schemas.dep",
      }),
      makeNode("rev", {
        nodeKind: "resource",
        label: "reverse_dep",
        resourceKey: "resources.jobs.rev",
      }),
    ];
    const edges = [makeEdge("a", "dep", "lateral::a→dep"), makeEdge("rev", "a", "lateral::rev→a")];

    const result = resolveLateralContext("a", nodes, edges);

    expect(result).toBeDefined();
    expect(result?.dependsOn).toHaveLength(1);
    expect(result?.dependsOn[0]?.nodeId).toBe("dep");
    expect(result?.dependedOnBy).toHaveLength(1);
    expect(result?.dependedOnBy[0]?.nodeId).toBe("rev");
  });

  test("filters out edges that reference missing nodes", () => {
    const nodes = [
      makeNode("a", {
        nodeKind: "resource",
        label: "center",
        resourceKey: "resources.jobs.center",
      }),
    ];
    // lateral edge to a node not in the nodes array
    const edges = [makeEdge("a", "missing", "lateral::a→missing")];

    const result = resolveLateralContext("a", nodes, edges);

    // The edge references a missing node, so dependsOn is empty → undefined
    expect(result).toBeUndefined();
  });

  test("includes diffState from node data", () => {
    const nodes = [
      makeNode("a", {
        nodeKind: "resource",
        label: "center",
        resourceKey: "resources.jobs.center",
      }),
      makeNode("dep", {
        nodeKind: "resource",
        label: "added_dep",
        resourceKey: "resources.schemas.dep",
        diffState: "added",
      }),
    ];
    const edges = [makeEdge("a", "dep", "lateral::a→dep")];

    const result = resolveLateralContext("a", nodes, edges);

    expect(result?.dependsOn[0]?.diffState).toBe("added");
  });
});
