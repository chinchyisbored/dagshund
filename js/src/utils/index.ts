export type { ValueFormat } from "./format-value.ts";
export { formatValue } from "./format-value.ts";
export { tryOpenBrowser } from "./open-browser.ts";
export { extractResourceName } from "./resource-key.ts";
export {
  computeStructuralDiff,
  diffArrays,
  diffObjects,
  findIdentityKey,
} from "./structural-diff.ts";
export {
  buildTaskKeyPrefix,
  collectChangesForTask,
  TASK_KEY_DOT_PREFIX_PATTERN,
  TASK_KEY_PATTERN,
} from "./task-key.ts";
