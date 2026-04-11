/**
 * Extract a deterministic structural summary of a plan's graphs for golden testing.
 *
 * Usage:
 *   bun run js/scripts/extract-graph.ts <path-to-plan.json>
 *
 * Writes JSON to stdout. Deterministic: identical inputs produce identical outputs,
 * arrays sorted. The output is NOT optimized for human readability — it is a
 * structural dump for regression testing via diff. The only consumer is
 * fixtures/tooling/generate_expected.sh (generate / check).
 */

import { buildPlanGraph } from "../src/graph/build-plan-graph.ts";
import { buildResourceGraph } from "../src/graph/build-resource-graph.ts";
import { parsePlanJson } from "../src/parser/parse-plan.ts";
import type { DiffState } from "../src/types/diff-state.ts";
import type {
  EdgeDiffState,
  GraphEdge,
  GraphNode,
  NodeKind,
  TaskChangeSummary,
} from "../src/types/graph-types.ts";
import type { ActionType } from "../src/types/plan-schema.ts";

// Mirrors the prefix used in extract-lateral-edges.ts when building lateral
// edge ids. Local to this script because that module does not export the
// prefix as a constant. If the prefix changes there, it must change here too.
const LATERAL_PREFIX = "lateral::" as const;

type EdgeKind = "dag" | "lateral";

type NodeDiffStateCounts = Readonly<Record<DiffState, number>>;
type EdgeDiffStateCounts = Readonly<Record<EdgeDiffState, number>>;
type NodeKindCounts = Readonly<Record<NodeKind, number>>;
type EdgeKindCounts = Readonly<Record<EdgeKind, number>>;
type NodeKindAndDiffStateCounts = Readonly<Record<NodeKind, NodeDiffStateCounts>>;
type EdgeKindAndDiffStateCounts = Readonly<Record<EdgeKind, EdgeDiffStateCounts>>;

type NodeChangeSummary = {
  readonly key: string;
  readonly action: ActionType;
};

type NodeEntry = {
  readonly id: string;
  readonly resourceKey: string;
  readonly label: string;
  readonly kind: NodeKind;
  readonly diffState: DiffState;
  readonly isDrift: boolean;
  readonly changes: readonly NodeChangeSummary[];
  readonly hasResourceState: boolean;
  readonly taskChangeSummary: TaskChangeSummary;
};

type EdgeEntry = {
  readonly source: string;
  readonly target: string;
  readonly diffState: EdgeDiffState;
  readonly kind: EdgeKind;
};

type NodeCounts = {
  readonly total: number;
  readonly by_kind: NodeKindCounts;
  readonly by_diff_state: NodeDiffStateCounts;
  readonly by_kind_and_diff_state: NodeKindAndDiffStateCounts;
  readonly drift_count: number;
  readonly drift_by_kind: NodeKindCounts;
  readonly drift_by_diff_state: NodeDiffStateCounts;
  readonly total_change_entries: number;
  readonly with_resource_state: number;
  readonly task_change_summary_total: number;
  readonly entries: readonly NodeEntry[];
};

type EdgeCounts = {
  readonly total: number;
  readonly by_kind: EdgeKindCounts;
  readonly by_diff_state: EdgeDiffStateCounts;
  readonly by_kind_and_diff_state: EdgeKindAndDiffStateCounts;
  readonly entries: readonly EdgeEntry[];
};

// Pre-filled zeroed templates keep the schema stable across fixtures so diffs
// only show real classification changes, not key appearance/disappearance.
const emptyNodeKindCounts = (): Record<NodeKind, number> => ({
  job: 0,
  task: 0,
  resource: 0,
  root: 0,
  phantom: 0,
});

const emptyEdgeKindCounts = (): Record<EdgeKind, number> => ({
  dag: 0,
  lateral: 0,
});

const emptyNodeDiffStateCounts = (): Record<DiffState, number> => ({
  added: 0,
  removed: 0,
  modified: 0,
  unchanged: 0,
  unknown: 0,
});

const emptyEdgeDiffStateCounts = (): Record<EdgeDiffState, number> => ({
  added: 0,
  removed: 0,
  unchanged: 0,
});

const emptyNodeKindAndDiffStateCounts = (): Record<NodeKind, Record<DiffState, number>> => ({
  job: emptyNodeDiffStateCounts(),
  task: emptyNodeDiffStateCounts(),
  resource: emptyNodeDiffStateCounts(),
  root: emptyNodeDiffStateCounts(),
  phantom: emptyNodeDiffStateCounts(),
});

const emptyEdgeKindAndDiffStateCounts = (): Record<EdgeKind, Record<EdgeDiffState, number>> => ({
  dag: emptyEdgeDiffStateCounts(),
  lateral: emptyEdgeDiffStateCounts(),
});

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// isDrift only exists on job/task/resource node kinds; root/phantom never drift.
const nodeHasDrift = (node: GraphNode): boolean =>
  "isDrift" in node && node.isDrift === true;

const edgeKind = (edge: GraphEdge): EdgeKind =>
  edge.id.startsWith(LATERAL_PREFIX) ? "lateral" : "dag";

const summarizeNodeChanges = (node: GraphNode): readonly NodeChangeSummary[] =>
  Object.entries(node.changes ?? {})
    .map(([key, desc]) => ({ key, action: desc.action }))
    .sort((a, b) => compareStrings(a.key, b.key));

const extractTaskChangeSummary = (node: GraphNode): TaskChangeSummary =>
  "taskChangeSummary" in node && node.taskChangeSummary !== undefined
    ? node.taskChangeSummary
    : [];

const summarizeNode = (node: GraphNode): NodeEntry => ({
  id: node.id,
  resourceKey: node.resourceKey,
  label: node.label,
  kind: node.nodeKind,
  diffState: node.diffState,
  isDrift: nodeHasDrift(node),
  changes: summarizeNodeChanges(node),
  hasResourceState: node.resourceState !== undefined,
  taskChangeSummary: extractTaskChangeSummary(node),
});

const summarizeEdge = (edge: GraphEdge): EdgeEntry => ({
  source: edge.source,
  target: edge.target,
  diffState: edge.diffState,
  kind: edgeKind(edge),
});

const compareNodeEntries = (a: NodeEntry, b: NodeEntry): number => compareStrings(a.id, b.id);

const compareEdgeEntries = (a: EdgeEntry, b: EdgeEntry): number =>
  compareStrings(a.kind, b.kind) ||
  compareStrings(a.source, b.source) ||
  compareStrings(a.target, b.target);

const countNodes = (nodes: readonly GraphNode[]): NodeCounts => {
  const entries = nodes.map(summarizeNode).sort(compareNodeEntries);

  const by_kind = emptyNodeKindCounts();
  const by_diff_state = emptyNodeDiffStateCounts();
  const by_kind_and_diff_state = emptyNodeKindAndDiffStateCounts();
  const drift_by_kind = emptyNodeKindCounts();
  const drift_by_diff_state = emptyNodeDiffStateCounts();
  let drift_count = 0;
  let total_change_entries = 0;
  let with_resource_state = 0;
  let task_change_summary_total = 0;

  for (const entry of entries) {
    by_kind[entry.kind] += 1;
    by_diff_state[entry.diffState] += 1;
    by_kind_and_diff_state[entry.kind][entry.diffState] += 1;

    if (entry.isDrift) {
      drift_count += 1;
      drift_by_kind[entry.kind] += 1;
      drift_by_diff_state[entry.diffState] += 1;
    }

    total_change_entries += entry.changes.length;
    if (entry.hasResourceState) with_resource_state += 1;
    task_change_summary_total += entry.taskChangeSummary.length;
  }

  return {
    total: entries.length,
    by_kind,
    by_diff_state,
    by_kind_and_diff_state,
    drift_count,
    drift_by_kind,
    drift_by_diff_state,
    total_change_entries,
    with_resource_state,
    task_change_summary_total,
    entries,
  };
};

const countEdges = (edges: readonly GraphEdge[]): EdgeCounts => {
  const entries = edges.map(summarizeEdge).sort(compareEdgeEntries);

  const by_kind = emptyEdgeKindCounts();
  const by_diff_state = emptyEdgeDiffStateCounts();
  const by_kind_and_diff_state = emptyEdgeKindAndDiffStateCounts();

  for (const entry of entries) {
    by_kind[entry.kind] += 1;
    by_diff_state[entry.diffState] += 1;
    by_kind_and_diff_state[entry.kind][entry.diffState] += 1;
  }

  return {
    total: entries.length,
    by_kind,
    by_diff_state,
    by_kind_and_diff_state,
    entries,
  };
};

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
  const allResourceEdges = [...resourceGraph.edges, ...resourceGraph.lateralEdges];

  const output = {
    plan_graph: {
      nodes: countNodes(planGraph.nodes),
      edges: countEdges(planGraph.edges),
    },
    resource_graph: {
      nodes: countNodes(resourceGraph.nodes),
      edges: countEdges(allResourceEdges),
      phantoms: sortPhantoms(resourceGraph.nodes),
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
};

await main();
