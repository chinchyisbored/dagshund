import { describe, expect, test } from "bun:test";
import { buildPlanGraph } from "../../src/graph/build-plan-graph.ts";
import { buildResourceGraph } from "../../src/graph/build-resource-graph.ts";
import type { GraphNode } from "../../src/types/graph-types.ts";
import { loadFixture } from "../helpers/load-fixture.ts";

const findNode = (nodes: readonly GraphNode[], id: string): GraphNode | undefined =>
  nodes.find((n) => n.id === id);

const findByLabel = (nodes: readonly GraphNode[], label: string): GraphNode | undefined =>
  nodes.find((n) => n.label === label);

/**
 * Helper: read `isDrift` off a node without widening the type of every caller.
 * Task/job/resource nodes carry `isDrift?: boolean`; root/phantom do not.
 */
const readIsDrift = (node: GraphNode | undefined): boolean | undefined => {
  if (node === undefined) return undefined;
  if (node.nodeKind === "task" || node.nodeKind === "job" || node.nodeKind === "resource") {
    return node.isDrift;
  }
  return undefined;
};

describe("manual-drift fixture — topology drift detection", () => {
  describe("plan graph (jobs → tasks)", () => {
    test("transform task has isDrift === true AND diffState === 'added'", async () => {
      const plan = await loadFixture("manual-drift");
      const graph = buildPlanGraph(plan);

      const transform = findByLabel(graph.nodes, "transform");
      expect(transform).toBeDefined();
      expect(transform?.nodeKind).toBe("task");
      expect(readIsDrift(transform)).toBe(true);
      // Whole-task topology drift re-entry: the task is missing from the remote
      // and will be recreated on apply, so diffState is "added". The drift pill
      // distinguishes it from a brand-new user-authored task.
      expect(transform?.diffState).toBe("added");
    });

    test("drift_pipeline job has isDrift === true (aggregate signal)", async () => {
      const plan = await loadFixture("manual-drift");
      const graph = buildPlanGraph(plan);

      const job = findNode(graph.nodes, "resources.jobs.drift_pipeline");
      expect(job).toBeDefined();
      expect(job?.nodeKind).toBe("job");
      expect(readIsDrift(job)).toBe(true);
    });

    test("ingest has isDrift falsy; publish has isDrift === true (field-level drift)", async () => {
      const plan = await loadFixture("manual-drift");
      const graph = buildPlanGraph(plan);

      const ingest = findByLabel(graph.nodes, "ingest");
      const publish = findByLabel(graph.nodes, "publish");
      expect(ingest?.nodeKind).toBe("task");
      expect(publish?.nodeKind).toBe("task");
      expect(readIsDrift(ingest)).toBeFalsy();
      // publish carries field-level drift: edit_mode EDITABLE (bundle) vs
      // UI_LOCKED (remote). isDrift is the union of topology and field drift.
      expect(readIsDrift(publish)).toBe(true);
    });
  });

  describe("resource graph", () => {
    test("drift_pipeline job resource has isDrift === true", async () => {
      const plan = await loadFixture("manual-drift");
      const { nodes } = buildResourceGraph(plan);

      const job = nodes.find(
        (n) => n.nodeKind === "resource" && n.resourceKey === "resources.jobs.drift_pipeline",
      );
      expect(job).toBeDefined();
      expect(readIsDrift(job)).toBe(true);
    });

    test("drift_grants schema resource has isDrift === true", async () => {
      const plan = await loadFixture("manual-drift");
      const { nodes } = buildResourceGraph(plan);

      const schema = nodes.find(
        (n) => n.nodeKind === "resource" && n.resourceKey === "resources.schemas.drift_grants",
      );
      expect(schema).toBeDefined();
      expect(readIsDrift(schema)).toBe(true);
    });

    test("drift_doomed schema has isDrift falsy (scope limitation — create action)", async () => {
      // Whole top-level resources missing from remote collapse to action: "create"
      // with no remote_state in plan.json, indistinguishable from a brand-new
      // resource. The detector correctly declines to flag this case.
      const plan = await loadFixture("manual-drift");
      const { nodes } = buildResourceGraph(plan);

      const schema = nodes.find(
        (n) => n.nodeKind === "resource" && n.resourceKey === "resources.schemas.drift_doomed",
      );
      expect(schema).toBeDefined();
      expect(readIsDrift(schema)).toBeFalsy();
    });

    test("phantom nodes have isDrift undefined (type-system guarantee)", async () => {
      const plan = await loadFixture("manual-drift");
      const { nodes } = buildResourceGraph(plan);

      const phantoms = nodes.filter((n) => n.nodeKind === "phantom");
      for (const phantom of phantoms) {
        expect(readIsDrift(phantom)).toBeUndefined();
      }
    });
  });

  describe("cross-fixture regression: isDrift stays falsy where no drift shape exists", () => {
    test("all-create fixture has no drifted nodes", async () => {
      const plan = await loadFixture("all-create");
      const { nodes } = buildResourceGraph(plan);
      const drifted = nodes.filter((n) => readIsDrift(n) === true);
      expect(drifted).toHaveLength(0);
    });

    test("mixed-changes fixture has no drifted nodes", async () => {
      const plan = await loadFixture("mixed-changes");
      const { nodes } = buildResourceGraph(plan);
      const drifted = nodes.filter((n) => readIsDrift(n) === true);
      expect(drifted).toHaveLength(0);
    });
  });
});
