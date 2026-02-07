export type { DiffState } from "./diff-state.ts";
export type {
  DagNodeData,
  GraphEdge,
  GraphNode,
  NodeKind,
  PlanGraph,
  TaskChangeSummary,
} from "./graph-types.ts";
export type {
  ActionType,
  ChangeDesc,
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
  CreateOnlyDiff,
  DeleteOnlyDiff,
  ObjectDiff,
  ObjectEntry,
  ObjectEntryStatus,
  ScalarDiff,
  StructuralDiff,
  StructuralDiffResult,
} from "./structural-diff.ts";
