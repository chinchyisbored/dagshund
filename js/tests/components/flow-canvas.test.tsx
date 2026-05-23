import { describe, expect, mock, test } from "bun:test";
import { xyflowMockFactory } from "../helpers/xyflow-mock.ts";

mock.module("@xyflow/react", xyflowMockFactory);

const { render } = await import("@testing-library/react");
const { createElement } = await import("react");
const { FlowCanvas } = await import("../../src/components/flow-canvas.tsx");

import type { Edge, Node } from "@xyflow/react";
import type {
  DagNodeData,
  PhantomGraphNode,
  ResourceGraphNode,
  RootGraphNode,
} from "../../src/types/graph-types.ts";
import type { LayoutResult } from "../../src/types/layout-result.ts";

const makeBaseNode = (id: string, label: string): Omit<RootGraphNode, "id" | "nodeKind"> => ({
  label,
  diffState: "unchanged",
  resourceKey: id,
  changes: undefined,
  resourceState: undefined,
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
});

const makeRootNode = (id: string, label: string): Node<DagNodeData> => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    ...makeBaseNode(id, label),
    nodeKind: "root",
  } satisfies Omit<RootGraphNode, "id">,
});

const makePhantomNode = (id: string, label: string): Node<DagNodeData> => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    ...makeBaseNode(id, label),
    nodeKind: "phantom",
  } satisfies Omit<PhantomGraphNode, "id">,
});

const makeResourceNode = (id: string, label: string): Node<DagNodeData> => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    ...makeBaseNode(id, label),
    nodeKind: "resource",
    taskChangeSummary: undefined,
  } satisfies Omit<ResourceGraphNode, "id">,
});

const makeEdge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
});

describe("FlowCanvas phantom filtering", () => {
  test("keeps postgres branch hierarchy phantoms visible by default", () => {
    const layout: LayoutResult = {
      nodes: [
        makeRootNode("postgres-root", "Lakebase"),
        makePhantomNode("postgres-project::phantom-lineage-lakebase", "phantom-lineage-lakebase"),
        makePhantomNode("postgres-branch::phantom-lineage-lakebase/production", "production"),
        makeResourceNode(
          "resources.postgres_branches.external_lineage_branch",
          "external_lineage_branch",
        ),
        makePhantomNode("source-table::origin.data.source_tbl", "source_tbl"),
      ],
      edges: [
        makeEdge("postgres-root", "postgres-project::phantom-lineage-lakebase"),
        makeEdge(
          "postgres-project::phantom-lineage-lakebase",
          "postgres-branch::phantom-lineage-lakebase/production",
        ),
        makeEdge(
          "postgres-project::phantom-lineage-lakebase",
          "resources.postgres_branches.external_lineage_branch",
        ),
        makeEdge("postgres-root", "source-table::origin.data.source_tbl"),
      ],
      lateralEdges: [
        makeEdge(
          "resources.postgres_branches.external_lineage_branch",
          "postgres-branch::phantom-lineage-lakebase/production",
        ),
      ],
    };

    const view = render(
      createElement(FlowCanvas, {
        layoutState: { status: "ready", layout },
        nodeTypes: {},
      }),
    );

    expect(view.getByText("phantom-lineage-lakebase")).toBeDefined();
    expect(view.getByText("production")).toBeDefined();
    expect(view.getByText("external_lineage_branch")).toBeDefined();
    expect(view.queryByText("source_tbl")).toBeNull();
    expect(view.getByText("Inferred leaf nodes (1)")).toBeDefined();
    expect(view.getByText("Lateral dependencies (1)")).toBeDefined();
  });
});
