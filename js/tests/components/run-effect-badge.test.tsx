import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { RunEffectBadge } from "../../src/components/run-effect-badge.tsx";
import type { JobRunEffect } from "../../src/utils/normalize-plan.ts";

const makeEffect = (overrides: Partial<JobRunEffect> = {}): JobRunEffect => ({
  name: "nightly",
  action: "create",
  runPageUrl: undefined,
  changes: undefined,
  newState: undefined,
  remoteState: undefined,
  ...overrides,
});

describe("RunEffectBadge", () => {
  test("delete-only effects render no badge", () => {
    const { container } = render(<RunEffectBadge effects={[makeEffect({ action: "delete" })]} />);

    expect(container.textContent).toBe("");
  });

  test("create effect renders a green play badge without a count", () => {
    const { container } = render(<RunEffectBadge effects={[makeEffect()]} />);

    const badge = container.querySelector("span");
    expect(badge?.textContent).toBe("▶");
    expect(badge?.className).toContain("bg-action-create-soft");
    expect(badge?.className).toContain("text-action-create");
  });

  test("skip-only effects render a grey badge with 'already ran' tooltip", () => {
    const { container } = render(
      <RunEffectBadge effects={[makeEffect({ name: "seed_report", action: "skip" })]} />,
    );

    const badge = container.querySelector("span");
    expect(badge?.className).toContain("bg-badge-bg");
    expect(badge?.getAttribute("title")).toBe("seed_report: already ran");
  });

  test("mixed create and skip effects render green with the visible count", () => {
    const { container } = render(
      <RunEffectBadge
        effects={[
          makeEffect({ name: "warm_eu", action: "create" }),
          makeEffect({ name: "warm_us", action: "skip" }),
        ]}
      />,
    );

    const badge = container.querySelector("span");
    expect(badge?.textContent).toBe("▶ 2");
    expect(badge?.className).toContain("bg-action-create-soft");
    expect(badge?.getAttribute("title")).toBe("warm_eu: runs on deploy, warm_us: already ran");
  });

  test("delete effects stay out of the count but appear in the tooltip", () => {
    const { container } = render(
      <RunEffectBadge
        effects={[
          makeEffect({ name: "audit", action: "delete" }),
          makeEffect({ name: "migrate", action: "recreate" }),
        ]}
      />,
    );

    const badge = container.querySelector("span");
    expect(badge?.textContent).toBe("▶");
    expect(badge?.getAttribute("title")).toBe(
      "audit: run record will be deleted, migrate: re-runs on deploy",
    );
  });
});
