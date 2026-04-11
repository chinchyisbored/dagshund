import { describe, expect, test } from "bun:test";
import {
  isNoOpChange,
  splitMeaningfulChanges,
} from "../../../src/components/detail-panel/filter-changes.ts";
import type { ChangeDesc } from "../../../src/types/plan-schema.ts";

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
    const result = splitMeaningfulChanges(undefined);
    expect(result.driftChanges).toEqual({});
    expect(result.fieldChanges).toEqual([]);
  });

  test("partitions topology drift into driftChanges", () => {
    const changes: Record<string, ChangeDesc> = {
      "tasks[task_key='transform']": {
        action: "update",
        old: { task_key: "transform" },
        new: { task_key: "transform" },
      },
    };
    const result = splitMeaningfulChanges(changes);
    expect(Object.keys(result.driftChanges)).toEqual(["tasks[task_key='transform']"]);
    expect(result.fieldChanges).toEqual([]);
  });

  test("partitions regular changes into fieldChanges", () => {
    const changes: Record<string, ChangeDesc> = {
      edit_mode: { action: "update", old: "UI_LOCKED", new: "UI_LOCKED", remote: "EDITABLE" },
    };
    const result = splitMeaningfulChanges(changes);
    expect(result.driftChanges).toEqual({});
    expect(result.fieldChanges.length).toBe(1);
    expect(result.fieldChanges[0]?.[0]).toBe("edit_mode");
  });

  test("filters NOISE_ACTIONS entries from both buckets", () => {
    const changes: Record<string, ChangeDesc> = {
      tail: { action: "skip", remote: 0 },
      blank: { action: "", remote: {} },
    };
    const result = splitMeaningfulChanges(changes);
    expect(result.driftChanges).toEqual({});
    expect(result.fieldChanges).toEqual([]);
  });

  test("filters no-op entries from both buckets", () => {
    const changes: Record<string, ChangeDesc> = {
      equal: { action: "update", old: "x", new: "x", remote: "x" },
    };
    const result = splitMeaningfulChanges(changes);
    expect(result.driftChanges).toEqual({});
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
    const result = splitMeaningfulChanges(changes);
    expect(Object.keys(result.driftChanges)).toEqual(["drift"]);
    const fieldKeys = result.fieldChanges.map(([k]) => k);
    expect(fieldKeys.sort()).toEqual(["fieldDrift", "regular"]);
  });
});
