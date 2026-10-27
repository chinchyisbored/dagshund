import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { RunEffectsSection } from "../../../src/components/detail-panel/run-effects-section.tsx";
import type { JobRunEffect } from "../../../src/utils/normalize-plan.ts";
import { buildResourceGraphFromPlan } from "../../helpers/build-graphs-from-plan.ts";
import { loadFixture } from "../../helpers/load-fixture.ts";

const makeEffect = (overrides: Partial<JobRunEffect> = {}): JobRunEffect => ({
  name: "nightly",
  action: "create",
  runPageUrl: undefined,
  changes: undefined,
  newState: undefined,
  remoteState: undefined,
  ...overrides,
});

describe("RunEffectsSection", () => {
  test("renders effects from the live cleanup and trigger fixture", async () => {
    const plan = await loadFixture("cleanup-job-run-triggers");
    const graph = buildResourceGraphFromPlan(plan);
    const job = graph.nodes.find((node) => node.id === "resources.jobs.trigger_job");
    if (job === undefined || !("effects" in job)) throw new Error("fixture job not found");

    const { container } = render(<RunEffectsSection effects={job.effects ?? []} />);

    expect(container.textContent).toContain("every_deploy");
    expect(container.textContent).toContain("runs on every deploy");
    expect(container.textContent).toContain("file_change");
    expect(container.textContent).toContain("watched pattern watched.txt: changed");
    expect(container.textContent).toContain(
      "run entry removed from bundle state; run history preserved",
    );
    expect(container.textContent).not.toContain("run record will be deleted");
  });
  test("renders the section heading and each effect name with its wording", () => {
    const { container, getByText } = render(
      <RunEffectsSection
        effects={[
          makeEffect({ name: "initial_seed", action: "create" }),
          makeEffect({ name: "seed_report", action: "skip" }),
        ]}
      />,
    );

    expect(container.textContent).toContain("Deploy-triggered runs");
    expect(container.textContent).toContain("initial_seed");
    expect(getByText("runs on deploy")).toBeDefined();
    expect(getByText("already ran")).toBeDefined();
  });

  test("delete effect describes bundle entry removal without claiming history deletion", () => {
    const { container, getByText } = render(
      <RunEffectsSection effects={[makeEffect({ name: "audit", action: "delete" })]} />,
    );

    expect(getByText("bundle run entry will be removed")).toBeDefined();
    expect(container.textContent).not.toContain("run record will be deleted");
  });

  test("cleanup effect preserves history without a play badge or destructive details", () => {
    const { container } = render(
      <RunEffectsSection
        effects={[
          makeEffect({
            name: "audit_cleanup",
            action: "delete",
            stateOnly: true,
            runPageUrl: "https://example.test/run/7",
            changes: { state: { action: "delete", old: "TERMINATED" } },
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain(
      "run entry removed from bundle state; run history preserved",
    );
    expect(container.textContent).not.toContain("▶");
    expect(container.textContent).not.toContain("run record will be deleted");
    expect(container.textContent).not.toContain("TERMINATED");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.test/run/7");
  });

  test("run page url renders as an external link", () => {
    const { container } = render(
      <RunEffectsSection
        effects={[
          makeEffect({
            name: "seed_report",
            action: "skip",
            runPageUrl: "https://example.test/run/7",
          }),
        ]}
      />,
    );

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/run/7");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
  });

  test("no link renders when the run has no page url", () => {
    const { container } = render(<RunEffectsSection effects={[makeEffect()]} />);

    expect(container.querySelector("a")).toBeNull();
  });

  test("in-progress effect renders its state message and semantic wording", () => {
    const { container, getByText } = render(
      <RunEffectsSection
        effects={[
          makeEffect({
            name: "running",
            action: "skip",
            remoteState: {
              state: {
                life_cycle_state: "RUNNING",
                state_message: "The existing run is still active.",
              },
            },
            changes: {
              result_state: { action: "skip", reason: "run in progress", new: "" },
            },
          }),
        ]}
      />,
    );

    expect(getByText("run still in progress")).toBeDefined();
    expect(container.textContent).toContain("State: The existing run is still active.");
    expect(container.textContent).not.toContain("result_state");
  });

  test("hides trigger fingerprints but keeps real parameter changes", () => {
    const { container } = render(
      <RunEffectsSection
        effects={[
          makeEffect({
            name: "every_deploy",
            action: "recreate",
            changes: {
              lifecycle: {
                action: "recreate",
                old: { triggers: { on_bundle_deploy: "fingerprint-before" } },
                new: { triggers: { on_bundle_deploy: "fingerprint-after" } },
              },
              "lifecycle.triggers": {
                action: "recreate",
                old: { on_bundle_deploy: "fingerprint-before" },
                new: { on_bundle_deploy: "fingerprint-after" },
              },
              "lifecycle.triggers.on_bundle_deploy": {
                action: "recreate",
                old: "fingerprint-before",
                new: "fingerprint-after",
              },
              "job_parameters['region']": {
                action: "recreate",
                old: "us",
                new: "eu",
              },
            },
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain("runs on every deploy");
    expect(container.textContent).toContain("job_parameters['region']");
    expect(container.textContent).toContain("us");
    expect(container.textContent).toContain("eu");
    expect(container.textContent).not.toContain("fingerprint-before");
    expect(container.textContent).not.toContain("fingerprint-after");
  });

  test("renders watched patterns while hiding modern fingerprint hashes", () => {
    const { container } = render(
      <RunEffectsSection
        effects={[
          makeEffect({
            name: "file_trigger",
            action: "recreate",
            changes: {
              "lifecycle.triggers_state.on_file_change": {
                action: "recreate",
                old: { "configs/[prod].yaml": "hash-before", "obsolete/*.yaml": "removed-hash" },
                new: { "configs/[prod].yaml": "hash-after", "new/*.json": "added-hash" },
              },
            },
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain("re-runs on deploy (file-change trigger)");
    expect(container.textContent).toContain("watched pattern configs/[prod].yaml: changed");
    expect(container.textContent).toContain("watched pattern new/*.json: added");
    expect(container.textContent).toContain("watched pattern obsolete/*.yaml: removed");
    expect(container.textContent).not.toContain("hash-before");
    expect(container.textContent).not.toContain("hash-after");
    expect(container.textContent).not.toContain("removed-hash");
  });

  test("renders malformed modern bundle trigger values while hiding valid fingerprints", () => {
    const { container } = render(
      <RunEffectsSection
        effects={[
          makeEffect({
            name: "malformed_trigger",
            action: "recreate",
            changes: {
              "lifecycle.triggers_state.on_bundle_deploy": {
                action: "recreate",
                old: "SENTINEL_UUID",
                new: { unexpected: 2 },
              },
            },
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain("re-runs on deploy");
    expect(container.textContent).toContain("unexpected");
    expect(container.textContent).toContain("2");
    expect(container.textContent).not.toContain("SENTINEL_UUID");
  });

  test("recreate effect renders its field changes through ChangeEntry", () => {
    const { container } = render(
      <RunEffectsSection
        effects={[
          makeEffect({
            name: "apply_migrations",
            action: "recreate",
            changes: {
              "job_parameters['migration_version']": {
                action: "recreate",
                old: "v1",
                new: "v2",
              },
            },
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain("job_parameters['migration_version']");
    expect(container.textContent).toContain("v1");
    expect(container.textContent).toContain("v2");
  });
});
