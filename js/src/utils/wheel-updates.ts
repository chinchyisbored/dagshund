import type { ChangeDesc } from "../types/plan-schema.ts";

/**
 * Wheel-version churn detection (dagshund-aqcx).
 *
 * CI pipelines rebuild bundle wheel artifacts on every run. On classic compute
 * every task attaches the wheel via `libraries[N].whl`, so each task reports an
 * update — drowning real changes in large DAGs. On serverless the wheel lives
 * in job-level `environments[K].spec.dependencies[N]` and the same bump repeats
 * once per environment per dependency. This module classifies wheel transitions
 * for the plan-wide summary and effective-plan projection.
 *
 * Mirrors the Python helper at `src/dagshund/wheel.py`; the shared fixture at
 * `fixtures/wheel-update-cases.json` protects the two from drifting apart.
 */

/** A wheel artifact replaced by another build of the same distribution. */
export type WheelUpdate = {
  readonly distribution: string;
  readonly oldVersion: string;
  readonly newVersion: string;
  readonly oldRequirement?: string;
  readonly newRequirement?: string;
};

export const formatWheelUpdate = (update: WheelUpdate, updates: readonly WheelUpdate[]): string => {
  const ambiguous =
    update.oldVersion === update.newVersion ||
    updates.some(
      (other) =>
        other !== update &&
        other.distribution === update.distribution &&
        other.oldVersion === update.oldVersion &&
        other.newVersion === update.newVersion &&
        (other.oldRequirement !== update.oldRequirement ||
          other.newRequirement !== update.newRequirement),
    );
  return ambiguous
    ? `${update.distribution}: ${update.oldRequirement ?? ""} → ${update.newRequirement ?? ""}`
    : `${update.distribution} ${update.oldVersion} → ${update.newVersion}`;
};

// Task-scoped wheel library path on classic compute, directly on a task or its nested for-each task.
const TASK_WHEEL_CHANGE_KEY_PATTERN =
  /^tasks\[task_key='([^']+)'\]\.(?:for_each_task\.task\.)?libraries\[\d+\]\.whl$/;

// Serverless environment dependency: environments[environment_key='K'].spec.dependencies[N].
// Dependencies mix pip specs and wheel paths; the value filter in classify keeps only wheels.
const ENVIRONMENT_WHEEL_CHANGE_KEY_PATTERN =
  /^environments\[environment_key='([^']+)'\]\.spec\.dependencies\[\d+\]$/;
const PIPELINE_WHEEL_CHANGE_KEY_PATTERN = /^libraries\[\d+\]\.whl$/;
const PIPELINE_ENVIRONMENT_WHEEL_CHANGE_KEY_PATTERN = /^environment\.dependencies\[\d+\]$/;

type ParsedWheelRequirement = {
  readonly distribution: string;
  readonly version: string;
  readonly extras: readonly string[];
};

const EXTRA_NAME = "[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?";
const WHEEL_REQUIREMENT_PATTERN = new RegExp(
  String.raw`^(?<wheel>.+\.whl)(?:\[(?<extras>${EXTRA_NAME}(?:,${EXTRA_NAME})*)\])?$`,
);

const parseWheelRequirement = (path: string): ParsedWheelRequirement | undefined => {
  const basename = path.split("/").at(-1) ?? path;
  const match = WHEEL_REQUIREMENT_PATTERN.exec(basename);
  if (match === null) return undefined;
  const wheel = match.groups?.["wheel"];
  if (wheel === undefined) return undefined;
  const parts = wheel.slice(0, -".whl".length).split("-");
  const [distribution, version] = parts;
  if (parts.length < 5 || distribution === undefined || version === undefined) return undefined;
  const extras = match.groups?.["extras"];
  return { distribution, version, extras: extras?.split(",") ?? [] };
};

/**
 * Extract `{ distribution, version }` from a wheel path's basename.
 *
 * PEP 427 filenames are `{dist}-{version}(-{build})?-{python}-{abi}-{platform}.whl`
 * with hyphens in the distribution name escaped to underscores, so the first
 * two dash-separated segments are unambiguous. A validated pip extras suffix
 * such as `[train,gpu]` may follow the filename.
 */
export const parseWheelFilename = (
  path: string,
): { readonly distribution: string; readonly version: string } | undefined => {
  const parsed = parseWheelRequirement(path);
  return parsed === undefined
    ? undefined
    : { distribution: parsed.distribution, version: parsed.version };
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
  resourceType?: string,
): WheelUpdate | undefined => {
  const isJobPath =
    resourceType !== "pipelines" &&
    (TASK_WHEEL_CHANGE_KEY_PATTERN.test(changeKey) ||
      ENVIRONMENT_WHEEL_CHANGE_KEY_PATTERN.test(changeKey));
  const isPipelinePath =
    resourceType === "pipelines" &&
    (PIPELINE_WHEEL_CHANGE_KEY_PATTERN.test(changeKey) ||
      PIPELINE_ENVIRONMENT_WHEEL_CHANGE_KEY_PATTERN.test(changeKey));
  if (!isJobPath && !isPipelinePath) return undefined;
  if (typeof change.old !== "string" || typeof change.new !== "string") return undefined;
  if (change.old === change.new) return undefined;
  const oldParsed = parseWheelRequirement(change.old);
  const newParsed = parseWheelRequirement(change.new);
  if (oldParsed === undefined || newParsed === undefined) return undefined;
  if (oldParsed.distribution !== newParsed.distribution) return undefined;
  if (oldParsed.extras.join(",") !== newParsed.extras.join(",")) return undefined;
  return {
    distribution: oldParsed.distribution,
    oldVersion: oldParsed.version,
    newVersion: newParsed.version,
    oldRequirement: change.old,
    newRequirement: change.new,
  };
};
