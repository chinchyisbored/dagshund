import type { DiffState } from "./diff-state.ts";
import type { ChangeDesc } from "./plan-schema.ts";

export type TaskChangeSummaryEntry = {
  readonly taskKey: string;
  readonly diffState: DiffState;
};

export type TaskChangeSummary = readonly TaskChangeSummaryEntry[];

export type NodeKind = "job" | "task" | "resource" | "resource-group";

/** Fields shared across all node kinds (composed via intersection, not inheritance). */
type BaseGraphNode = {
  readonly id: string;
  readonly label: string;
  readonly diffState: DiffState;
  readonly resourceKey: string;
  readonly changes: Readonly<Record<string, ChangeDesc>> | undefined;
  readonly resourceState: Readonly<Record<string, unknown>> | undefined;
};

export type JobGraphNode = BaseGraphNode & {
  readonly nodeKind: "job";
  readonly taskChangeSummary: TaskChangeSummary | undefined;
};

export type TaskGraphNode = BaseGraphNode & {
  readonly nodeKind: "task";
  readonly taskKey: string;
};

export type ResourceGraphNode = BaseGraphNode & {
  readonly nodeKind: "resource";
  /** Present only for job resources; undefined for all other resource types. */
  readonly taskChangeSummary: TaskChangeSummary | undefined;
};

export type ResourceGroupGraphNode = BaseGraphNode & {
  readonly nodeKind: "resource-group";
  readonly external: boolean;
};

export type GraphNode = JobGraphNode | TaskGraphNode | ResourceGraphNode | ResourceGroupGraphNode;

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
  /** Present only on sync edges (synced_database_table → UC phantom table). Absent = hierarchy. */
  readonly edgeKind?: "sync";
};

export type PlanGraph = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

/** Distributive Omit that preserves discriminated unions. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Data payload carried by each React Flow node (produced by toReactFlowNode). */
export type DagNodeData = DistributiveOmit<GraphNode, "id">;
