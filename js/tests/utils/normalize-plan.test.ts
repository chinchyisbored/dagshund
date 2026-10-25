import { describe, expect, test } from "bun:test";
import fixture from "../../../fixtures/job-run-effect-cases.json";
import { buildOrphanEffectPhantoms } from "../../src/graph/collect-phantom-nodes.ts";
import { parsePlanJson } from "../../src/parser/parse-plan.ts";
import type { PlanEntry } from "../../src/types/plan-schema.ts";
import { normalizePlan } from "../../src/utils/normalize-plan.ts";
import { extractResourceName } from "../../src/utils/resource-key.ts";
import mergedEffectCases from "./merged-effect-cases.json";

const parseEntries = (rawPlan: unknown): Record<string, PlanEntry> => {
  const result = parsePlanJson({ plan: rawPlan });
  if (!result.ok) throw new Error(`fixture case parse failed: ${result.error}`);
  return { ...(result.data.plan ?? {}) };
};

describe("normalizePlan target resolution (shared fixture — keeps TS + Python in lockstep)", () => {
  for (const rawCase of fixture.cases) {
    test(rawCase.name, () => {
      const effectName = extractResourceName(rawCase.effectKey);

      const { entries, orphanEffects } = normalizePlan(parseEntries(rawCase.plan));

      if (rawCase.expected.target !== null) {
        const target = entries[rawCase.expected.target];
        expect(target?.effects?.map((effect) => effect.name)).toContain(effectName);
        expect(entries[rawCase.effectKey]).toBeUndefined();
      } else if (rawCase.expected.phantomId !== null) {
        const targetId = Number(rawCase.expected.phantomId.split("::")[1]);
        const orphaned = orphanEffects.find(
          (group) => group.targetResourceType === "jobs" && group.targetId === targetId,
        );
        expect(orphaned?.effects.map((effect) => effect.name)).toContain(effectName);
        expect(entries[rawCase.effectKey]).toBeUndefined();

        const phantoms = buildOrphanEffectPhantoms(orphanEffects);
        const phantom = phantoms.find((node) => node.id === rawCase.expected.phantomId);
        expect(phantom?.id).toBe(rawCase.expected.phantomId);
        expect(phantom?.effects?.map((effect) => effect.name)).toContain(effectName);
      } else {
        expect(entries[rawCase.effectKey]).toBeDefined();
        expect(orphanEffects).toEqual([]);
      }
    });
  }
});

describe("normalizePlan effect folding", () => {
  const skipJob: PlanEntry = { action: "skip", remote_state: { job_id: 100 } };
  const createRun: PlanEntry = {
    depends_on: [{ node: "resources.jobs.etl" }],
    action: "create",
    new_state: { value: { job_id: 100 } },
  };

  test("target action, changes, and state stay untouched", () => {
    const { entries } = normalizePlan({
      "resources.jobs.etl": skipJob,
      "resources.job_runs.nightly": createRun,
    });

    const target = entries["resources.jobs.etl"];
    expect(target?.action).toBe("skip");
    expect(target?.changes).toBeUndefined();
    expect(target?.remote_state).toEqual({ job_id: 100 });
  });

  test("multiple effects on one job accumulate sorted by name", () => {
    const { entries } = normalizePlan({
      "resources.jobs.etl": skipJob,
      "resources.job_runs.zulu": createRun,
      "resources.job_runs.alpha": {
        depends_on: [{ node: "resources.jobs.etl" }],
        action: "skip",
        remote_state: { job_id: 100, run_id: 1 },
      },
    });

    expect(entries["resources.jobs.etl"]?.effects?.map((effect) => effect.name)).toEqual([
      "alpha",
      "zulu",
    ]);
  });

  test("run page url must be a plain http(s) url", () => {
    const unsafeUrls = [
      "javascript:alert(1)",
      "https://example.test/run(1)",
      "https://example.test/a b",
      "ftp://x/y",
      "https://example.test/run\n",
    ];
    for (const url of unsafeUrls) {
      const { entries } = normalizePlan({
        "resources.jobs.etl": skipJob,
        "resources.job_runs.sneaky": {
          depends_on: [{ node: "resources.jobs.etl" }],
          action: "skip",
          remote_state: { job_id: 100, run_page_url: url },
        },
      });

      expect(entries["resources.jobs.etl"]?.effects?.[0]?.runPageUrl, url).toBeUndefined();
    }
  });

  test("effect carries action, run page url, and changes", () => {
    const { entries } = normalizePlan({
      "resources.jobs.etl": skipJob,
      "resources.job_runs.migrate": {
        depends_on: [{ node: "resources.jobs.etl" }],
        action: "recreate",
        new_state: { value: { job_id: 100, job_parameters: { v: "2" } } },
        remote_state: { job_id: 100, run_page_url: "https://example.test/run/1" },
        changes: { "job_parameters['v']": { action: "recreate", old: "1", new: "2" } },
      },
    });

    const effect = entries["resources.jobs.etl"]?.effects?.[0];
    expect(effect?.action).toBe("recreate");
    expect(effect?.runPageUrl).toBe("https://example.test/run/1");
    expect(Object.keys(effect?.changes ?? {})).toEqual(["job_parameters['v']"]);
  });

  test("plan without effect entries passes through unchanged", () => {
    const { entries, orphanEffects } = normalizePlan({ "resources.jobs.etl": skipJob });

    expect(entries["resources.jobs.etl"]?.effects).toBeUndefined();
    expect(orphanEffects).toEqual([]);
  });

  for (const effectCase of mergedEffectCases.cases) {
    test(effectCase.name, () => {
      const parsed = parsePlanJson({ plan: effectCase.entries });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("merged-effect fixture must parse");
      const rawEntries = parsed.data.plan ?? {};
      const before = structuredClone(rawEntries);

      const { entries, orphanEffects } = normalizePlan(rawEntries);

      expect(Object.keys(entries)).toEqual(effectCase.expected.entries);
      if (effectCase.expected.permissions) {
        expect(entries["resources.jobs.etl"]?.new_state).toMatchObject({
          value: { permissions: effectCase.expected.permissions },
        });
      }
      for (const [resourceKey, names] of Object.entries(effectCase.expected.effects)) {
        expect(entries[resourceKey]?.effects?.map(({ name }) => name)).toEqual(names);
      }
      expect(
        JSON.stringify(
          orphanEffects.map(({ targetResourceType, targetId, effects }) => ({
            resourceType: targetResourceType,
            targetId,
            effects: effects.map(({ name }) => name),
          })),
        ),
      ).toBe(JSON.stringify(effectCase.expected.orphans));
      expect(rawEntries).toEqual(before);
    });
  }
});
