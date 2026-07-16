import type { ChangeDesc } from "../types/plan-schema.ts";
import { isTopologyDriftChange } from "./structural-diff.ts";
import { TASK_KEY_PATTERN } from "./task-key.ts";

/**
 * Wheel-version churn detection (dagshund-aqcx).
 *
 * CI pipelines rebuild bundle wheel artifacts on every run. On classic compute
 * every task attaches the wheel via `libraries[N].whl`, so each task reports an
 * update — drowning real changes in large DAGs. On serverless the wheel lives
 * in job-level `environments[K].spec.dependencies[N]` and the same bump repeats
 * once per environment per dependency. This module classifies both shapes so
 * the DAG view can render wheel-only tasks as unchanged and surface the wheel
 * bump once on the job container.
 *
 * Mirrors the Python helper at `src/dagshund/wheel.py`; the shared fixture at
 * `fixtures/wheel-update-cases.json` protects the two from drifting apart.
 */

/** A wheel artifact replaced by another build of the same distribution. */
export type WheelUpdate = {
  readonly distribution: string;
  readonly oldVersion: string;
  readonly newVersion: string;
};

/** Per-entry summary consumed by the graph builder. */
export type WheelUpdateSummary = {
  /** Distinct wheel updates, sorted by distribution name. */
  readonly wheels: readonly WheelUpdate[];
  /** Tasks whose every counting change is a wheel update. */
  readonly wheelOnlyTaskKeys: ReadonlySet<string>;
};

// Task-scoped wheel library path on classic compute, directly on a task or its nested for-each task.
const TASK_WHEEL_CHANGE_KEY_PATTERN =
  /^tasks\[task_key='([^']+)'\]\.(?:for_each_task\.task\.)?libraries\[\d+\]\.whl$/;

// Serverless environment dependency: environments[environment_key='K'].spec.dependencies[N].
// Dependencies mix pip specs and wheel paths; the value filter in classify keeps only wheels.
const ENVIRONMENT_WHEEL_CHANGE_KEY_PATTERN =
  /^environments\[environment_key='([^']+)'\]\.spec\.dependencies\[\d+\]$/;

/**
 * Extract `{ distribution, version }` from a wheel path's basename.
 *
 * PEP 427 filenames are `{dist}-{version}(-{build})?-{python}-{abi}-{platform}.whl`
 * with hyphens in the distribution name escaped to underscores, so the first
 * two dash-separated segments are unambiguous. Returns undefined for anything
 * that does not look like a wheel filename.
 */
export const parseWheelFilename = (
  path: string,
): { readonly distribution: string; readonly version: string } | undefined => {
  const basename = path.split("/").at(-1) ?? path;
  if (!basename.endsWith(".whl")) return undefined;
  const parts = basename.slice(0, -".whl".length).split("-");
  if (parts.length < 5) return undefined;
  const [distribution, version] = parts;
  if (distribution === undefined || version === undefined) return undefined;
  return { distribution, version };
};

/**
 * Classify a field change as a suppressible wheel update, or undefined.
 *
 * A wheel update replaces one wheel path with another whose filename parses
 * to the *same* distribution name, on either a task library (classic compute)
 * or an environment dependency (serverless). Swapping to a different
 * distribution, or adding/removing a wheel, is a real change and stays visible.
 */
export const classifyWheelUpdate = (
  changeKey: string,
  change: ChangeDesc,
): WheelUpdate | undefined => {
  if (
    !TASK_WHEEL_CHANGE_KEY_PATTERN.test(changeKey) &&
    !ENVIRONMENT_WHEEL_CHANGE_KEY_PATTERN.test(changeKey)
  ) {
    return undefined;
  }
  if (typeof change.old !== "string" || typeof change.new !== "string") return undefined;
  if (change.old === change.new) return undefined;
  const oldParsed = parseWheelFilename(change.old);
  const newParsed = parseWheelFilename(change.new);
  if (oldParsed === undefined || newParsed === undefined) return undefined;
  if (oldParsed.distribution !== newParsed.distribution) return undefined;
  return {
    distribution: oldParsed.distribution,
    oldVersion: oldParsed.version,
    newVersion: newParsed.version,
  };
};

/** Whether a change contributes to a task's "modified" state (mirrors resolveTaskDiffState). */
const isCountingChange = (change: ChangeDesc): boolean =>
  change.action !== "skip" && change.action !== "";

/**
 * Summarize the wheel updates in a plan entry's changes record.
 *
 * Returns undefined when no change classifies as a wheel update. A task is
 * wheel-only when every change that would mark it modified is a wheel update —
 * those tasks can render as unchanged when suppression is toggled on.
 */
export const collectWheelUpdates = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): WheelUpdateSummary | undefined => {
  if (changes === undefined) return undefined;

  // Local mutation for accumulation — invisible to callers.
  const distinctWheels = new Map<string, WheelUpdate>();
  const wheelTaskKeys = new Set<string>();
  const realChangeTaskKeys = new Set<string>();

  for (const [changeKey, change] of Object.entries(changes)) {
    const wheelUpdate = classifyWheelUpdate(changeKey, change);
    if (wheelUpdate !== undefined) {
      const dedupeKey = `${wheelUpdate.distribution}→${wheelUpdate.oldVersion}→${wheelUpdate.newVersion}`;
      distinctWheels.set(dedupeKey, wheelUpdate);
      const wheelTaskKey = TASK_WHEEL_CHANGE_KEY_PATTERN.exec(changeKey)?.[1];
      if (wheelTaskKey !== undefined) wheelTaskKeys.add(wheelTaskKey);
      continue;
    }
    // Topology drift always renders a drift pill, so tie wheel-only
    // disqualification to the drift predicate itself instead of relying on
    // drift's action ("update") happening to be a counting action.
    if (!isCountingChange(change) && !isTopologyDriftChange(change)) continue;
    const changedTaskKey = TASK_KEY_PATTERN.exec(changeKey)?.[1];
    if (changedTaskKey !== undefined) realChangeTaskKeys.add(changedTaskKey);
  }

  if (distinctWheels.size === 0) return undefined;

  const wheels = [...distinctWheels.values()].toSorted(
    (a, b) =>
      a.distribution.localeCompare(b.distribution) ||
      a.oldVersion.localeCompare(b.oldVersion) ||
      a.newVersion.localeCompare(b.newVersion),
  );
  const wheelOnlyTaskKeys = new Set(
    [...wheelTaskKeys].filter((taskKey) => !realChangeTaskKeys.has(taskKey)),
  );
  return { wheels, wheelOnlyTaskKeys };
};
