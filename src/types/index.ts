export type { DiffState } from "./diff-state.ts";
export type {
  DagNodeData,
  GraphEdge,
  GraphNode,
  NodeKind,
  PlanGraph,
  TaskChangeSummary,
  TaskChangeSummaryEntry,
} from "./graph-types.ts";
export type {
  ActionType,
  ChangeDesc,
  DependsOnEntry,
  Plan,
  PlanEntry,
} from "./plan-schema.ts";
export {
  actionTypeSchema,
  changeDescSchema,
  dependsOnEntrySchema,
  planEntrySchema,
  planSchema,
} from "./plan-schema.ts";
export type { Result } from "./result.ts";
export { err, ok } from "./result.ts";
export type {
  ArrayDiff,
  ArrayElement,
  ArrayElementStatus,
  BaselineLabel,
  CreateOnlyDiff,
  DeleteOnlyDiff,
  ObjectDiff,
  ObjectEntry,
  ObjectEntryStatus,
  ScalarDiff,
  StructuralDiff,
  StructuralDiffResult,
} from "./structural-diff.ts";
