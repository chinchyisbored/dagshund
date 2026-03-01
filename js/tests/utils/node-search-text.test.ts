import { describe, expect, test } from "bun:test";
import type { DagNodeData } from "../../src/types/graph-types.ts";
import { extractNodeSearchText } from "../../src/utils/node-search-text.ts";

const makeTaskNode = (
  label: string,
  resourceState?: Readonly<Record<string, unknown>>,
): DagNodeData => ({
  nodeKind: "task",
  label,
  diffState: "modified",
  resourceKey: "resources.jobs.etl_pipeline",
  taskKey: "extract",
  changes: undefined,
  resourceState: resourceState ?? undefined,
});

const makeJobNode = (label: string): DagNodeData => ({
  nodeKind: "job",
  label,
  diffState: "unchanged",
  resourceKey: "resources.jobs.etl_pipeline",
  changes: undefined,
  resourceState: undefined,
  taskChangeSummary: undefined,
});

const makePhantomNode = (label: string, resourceKey: string): DagNodeData => ({
  nodeKind: "phantom",
  label,
  diffState: "unchanged",
  resourceKey,
  changes: undefined,
  resourceState: undefined,
});

const makeResourceNode = (label: string, resourceKey: string): DagNodeData => ({
  nodeKind: "resource",
  label,
  diffState: "added",
  resourceKey,
  changes: undefined,
  resourceState: undefined,
  taskChangeSummary: undefined,
});

describe("extractNodeSearchText", () => {
  test("includes label in text and label fields", () => {
    const result = extractNodeSearchText(makeJobNode("ETL Pipeline"));

    expect(result.label).toBe("etl pipeline");
    expect(result.text).toContain("etl pipeline");
  });

  test("lowercases all fields", () => {
    const result = extractNodeSearchText(makeTaskNode("Extract", { notebook_task: {} }));

    expect(result.text).toBe(result.text.toLowerCase());
    expect(result.badgeText).toBe(result.badgeText.toLowerCase());
    expect(result.label).toBe(result.label.toLowerCase());
    expect(result.diffState).toBe(result.diffState.toLowerCase());
  });

  test("includes type badge for resource nodes", () => {
    const result = extractNodeSearchText(
      makeResourceNode("analytics", "resources.schemas.analytics"),
    );

    expect(result.badgeText).toContain("schema");
    expect(result.text).toContain("schema");
  });

  test("includes phantom badge for phantom nodes with :: prefix", () => {
    const result = extractNodeSearchText(makePhantomNode("main", "catalog::main"));

    expect(result.badgeText).toContain("catalog");
    expect(result.text).toContain("catalog");
  });

  test("includes task type badge for task nodes with known task type", () => {
    const result = extractNodeSearchText(makeTaskNode("extract", { notebook_task: {} }));

    expect(result.badgeText).toContain("notebook");
    expect(result.text).toContain("notebook");
  });

  test("includes both type and task type badges for task nodes", () => {
    const result = extractNodeSearchText(makeTaskNode("extract", { notebook_task: {} }));

    expect(result.badgeText).toContain("job");
    expect(result.badgeText).toContain("notebook");
  });

  test("includes type badge for job nodes from resource key", () => {
    const result = extractNodeSearchText(makeJobNode("pipeline"));

    expect(result.badgeText).toContain("job");
  });

  test("preserves diffState from node data", () => {
    const result = extractNodeSearchText(makeTaskNode("extract"));

    expect(result.diffState).toBe("modified");
  });

  test("returns empty badgeText when task has no recognizable task type", () => {
    const result = extractNodeSearchText(makeTaskNode("extract", { some_unknown_field: true }));

    // type badge "job" should still be present from the resource key
    expect(result.badgeText).toContain("job");
  });

  test("phantom node with schema:: prefix gets schema badge", () => {
    const result = extractNodeSearchText(makePhantomNode("default", "schema::default"));

    expect(result.badgeText).toContain("schema");
  });

  test("phantom node with source-table:: prefix gets table badge", () => {
    const result = extractNodeSearchText(makePhantomNode("users", "source-table::users"));

    expect(result.badgeText).toContain("table");
  });
});
