import type { DiffState } from "./diff-state.ts";
import type { ChangeDesc } from "./plan-schema.ts";

export type TaskChangeSummaryEntry = {
  readonly taskKey: string;
  readonly diffState: DiffState;
};

export type TaskChangeSummary = readonly TaskChangeSummaryEntry[];

export type NodeKind = "job" | "task" | "resource" | "resource-group";

export type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly nodeKind: NodeKind;
  readonly diffState: DiffState;
  readonly resourceKey: string;
  readonly taskKey: string | undefined;
  readonly changes: Readonly<Record<string, ChangeDesc>> | undefined;
  readonly resourceState: Readonly<Record<string, unknown>> | undefined;
  readonly taskChangeSummary: TaskChangeSummary | undefined;
};

export type EdgeDiffState = "added" | "removed" | "unchanged";

export type GraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string | undefined;
  readonly diffState: EdgeDiffState;
};

export type PlanGraph = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

/** Data payload carried by each React Flow node (produced by toReactFlowNode). */
export type DagNodeData = {
  readonly label: string;
  readonly diffState: DiffState;
  readonly nodeKind: NodeKind;
  readonly resourceKey: string;
  readonly taskKey: string | undefined;
  readonly changes: Readonly<Record<string, ChangeDesc>> | undefined;
  readonly resourceState: Readonly<Record<string, unknown>> | undefined;
  readonly taskChangeSummary: TaskChangeSummary | undefined;
};
