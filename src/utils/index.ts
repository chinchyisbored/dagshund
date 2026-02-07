export { formatValue } from "./format-value.ts";
export type { ValueFormat } from "./format-value.ts";
export {
  computeStructuralDiff,
  diffArrays,
  diffObjects,
  findIdentityKey,
} from "./structural-diff.ts";
export { extractResourceName } from "./resource-key.ts";
export {
  buildTaskKeyPrefix,
  TASK_KEY_PATTERN,
  TASK_KEY_DOT_PREFIX_PATTERN,
  collectChangesForTask,
} from "./task-key.ts";
