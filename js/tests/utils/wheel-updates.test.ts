import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/wheel-update-cases.json";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";
import {
  classifyWheelUpdate,
  collectWheelUpdates,
  parseWheelFilename,
  type WheelUpdate,
} from "../../src/utils/wheel-updates.ts";

type FixtureCase = {
  readonly name: string;
  readonly changeKey: string;
  readonly old?: string;
  readonly new?: string;
  readonly expected: WheelUpdate | null;
};

const wheelChange = (
  oldVersion: string,
  newVersion: string,
  distribution = "etl_lib",
): ChangeDesc => ({
  action: "update",
  old: `/Workspace/artifacts/.internal/${distribution}-${oldVersion}-py3-none-any.whl`,
  new: `/Workspace/artifacts/.internal/${distribution}-${newVersion}-py3-none-any.whl`,
});

describe("classifyWheelUpdate (shared fixture — keeps TS + Python in lockstep)", () => {
  for (const rawCase of fixture.cases as readonly FixtureCase[]) {
    test(rawCase.name, () => {
      const change: ChangeDesc = { action: "update", old: rawCase.old, new: rawCase.new };

      const result = classifyWheelUpdate(rawCase.changeKey, change) ?? null;

      expect(result).toEqual(rawCase.expected);
    });
  }
});

describe("parseWheelFilename", () => {
  test("standard tags", () => {
    expect(parseWheelFilename("/a/b/etl_lib-0.1.0-py3-none-any.whl")).toEqual({
      distribution: "etl_lib",
      version: "0.1.0",
    });
  });

  test("build tag", () => {
    expect(parseWheelFilename("model_lib-2.0.0-1-py3-none-any.whl")).toEqual({
      distribution: "model_lib",
      version: "2.0.0",
    });
  });

  test("too few segments returns undefined", () => {
    expect(parseWheelFilename("/wheels/bundle.whl")).toBeUndefined();
  });

  test("non-whl extension returns undefined", () => {
    expect(parseWheelFilename("/jars/etl_lib-0.1.0-py3-none-any.jar")).toBeUndefined();
  });
});

describe("collectWheelUpdates", () => {
  test("returns undefined when there are no changes", () => {
    expect(collectWheelUpdates(undefined)).toBeUndefined();
  });

  test("returns undefined when no change is a wheel update", () => {
    const changes = {
      "tasks[task_key='ingest'].notebook_task.notebook_path": {
        action: "update",
        old: "/a",
        new: "/b",
      } as ChangeDesc,
    };

    expect(collectWheelUpdates(changes)).toBeUndefined();
  });

  test("deduplicates wheels and sorts by distribution", () => {
    const changes = {
      "tasks[task_key='ingest'].libraries[0].whl": wheelChange("0.1.0", "0.2.0", "etl_lib"),
      "tasks[task_key='transform'].libraries[0].whl": wheelChange("0.1.0", "0.2.0", "etl_lib"),
      "tasks[task_key='enrich'].libraries[1].whl": wheelChange("1.4.0", "1.5.0", "scoring_lib"),
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheels).toEqual([
      { distribution: "etl_lib", oldVersion: "0.1.0", newVersion: "0.2.0" },
      { distribution: "scoring_lib", oldVersion: "1.4.0", newVersion: "1.5.0" },
    ]);
  });

  test("marks tasks with only wheel updates as wheel-only", () => {
    const changes = {
      "tasks[task_key='ingest'].libraries[0].whl": wheelChange("0.1.0", "0.2.0"),
      "tasks[task_key='report'].libraries[0].whl": wheelChange("0.1.0", "0.2.0"),
      "tasks[task_key='report'].notebook_task.notebook_path": {
        action: "update",
        old: "/a",
        new: "/b",
      } as ChangeDesc,
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheelOnlyTaskKeys).toEqual(new Set(["ingest"]));
  });

  test("treats a for-each wheel update as a wheel-only task", () => {
    const changes = {
      "tasks[task_key='process_files'].for_each_task.task.libraries[0].whl": wheelChange(
        "0.1.0",
        "0.2.0",
      ),
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheelOnlyTaskKeys).toEqual(new Set(["process_files"]));
  });

  test("skip-action changes do not disqualify a task from wheel-only", () => {
    const changes = {
      "tasks[task_key='ingest'].libraries[0].whl": wheelChange("0.1.0", "0.2.0"),
      "tasks[task_key='ingest'].description": { action: "skip" } as ChangeDesc,
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheelOnlyTaskKeys).toEqual(new Set(["ingest"]));
  });

  test("swap to a different distribution keeps the task off the wheel-only set", () => {
    const changes = {
      "tasks[task_key='ingest'].libraries[0].whl": {
        action: "update",
        old: "/Workspace/artifacts/.internal/etl_lib-0.1.0-py3-none-any.whl",
        new: "/Workspace/artifacts/.internal/other_lib-0.1.0-py3-none-any.whl",
      } as ChangeDesc,
      "tasks[task_key='transform'].libraries[0].whl": wheelChange("0.1.0", "0.2.0"),
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheelOnlyTaskKeys).toEqual(new Set(["transform"]));
  });

  test("whole-task additions are never wheel-only", () => {
    const changes = {
      "tasks[task_key='ingest'].libraries[0].whl": wheelChange("0.1.0", "0.2.0"),
      "tasks[task_key='ingest']": { action: "create", new: { task_key: "ingest" } } as ChangeDesc,
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheelOnlyTaskKeys).toEqual(new Set());
  });

  test("topology-drift re-adds disqualify a task from wheel-only", () => {
    const changes = {
      "tasks[task_key='ingest'].libraries[0].whl": wheelChange("0.1.0", "0.2.0"),
      "tasks[task_key='ingest'].description": {
        action: "update",
        old: "nightly ingest",
        new: "nightly ingest",
      } as ChangeDesc,
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheelOnlyTaskKeys).toEqual(new Set());
  });
});

describe("collectWheelUpdates (serverless environments)", () => {
  test("environment dependency bumps contribute wheels but no wheel-only tasks", () => {
    const changes = {
      "environments[environment_key='etl'].spec.dependencies[0]": wheelChange("0.1.0", "0.2.0"),
      "environments[environment_key='scoring'].spec.dependencies[0]": wheelChange("0.1.0", "0.2.0"),
      "environments[environment_key='scoring'].spec.dependencies[1]": wheelChange(
        "1.0.0",
        "1.1.0",
        "scoring_lib",
      ),
    };

    const summary = collectWheelUpdates(changes);

    expect(summary?.wheels).toEqual([
      { distribution: "etl_lib", oldVersion: "0.1.0", newVersion: "0.2.0" },
      { distribution: "scoring_lib", oldVersion: "1.0.0", newVersion: "1.1.0" },
    ]);
    expect(summary?.wheelOnlyTaskKeys).toEqual(new Set());
  });

  test("pypi spec bumps in environment dependencies are not wheel updates", () => {
    const changes = {
      "environments[environment_key='etl'].spec.dependencies[0]": {
        action: "update",
        old: "requests==2.31.0",
        new: "requests==2.32.0",
      } as ChangeDesc,
    };

    expect(collectWheelUpdates(changes)).toBeUndefined();
  });
});
