import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/job-run-outcome-cases.json";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
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
      expect(Object.keys(filterJobRunChanges(effect.changes))).toEqual(expected.visibleChangeKeys);
      if (expected.runPageUrl !== undefined) expect(effect.runPageUrl).toBe(expected.runPageUrl);
    });
  }
});

describe("job run effect visible changes", () => {
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
