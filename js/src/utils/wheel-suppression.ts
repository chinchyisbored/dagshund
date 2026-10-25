import type { ChangeDesc } from "../types/plan-schema.ts";
import { deepEqual } from "./deep-equal.ts";
import type { NormalizedEntry, NormalizedPlan } from "./normalize-plan.ts";
import { extractResourceType } from "./resource-key.ts";
import { isTopologyDriftChange } from "./structural-diff.ts";
import type { WheelUpdate } from "./wheel-updates.ts";
import { classifyWheelUpdate } from "./wheel-updates.ts";

export type WheelUsage = {
  readonly update: WheelUpdate;
  readonly taskCount: number;
  readonly environmentCount: number;
  readonly pipelineCount: number;
};

export type WheelSuppression = {
  readonly plan: NormalizedPlan;
  readonly usages: readonly WheelUsage[];
};

const isProvenNoop = (change: ChangeDesc): boolean =>
  (change.action === "skip" || change.action === "") &&
  "old" in change &&
  "new" in change &&
  "remote" in change &&
  deepEqual(change.old, change.new) &&
  deepEqual(change.old, change.remote);

const compareCodePoints = (left: string, right: string): number => {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  for (const [index, leftPoint] of leftPoints.entries()) {
    const rightPoint = rightPoints[index];
    if (rightPoint === undefined) return 1;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
};

const transitionKey = (update: WheelUpdate): string =>
  `${update.distribution}\u0000${update.oldRequirement}\u0000${update.newRequirement}`;

export const applyWheelSuppression = (normalizedPlan: NormalizedPlan): WheelSuppression => {
  const entries: Record<string, NormalizedEntry> = {};
  const occurrences = new Map<
    string,
    { update: WheelUpdate; tasks: Set<string>; environments: Set<string>; pipelines: Set<string> }
  >();
  for (const [resourceKey, entry] of Object.entries(normalizedPlan.entries)) {
    const resourceType = extractResourceType(resourceKey);
    if (
      (resourceType !== "jobs" && resourceType !== "pipelines") ||
      entry.action !== "update" ||
      entry.changes === undefined
    ) {
      entries[resourceKey] = entry;
      continue;
    }
    const suppressed = new Set<string>();
    for (const [changeKey, change] of Object.entries(entry.changes)) {
      const update =
        change.action === "update"
          ? classifyWheelUpdate(changeKey, change, resourceType)
          : undefined;
      if (update === undefined) continue;
      suppressed.add(changeKey);
      const key = transitionKey(update);
      const occurrence = occurrences.get(key) ?? {
        update,
        tasks: new Set<string>(),
        environments: new Set<string>(),
        pipelines: new Set<string>(),
      };
      const task =
        /^tasks\[task_key='([^']+)'\]\.(?:for_each_task\.task\.)?libraries\[\d+\]\.whl$/.exec(
          changeKey,
        );
      const environment =
        /^environments\[environment_key='([^']+)'\]\.spec\.dependencies\[\d+\]$/.exec(changeKey);
      if (task !== null)
        occurrence.tasks.add(
          `${resourceKey}:${changeKey.includes(".for_each_task.task.") ? "for_each" : "task"}:${task[1]}`,
        );
      else if (environment !== null)
        occurrence.environments.add(`${resourceKey}:${environment[1]}`);
      else
        occurrence.pipelines.add(
          `${resourceKey}:${changeKey.startsWith("environment.") ? "environment" : "pipeline"}`,
        );
      occurrences.set(key, occurrence);
    }
    if (suppressed.size === 0) {
      entries[resourceKey] = entry;
      continue;
    }
    const changes = Object.fromEntries(
      Object.entries(entry.changes).filter(
        ([key, change]) => !suppressed.has(key) && !isProvenNoop(change),
      ),
    );
    const hasSubstantiveChange = Object.values(changes).some(
      (change) =>
        (change.action !== "skip" && change.action !== "") || isTopologyDriftChange(change),
    );
    entries[resourceKey] = {
      ...entry,
      action: hasSubstantiveChange ? entry.action : "skip",
      changes,
    };
  }
  const usages = [...occurrences.values()]
    .map(({ update, tasks, environments, pipelines }) => ({
      update,
      taskCount: tasks.size,
      environmentCount: environments.size,
      pipelineCount: pipelines.size,
    }))
    .toSorted(
      (a, b) =>
        compareCodePoints(a.update.distribution, b.update.distribution) ||
        compareCodePoints(a.update.oldRequirement ?? "", b.update.oldRequirement ?? "") ||
        compareCodePoints(a.update.newRequirement ?? "", b.update.newRequirement ?? ""),
    );
  return { plan: { ...normalizedPlan, entries }, usages };
};
