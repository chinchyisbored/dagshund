import type { DiffState } from "./diff-state.ts";
import type { ChangeDesc } from "./plan-schema.ts";

export type NodeKind = "job" | "task";

export type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly nodeKind: NodeKind;
  readonly diffState: DiffState;
  readonly resourceKey: string;
  readonly taskKey: string | undefined;
  readonly changes: Readonly<Record<string, ChangeDesc>> | undefined;
};

export type GraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string | undefined;
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
};
