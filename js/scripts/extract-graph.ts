/**
 * Extract a deterministic structural summary of a plan's graphs for golden testing.
 *
 * Usage:
 *   bun run js/scripts/extract-graph.ts <path-to-plan.json>
 *
 * Writes JSON to stdout. Deterministic: identical inputs produce identical outputs,
 * arrays sorted, pretty-printed with 2-space indent for human review in diffs.
 */

import { buildPlanGraph } from "../src/graph/build-plan-graph.ts";
import { buildResourceGraph } from "../src/graph/build-resource-graph.ts";
import { parsePlanJson } from "../src/parser/parse-plan.ts";
import type { GraphEdge, GraphNode } from "../src/types/graph-types.ts";

type NodeCounts = {
  readonly total: number;
  readonly by_kind: Readonly<Record<string, number>>;
};

const countNodesByKind = (nodes: readonly GraphNode[]): NodeCounts => {
  const by_kind: Record<string, number> = {};
  for (const node of nodes) {
    by_kind[node.nodeKind] = (by_kind[node.nodeKind] ?? 0) + 1;
  }
  return { total: nodes.length, by_kind };
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortLaterals = (edges: readonly GraphEdge[]) =>
  [...edges]
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      diffState: edge.diffState,
    }))
    .sort((a, b) => compareStrings(a.source, b.source) || compareStrings(a.target, b.target));

const sortPhantoms = (nodes: readonly GraphNode[]) =>
  nodes
    .filter((node) => node.nodeKind === "phantom")
    .map((node) => ({
      id: node.id,
      label: node.label,
      resourceKey: node.resourceKey,
    }))
    .sort((a, b) => compareStrings(a.id, b.id));

const main = async (): Promise<void> => {
  const planPath = process.argv[2];
  if (planPath === undefined) {
    console.error("Usage: bun run js/scripts/extract-graph.ts <path-to-plan.json>");
    process.exit(2);
  }

  const text = await Bun.file(planPath).text();
  const result = parsePlanJson(JSON.parse(text));
  if (!result.ok) {
    console.error(`Failed to parse plan: ${result.error}`);
    process.exit(1);
  }

  const plan = result.data;
  const planGraph = buildPlanGraph(plan);
  const resourceGraph = buildResourceGraph(plan);

  const output = {
    plan_graph: {
      nodes: countNodesByKind(planGraph.nodes),
      edges: { total: planGraph.edges.length },
    },
    resource_graph: {
      nodes: countNodesByKind(resourceGraph.nodes),
      edges: {
        total: resourceGraph.edges.length + resourceGraph.lateralEdges.length,
        dag: resourceGraph.edges.length,
        lateral: resourceGraph.lateralEdges.length,
      },
      laterals: sortLaterals(resourceGraph.lateralEdges),
      phantoms: sortPhantoms(resourceGraph.nodes),
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
};

await main();
