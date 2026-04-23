import type { DiffState } from "./diff-state.ts";
import type { ChangeDesc } from "./plan-schema.ts";

type TaskChangeSummaryEntry = {
  readonly taskKey: string;
  readonly diffState: DiffState;
  readonly isDrift: boolean;
};

export type TaskChangeSummary = readonly TaskChangeSummaryEntry[];

export type NodeKind = "job" | "task" | "resource" | "root" | "phantom";

/** Fields shared across all node kinds (composed via intersection, not inheritance). */
type BaseGraphNode = {
  readonly id: string;
  readonly label: string;
  readonly diffState: DiffState;
  readonly resourceKey: string;
  readonly changes: Readonly<Record<string, ChangeDesc>> | undefined;
  readonly resourceState: Readonly<Record<string, unknown>> | undefined;
  /** Raw pre-fuse `entry.new_state` — the bundle-side state tree before any fusion
   *  with remote. Scoped to the enclosing plan entry: task nodes carry the parent
   *  job's state because their change keys (`tasks[task_key='X'].depends_on[...]`)
   *  are rooted at the job level. Consumed by `extractListElementSemantic` to
   *  disambiguate per-element list changes (dagshund-1naj). Must stay pre-fuse —
   *  the list-element algorithm needs the two sources separate. */
  readonly newState: unknown;
  /** Raw pre-fuse `entry.remote_state` — the server-side state tree. See `newState`. */
  readonly remoteState: unknown;
  /** Whether the enclosing plan entry has shape-based field drift anywhere
   *  (`old == new != remote` on any change). Gates the reclassification of
   *  list-element-delete entries as drift (dagshund-1naj). Computed at
   *  graph-build time over the full `entry.changes`, so task nodes inherit
   *  the parent job's flag — matches Python's behavior. */
  readonly resourceHasShapeDrift: boolean;
};

export type JobGraphNode = BaseGraphNode & {
  readonly nodeKind: "job";
  readonly taskChangeSummary: TaskChangeSummary | undefined;
  readonly isDrift?: boolean;
};

export type TaskGraphNode = BaseGraphNode & {
  readonly nodeKind: "task";
  readonly taskKey: string;
  readonly isDrift?: boolean;
};

export type ResourceGraphNode = BaseGraphNode & {
  readonly nodeKind: "resource";
  /** Present only for job resources; undefined for all other resource types. */
  readonly taskChangeSummary: TaskChangeSummary | undefined;
  readonly isDrift?: boolean;
};

export type RootGraphNode = BaseGraphNode & {
  readonly nodeKind: "root";
};

export type PhantomGraphNode = BaseGraphNode & {
  readonly nodeKind: "phantom";
};

export type GraphNode =
  | JobGraphNode
  | TaskGraphNode
  | ResourceGraphNode
  | RootGraphNode
  | PhantomGraphNode;

export type EdgeDiffState = "added" | "removed" | "unchanged";

/** Map a DiffState to an EdgeDiffState (edges have no "modified" state). */
export const toEdgeDiffState = (state: DiffState): EdgeDiffState =>
  state === "added" || state === "removed" ? state : "unchanged";

export type GraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string | undefined;
  readonly diffState: EdgeDiffState;
};

/** Build a GraphEdge with standard ID format (optional prefix for namespacing). */
export const buildGraphEdge = (
  source: string,
  target: string,
  diffState: EdgeDiffState = "unchanged",
  idPrefix = "",
): GraphEdge => ({
  id: `${idPrefix}${source}→${target}`,
  source,
  target,
  label: undefined,
  diffState,
});

/** Build a unique edge, returning undefined if source === target (self-loop guard). */
export const buildEdge = (
  source: string,
  target: string,
  diffState: GraphEdge["diffState"] = "unchanged",
): GraphEdge | undefined =>
  source === target ? undefined : buildGraphEdge(source, target, diffState);

/** Filter defined edges from buildEdge results. */
export const filterDefinedEdges = (
  edges: readonly (GraphEdge | undefined)[],
): readonly GraphEdge[] => edges.filter((edge): edge is GraphEdge => edge !== undefined);

export type PlanGraph = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

/** Distributive Omit that preserves discriminated unions. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Data payload carried by each React Flow node (produced by toReactFlowNode). */
export type DagNodeData = DistributiveOmit<GraphNode, "id">;
