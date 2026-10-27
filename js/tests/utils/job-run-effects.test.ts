import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/job-run-outcome-cases.json";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import type { ChangeDesc } from "../../src/types/plan-schema.ts";
import { classifyJobRunEffect, filterJobRunChanges } from "../../src/utils/job-run-effects.ts";
import type { JobRunEffect } from "../../src/utils/normalize-plan.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";

const parseEntries = (rawPlan: unknown) => {
  const result = parsePlanJson({ plan: rawPlan });
  if (!result.ok) throw new Error(`fixture case parse failed: ${result.error}`);
  return result.data.plan ?? {};
};

const findEffect = (rawCase: (typeof fixture.cases)[number]): JobRunEffect => {
  const effectName = rawCase.effectKey.split(".").at(-1);
  const { entries } = normalizePlan(parseEntries(rawCase.plan));
  const effect = Object.values(entries)
    .flatMap((entry) => entry.effects ?? [])
    .find((candidate) => candidate.name === effectName);
  if (effect === undefined) throw new Error(`effect ${effectName} was not folded onto a target`);
  return effect;
};

describe("job run effect classification (shared vectors)", () => {
  for (const rawCase of fixture.cases) {
    test(rawCase.name, () => {
      const effect = findEffect(rawCase);
      const semantics = classifyJobRunEffect(effect);
      const expected = rawCase.expected;

      expect(String(semantics.kind)).toBe(expected.kind);
      expect(semantics.wording).toBe(expected.wording);
      expect(semantics.stateMessage).toBe(expected.stateMessage ?? undefined);
      expect(semantics.firesOnDeploy).toBe(expected.firesOnDeploy);
      expect(semantics.badgeVisible).toBe(expected.badgeVisible);
      expect(JSON.stringify(semantics.watchedPatterns)).toBe(
        JSON.stringify("watchedPatterns" in expected ? expected.watchedPatterns : []),
      );
      const visibleChanges = filterJobRunChanges(effect.changes);
      expect(Object.keys(visibleChanges)).toEqual(expected.visibleChangeKeys);
      if (expected.visibleChanges !== undefined)
        expect(JSON.stringify(visibleChanges)).toBe(JSON.stringify(expected.visibleChanges));
      if (expected.runPageUrl !== undefined) expect(effect.runPageUrl).toBe(expected.runPageUrl);
    });
  }
});

describe("job run effect visible changes", () => {
  test("classifies flagged delete cleanup without delete wording or deploy badge", () => {
    const effect: JobRunEffect = {
      name: "cleanup",
      action: "delete",
      gone: true,
      stateOnly: false,
      runPageUrl: "https://example.test/run/1",
      changes: { state: { action: "delete", old: "completed" } },
      newState: undefined,
      remoteState: { state: { life_cycle_state: "TERMINATED" } },
    };

    const semantics = classifyJobRunEffect(effect);

    expect(semantics.kind).toBe("cleanup");
    expect(semantics.wording).toContain("already absent");
    expect(semantics.firesOnDeploy).toBe(false);
    expect(semantics.badgeVisible).toBe(false);
    expect(filterJobRunChanges(effect.changes, semantics.kind === "cleanup")).toEqual({});
  });
  test("recognizes modern every-deploy leaf fingerprints without exposing them", () => {
    const changes = {
      "lifecycle.triggers_state.on_bundle_deploy": {
        action: "recreate" as const,
        old: "old-uuid",
        new: "new-uuid",
      },
    };
    const semantics = classifyJobRunEffect({
      name: "modern-leaf",
      action: "recreate",
      changes,
      runPageUrl: undefined,
      newState: undefined,
      remoteState: undefined,
    });

    expect(semantics.kind).toBe("every-deploy");
    expect(semantics.wording).toBe("runs on every deploy");
    expect(filterJobRunChanges(changes)).toEqual({});
  });

  test("preserves empty malformed sides beside generated fingerprints", () => {
    const sidePairs = [
      ["old", "new"],
      ["old", "remote"],
      ["new", "old"],
      ["new", "remote"],
      ["remote", "old"],
      ["remote", "new"],
    ] as const;

    for (const [fingerprintSide, malformedSide] of sidePairs) {
      const changes = {
        "lifecycle.triggers_state.on_bundle_deploy": {
          action: "recreate" as const,
          [fingerprintSide]: "SENTINEL_UUID",
          [malformedSide]: {},
        },
      };

      expect(filterJobRunChanges(changes)).toEqual({
        "lifecycle.triggers_state.on_bundle_deploy": {
          action: "recreate",
          [malformedSide]: {},
        },
      });
    }
  });

  test("preserves malformed modern bundle values beside generated fingerprints", () => {
    const cases = [
      {
        path: "lifecycle.triggers_state.on_bundle_deploy",
        old: "SENTINEL_UUID",
        new: { unexpected: 2 },
        expected: { new: { unexpected: 2 } },
      },
      {
        path: "lifecycle.triggers_state",
        old: { on_bundle_deploy: "SENTINEL_UUID" },
        new: { on_bundle_deploy: { unexpected: 2 } },
        expected: { new: { on_bundle_deploy: { unexpected: 2 } } },
      },
      {
        path: "lifecycle",
        old: { triggers_state: { on_bundle_deploy: "SENTINEL_UUID" } },
        new: { triggers_state: { on_bundle_deploy: { unexpected: 2 } } },
        expected: { new: { triggers_state: { on_bundle_deploy: { unexpected: 2 } } } },
      },
    ] as const;

    for (const { path, old, new: newValue, expected } of cases) {
      const changes = { [path]: { action: "recreate" as const, old, new: newValue } };
      const semantics = classifyJobRunEffect({
        name: "malformed-modern-trigger",
        action: "recreate",
        changes,
        runPageUrl: undefined,
        newState: undefined,
        remoteState: undefined,
      });

      expect(semantics.kind).toBe("recreate");
      expect(filterJobRunChanges(changes)[path]).toMatchObject(expected);
      expect(JSON.stringify(filterJobRunChanges(changes))).not.toContain("SENTINEL_UUID");
    }
  });

  test("filters modern file hashes and reports changed watched patterns", () => {
    const pattern = "configs/[prod].yaml";
    const effect: JobRunEffect = {
      name: "modern",
      action: "recreate",
      runPageUrl: undefined,
      newState: undefined,
      remoteState: undefined,
      changes: {
        "lifecycle.triggers_state": {
          action: "recreate",
          old: { on_file_change: { [pattern]: "hash-before" }, pause_statuses: ["PAUSED"] },
          new: { on_file_change: { [pattern]: "hash-after" }, pause_statuses: ["UNPAUSED"] },
        },
      },
    };

    const semantics = classifyJobRunEffect(effect);
    const visible = filterJobRunChanges(effect.changes);

    expect(semantics.kind).toBe("file-change");
    expect(semantics.wording).toBe("re-runs on deploy (file-change trigger)");
    expect(semantics.watchedPatterns).toEqual([{ pattern, status: "changed" }]);
    expect(visible["lifecycle.triggers_state"]?.old).toEqual({ pause_statuses: ["PAUSED"] });
    expect(JSON.stringify(visible)).not.toContain("hash-before");
  });

  test("parses quoted file-pattern paths containing dots and brackets", () => {
    const pattern = "configs/[prod].yaml";
    const effect: JobRunEffect = {
      name: "selected",
      action: "recreate",
      runPageUrl: undefined,
      newState: undefined,
      remoteState: undefined,
      changes: {
        [`lifecycle.triggers_state.on_file_change['${pattern}']`]: {
          action: "recreate",
          old: "before",
          new: "after",
        },
      },
    };

    const semantics = classifyJobRunEffect(effect);

    expect(semantics.kind).toBe("file-change");
    expect(semantics.watchedPatterns).toEqual([{ pattern, status: "changed" }]);
    expect(filterJobRunChanges(effect.changes)).toEqual({});
  });

  test("tracks selected membership, first arming, and create details", () => {
    for (const [oldValue, newValue, status, kind] of [
      [undefined, "hash", "added", "file-change"],
      ["hash", undefined, "removed", "recreate"],
    ] as const) {
      const effect: JobRunEffect = {
        name: "membership",
        action: "recreate",
        changes: {
          "lifecycle.triggers_state.on_file_change['*.yaml']": {
            action: "recreate",
            ...(oldValue === undefined ? {} : { old: oldValue }),
            ...(newValue === undefined ? {} : { new: newValue }),
          },
        },
        runPageUrl: undefined,
        newState: undefined,
        remoteState: undefined,
      };
      const semantics = classifyJobRunEffect(effect);
      expect(semantics.kind).toBe(kind);
      expect(semantics.watchedPatterns).toEqual([{ pattern: "*.yaml", status }]);
    }

    const firstArm: JobRunEffect = {
      name: "first-arm",
      action: "recreate",
      changes: {
        lifecycle: {
          action: "recreate",
          new: { triggers_state: { on_file_change: { "*.yaml": "hash" } } },
        },
      },
      runPageUrl: undefined,
      newState: undefined,
      remoteState: undefined,
    };
    expect(classifyJobRunEffect(firstArm).watchedPatterns).toEqual([
      { pattern: "*.yaml", status: "added" },
    ]);

    const create: JobRunEffect = {
      ...firstArm,
      action: "create",
    };
    expect(classifyJobRunEffect(create).wording).toBe("runs on deploy");
    expect(classifyJobRunEffect(create).watchedPatterns).toEqual([
      { pattern: "*.yaml", status: "added" },
    ]);
  });

  test("classifies first arming at the whole file-map path", () => {
    const effect: JobRunEffect = {
      name: "whole-map-first-arm",
      action: "recreate",
      changes: {
        "lifecycle.triggers_state.on_file_change": {
          action: "recreate",
          new: { "*.yaml": "new-hash" },
        },
      },
      runPageUrl: undefined,
      newState: undefined,
      remoteState: undefined,
    };

    expect(classifyJobRunEffect(effect).kind).toBe("file-change");
    expect(classifyJobRunEffect(effect).watchedPatterns).toEqual([
      { pattern: "*.yaml", status: "added" },
    ]);
    expect(filterJobRunChanges(effect.changes)).toEqual({});
  });

  test("filters malformed and null payload sides without discarding them", () => {
    const cases: readonly {
      readonly path: string;
      readonly change: ChangeDesc;
      readonly expected: Readonly<Record<string, ChangeDesc>>;
    }[] = [
      {
        path: "lifecycle.triggers_state.on_file_change",
        change: {
          action: "recreate" as const,
          old: { "*.yaml": "old-hash" },
          new: { "*.yaml": { bad: 2 } },
        },
        expected: {
          "lifecycle.triggers_state.on_file_change": {
            action: "recreate",
            new: { "*.yaml": { bad: 2 } },
          },
        },
      },
      {
        path: "lifecycle.triggers_state.on_file_change['*.yaml']",
        change: { action: "recreate" as const, old: { bad: 1 }, new: "new-hash" },
        expected: {
          "lifecycle.triggers_state.on_file_change['*.yaml']": {
            action: "recreate",
            old: { bad: 1 },
          },
        },
      },
      {
        path: "lifecycle.triggers_state.on_file_change",
        change: { action: "recreate" as const, old: null, new: { "*.yaml": "new-hash" } },
        expected: {
          "lifecycle.triggers_state.on_file_change": { action: "recreate", old: null },
        },
      },
      {
        path: "lifecycle.triggers_state.on_file_change['*.yaml']",
        change: { action: "recreate" as const, old: null, new: "new-hash" },
        expected: {
          "lifecycle.triggers_state.on_file_change['*.yaml']": { action: "recreate", old: null },
        },
      },
    ];
    for (const { path, change, expected } of cases) {
      expect(filterJobRunChanges({ [path]: change })).toEqual(expected);
    }
  });

  test("does not treat arbitrary lookalikes or malformed sibling values as fingerprints", () => {
    const changes = {
      job_parameters: {
        action: "recreate" as const,
        old: { on_file_change: { "*.yaml": "before" } },
        new: { on_file_change: { "*.yaml": "after" } },
      },
      lifecycle: {
        action: "recreate" as const,
        old: {
          triggers_state: { on_bundle_deploy: "old", on_file_change: { "*.yaml": { bad: 1 } } },
        },
        new: {
          triggers_state: { on_bundle_deploy: "new", on_file_change: { "*.yaml": { bad: 2 } } },
        },
      },
    };
    const semantics = classifyJobRunEffect({
      name: "lookalike",
      action: "recreate",
      changes,
      runPageUrl: undefined,
      newState: undefined,
      remoteState: undefined,
    });
    expect(semantics.watchedPatterns).toEqual([]);
    expect(filterJobRunChanges(changes)["lifecycle"]?.old).toEqual({
      triggers_state: { on_file_change: { "*.yaml": { bad: 1 } } },
    });
  });

  test("filters escaped quoted selectors while preserving decoded pattern details", () => {
    const pattern = "configs/[prod]'s\\archive.yaml";
    const encodedPattern = pattern.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
    const path = `lifecycle.triggers_state.on_file_change['${encodedPattern}']`;
    const effect: JobRunEffect = {
      name: "escaped",
      action: "recreate",
      changes: { [path]: { action: "recreate", old: "hash-before", new: "hash-after" } },
      runPageUrl: undefined,
      newState: undefined,
      remoteState: undefined,
    };

    expect(classifyJobRunEffect(effect).watchedPatterns).toEqual([{ pattern, status: "changed" }]);
    expect(filterJobRunChanges(effect.changes)).toEqual({});
  });

  test("malformed selectors and legacy user-authored file settings remain visible", () => {
    const changes = {
      "lifecycle.triggers_state.on_file_change['unterminated]": {
        action: "recreate" as const,
        old: "hash-before",
        new: "hash-after",
      },
      "lifecycle.triggers_state.on_file_change": {
        action: "recreate" as const,
        old: { pattern: { unexpected: "nested" } },
        new: { pattern: { unexpected: "different" } },
      },
      "lifecycle.triggers.on_file_change": {
        action: "recreate" as const,
        old: { include: ["*.yaml"] },
        new: { include: ["*.json"] },
      },
    };

    expect(filterJobRunChanges(changes)).toEqual(changes);
    expect(
      classifyJobRunEffect({
        name: "malformed",
        action: "recreate",
        changes,
        runPageUrl: undefined,
        newState: undefined,
        remoteState: undefined,
      }).kind,
    ).toBe("recreate");
  });

  test("keeps legacy skip wording without recognizable remote state", () => {
    const effect: JobRunEffect = {
      name: "legacy",
      action: "skip",
      runPageUrl: undefined,
      changes: undefined,
      newState: undefined,
      remoteState: undefined,
    };

    expect(classifyJobRunEffect(effect).wording).toBe("already ran");
  });

  test("preserves unrelated lifecycle payload beside trigger fingerprint noise", () => {
    const changes = {
      lifecycle: {
        action: "recreate" as const,
        old: { triggers: { on_bundle_deploy: "old" }, timeout_seconds: 10 },
        new: { triggers: { on_bundle_deploy: "new" }, timeout_seconds: 20 },
      },
      "lifecycle.triggers.on_bundle_deploy": {
        action: "recreate" as const,
        old: "old",
        new: "new",
      },
      "job_parameters['region']": {
        action: "recreate" as const,
        old: "us",
        new: "eu",
      },
    };

    expect(Object.keys(filterJobRunChanges(changes))).toEqual([
      "lifecycle",
      "job_parameters['region']",
    ]);
  });

  test("classifies a mixed armed aggregate and strips only its fingerprint", () => {
    const old = { triggers: { on_bundle_deploy: "old-fingerprint" }, timeout_seconds: 10 };
    const newValue = { triggers: { on_bundle_deploy: "new-fingerprint" }, timeout_seconds: 20 };
    const remote = { triggers: { on_bundle_deploy: "remote-fingerprint" }, timeout_seconds: 30 };
    const change = { action: "recreate" as const, old, new: newValue, remote };
    const effect: JobRunEffect = {
      name: "mixed",
      action: "recreate",
      runPageUrl: undefined,
      changes: { lifecycle: change },
      newState: undefined,
      remoteState: undefined,
    };

    const semantics = classifyJobRunEffect(effect);
    const visible = filterJobRunChanges(effect.changes);

    expect(semantics.kind).toBe("every-deploy");
    expect(semantics.wording).toBe("runs on every deploy");
    expect(visible["lifecycle"]?.old).toEqual({ timeout_seconds: 10 });
    expect(visible["lifecycle"]?.new).toEqual({ timeout_seconds: 20 });
    expect(visible["lifecycle"]?.remote).toEqual({ timeout_seconds: 30 });
    expect(change.old).toEqual(old);
    expect(change.new).toEqual(newValue);
    expect(change.remote).toEqual(remote);
  });

  test("classifies a mixed trigger removal and keeps unrelated lifecycle content", () => {
    const change = {
      action: "skip" as const,
      reason: "trigger removed",
      old: {
        triggers: { on_bundle_deploy: "old-fingerprint", pause_statuses: ["PAUSED"] },
        prevent_destroy: true,
      },
      remote: {
        triggers: { on_bundle_deploy: "remote-fingerprint", pause_statuses: ["UNPAUSED"] },
        prevent_destroy: false,
      },
    };
    const effect: JobRunEffect = {
      name: "removed",
      action: "skip",
      runPageUrl: undefined,
      changes: { lifecycle: change },
      newState: undefined,
      remoteState: undefined,
    };

    const semantics = classifyJobRunEffect(effect);
    const visible = filterJobRunChanges(effect.changes);

    expect(semantics.kind).toBe("trigger-removed");
    expect(semantics.wording).toBe("deploy trigger removed; no run will start");
    expect(visible["lifecycle"]?.old).toEqual({
      triggers: { pause_statuses: ["PAUSED"] },
      prevent_destroy: true,
    });
    expect(visible["lifecycle"]?.new).toBeUndefined();
    expect(visible["lifecycle"]?.remote).toEqual({
      triggers: { pause_statuses: ["UNPAUSED"] },
      prevent_destroy: false,
    });
    expect(change.old).toEqual({
      triggers: { on_bundle_deploy: "old-fingerprint", pause_statuses: ["PAUSED"] },
      prevent_destroy: true,
    });
    expect(Object.hasOwn(visible["lifecycle"] ?? {}, "new")).toBe(false);
  });

  test("removes a trigger-only aggregate completely", () => {
    const changes = {
      "lifecycle.triggers": {
        action: "recreate" as const,
        old: { on_bundle_deploy: "old-fingerprint" },
        new: { on_bundle_deploy: "new-fingerprint" },
      },
    };

    expect(filterJobRunChanges(changes)).toEqual({});
  });

  test("leaves an unrelated lifecycle change unchanged", () => {
    const change = {
      action: "recreate" as const,
      old: { timeout_seconds: 10 },
      new: { timeout_seconds: 20 },
      remote: { timeout_seconds: 10 },
    };

    const visible = filterJobRunChanges({ lifecycle: change });

    expect(visible["lifecycle"]).toBe(change);
    expect(visible["lifecycle"]?.old).toEqual({ timeout_seconds: 10 });
    expect(visible["lifecycle"]?.new).toEqual({ timeout_seconds: 20 });
    expect(visible["lifecycle"]?.remote).toEqual({ timeout_seconds: 10 });
  });
});
