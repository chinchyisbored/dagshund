import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { RunEffectsSection } from "../../../src/components/detail-panel/run-effects-section.tsx";
import type { JobRunEffect } from "../../../src/utils/normalize-plan.ts";

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

  test("delete effect shows the destructive wording", () => {
    const { getByText } = render(
      <RunEffectsSection effects={[makeEffect({ name: "audit", action: "delete" })]} />,
    );

    expect(getByText("run record will be deleted")).toBeDefined();
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
