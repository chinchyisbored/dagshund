import { describe, expect, test } from "bun:test";
import {
  isNoOpChange,
  splitMeaningfulChanges,
} from "../../../src/components/detail-panel/filter-changes.ts";
import type { ChangeDesc } from "../../../src/types/plan-schema.ts";
import type { DriftScanParent } from "../../../src/utils/structural-diff.ts";

const EMPTY_PARENT: DriftScanParent = {
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
};

describe("isNoOpChange", () => {
  test("preserves topology drift (old == new, no remote)", () => {
    const change: ChangeDesc = {
      action: "update",
      old: { task_key: "transform" },
      new: { task_key: "transform" },
    };
    expect(isNoOpChange(change)).toBe(false);
  });

  test("preserves field-level drift (old == new, remote differs)", () => {
    const change: ChangeDesc = {
      action: "update",
      old: "UI_LOCKED",
      new: "UI_LOCKED",
      remote: "EDITABLE",
    };
    expect(isNoOpChange(change)).toBe(false);
  });

  test("filters old == new with no remote difference... but only when not topology drift", () => {
    // old == new, remote present and equal → pure no-op, filter out
    const change: ChangeDesc = {
      action: "update",
      old: "x",
      new: "x",
      remote: "x",
    };
    expect(isNoOpChange(change)).toBe(true);
  });

  test("keeps regular updates (old != new)", () => {
    const change: ChangeDesc = { action: "update", old: "a", new: "b" };
    expect(isNoOpChange(change)).toBe(false);
  });

  test("does not filter missing-new or missing-old", () => {
    expect(isNoOpChange({ action: "update", old: "a" })).toBe(false);
    expect(isNoOpChange({ action: "update", new: "b" })).toBe(false);
  });
});

describe("splitMeaningfulChanges", () => {
  test("returns empty split for undefined changes", () => {
    const result = splitMeaningfulChanges(undefined, EMPTY_PARENT);
    expect(result.driftReentryChanges).toEqual({});
    expect(result.driftRemovalChanges).toEqual({});
    expect(result.fieldChanges).toEqual([]);
    expect(result.allChangePaths).toEqual([]);
  });

  test("partitions topology drift into driftReentryChanges", () => {
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='transform']": {
        action: "update",
        old: { task_key: "transform" },
        new: { task_key: "transform" },
      },
    };
    const result = splitMeaningfulChanges(changes, EMPTY_PARENT);
    expect(Object.keys(result.driftReentryChanges)).toEqual(["tasks[task_key='transform']"]);
    expect(result.driftRemovalChanges).toEqual({});
    expect(result.fieldChanges).toEqual([]);
    expect(result.allChangePaths).toEqual(["tasks[task_key='transform']"]);
  });

  test("partitions regular changes into fieldChanges", () => {
    const changes: Record<string, ChangeDesc> = {
      edit_mode: { action: "update", old: "UI_LOCKED", new: "UI_LOCKED", remote: "EDITABLE" },
    };
    const result = splitMeaningfulChanges(changes, EMPTY_PARENT);
    expect(result.driftReentryChanges).toEqual({});
    expect(result.driftRemovalChanges).toEqual({});
    expect(result.fieldChanges.length).toBe(1);
    expect(result.fieldChanges[0]?.[0]).toBe("edit_mode");
    expect(result.allChangePaths).toEqual(["edit_mode"]);
  });

  test("filters NOISE_ACTIONS entries from every bucket", () => {
    const changes: Record<string, ChangeDesc> = {
      tail: { action: "skip", remote: 0 },
      blank: { action: "", remote: {} },
    };
    const result = splitMeaningfulChanges(changes, EMPTY_PARENT);
    expect(result.driftReentryChanges).toEqual({});
    expect(result.driftRemovalChanges).toEqual({});
    expect(result.fieldChanges).toEqual([]);
    expect(result.allChangePaths).toEqual([]);
  });

  test("filters no-op entries from every bucket", () => {
    const changes: Record<string, ChangeDesc> = {
      equal: { action: "update", old: "x", new: "x", remote: "x" },
    };
    const result = splitMeaningfulChanges(changes, EMPTY_PARENT);
    expect(result.driftReentryChanges).toEqual({});
    expect(result.driftRemovalChanges).toEqual({});
    expect(result.fieldChanges).toEqual([]);
  });

  test("mixed input partitions correctly", () => {
    const changes: Record<string, ChangeDesc> = {
      skipped: { action: "skip", remote: 0 },
      drift: {
        action: "update",
        old: { principal: "data_engineers" },
        new: { principal: "data_engineers" },
      },
      fieldDrift: {
        action: "update",
        old: "UI_LOCKED",
        new: "UI_LOCKED",
        remote: "EDITABLE",
      },
      regular: { action: "update", old: "a", new: "b" },
    };
    const result = splitMeaningfulChanges(changes, EMPTY_PARENT);
    expect(Object.keys(result.driftReentryChanges)).toEqual(["drift"]);
    const fieldKeys = result.fieldChanges.map(([k]) => k);
    expect(fieldKeys.sort()).toEqual(["fieldDrift", "regular"]);
    expect(result.driftRemovalChanges).toEqual({});
  });
});

/** Context where a list-element delete should be reclassified as drift:
 *  `ingest` is on the remote's depends_on list but missing from the bundle's,
 *  and the resource carries the shape-drift flag (dagshund-1naj gate). */
const driftRemovalChanges: Record<string, ChangeDesc> = {
  "tasks[task_key='publish'].depends_on[task_key='ingest']": {
    action: "update",
    remote: { task_key: "ingest" },
  },
};
const driftRemovalParent: DriftScanParent = {
  newState: {
    value: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "transform" }] }] },
  },
  remoteState: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "ingest" }] }] },
  resourceHasShapeDrift: true,
};

describe("splitMeaningfulChanges drift-removal partition (dagshund-3hdx)", () => {
  test("reclassified list-element delete lands in driftRemovalChanges when shape-drift flag is set", () => {
    const result = splitMeaningfulChanges(driftRemovalChanges, driftRemovalParent);
    expect(Object.keys(result.driftRemovalChanges)).toEqual([
      "tasks[task_key='publish'].depends_on[task_key='ingest']",
    ]);
    expect(result.fieldChanges).toEqual([]);
    expect(result.driftReentryChanges).toEqual({});
  });

  test("same delete shape stays in fieldChanges when resourceHasShapeDrift is false", () => {
    // Gate: without shape drift, the reclassifier refuses to promote
    // list-element deletes into drift (guards against false positives).
    const result = splitMeaningfulChanges(driftRemovalChanges, {
      ...driftRemovalParent,
      resourceHasShapeDrift: false,
    });
    expect(result.driftRemovalChanges).toEqual({});
    expect(result.fieldChanges.map(([k]) => k)).toEqual([
      "tasks[task_key='publish'].depends_on[task_key='ingest']",
    ]);
  });

  test("non-list-element delete in a shape-drifted resource stays in fieldChanges", () => {
    // An unrelated remote-only field (no list-element filter in the key) is
    // NOT a candidate for reclassification, even under shape drift — must
    // remain a normal field change so the generic Removed section shows it.
    const changes: Record<string, ChangeDesc> = {
      description: { action: "update", old: "hi" },
    };
    const result = splitMeaningfulChanges(changes, driftRemovalParent);
    expect(result.driftRemovalChanges).toEqual({});
    expect(result.fieldChanges.map(([k]) => k)).toEqual(["description"]);
  });

  test("topology drift and drift removal partition into their respective buckets simultaneously", () => {
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='publish'].depends_on[task_key='ingest']": {
        action: "update",
        remote: { task_key: "ingest" },
      },
      "tasks[task_key='publish'].depends_on[task_key='transform']": {
        action: "update",
        old: { task_key: "transform" },
        new: { task_key: "transform" },
      },
    };
    const result = splitMeaningfulChanges(changes, driftRemovalParent);
    expect(Object.keys(result.driftReentryChanges)).toEqual([
      "tasks[task_key='publish'].depends_on[task_key='transform']",
    ]);
    expect(Object.keys(result.driftRemovalChanges)).toEqual([
      "tasks[task_key='publish'].depends_on[task_key='ingest']",
    ]);
    expect(result.fieldChanges).toEqual([]);
  });

  test("allChangePaths returns the union of all buckets in insertion order", () => {
    const changes: Record<string, ChangeDesc> = {
      skipped: { action: "skip", remote: 0 }, // filtered, should not appear
      "tasks[task_key='publish'].depends_on[task_key='ingest']": {
        action: "update",
        remote: { task_key: "ingest" },
      },
      regular: { action: "update", old: "a", new: "b" },
      "tasks[task_key='publish'].depends_on[task_key='transform']": {
        action: "update",
        old: { task_key: "transform" },
        new: { task_key: "transform" },
      },
    };
    const result = splitMeaningfulChanges(changes, driftRemovalParent);
    expect(result.allChangePaths).toEqual([
      "tasks[task_key='publish'].depends_on[task_key='ingest']",
      "regular",
      "tasks[task_key='publish'].depends_on[task_key='transform']",
    ]);
  });
});
