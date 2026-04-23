import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { DiffStateBadge } from "../../../src/components/detail-panel/diff-state-badge.tsx";

describe("DiffStateBadge", () => {
  test("renders the diff state text", () => {
    const { getByText } = render(<DiffStateBadge diffState="added" />);
    expect(getByText("added")).toBeDefined();
  });

  test("applies palette classes tied to the diff state", () => {
    const { container } = render(<DiffStateBadge diffState="removed" />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.className).toContain("bg-diff-removed");
  });

  test("each diff state carries a hover tooltip (dagshund-rkqa)", () => {
    // Covers the full DiffState union — ensures the lookup table and the type
    // stay in sync; a new diffState without a tooltip would fail here at
    // runtime (undefined `title=` attribute).
    const states = ["added", "modified", "removed", "unchanged", "unknown"] as const;
    for (const state of states) {
      const { container } = render(<DiffStateBadge diffState={state} />);
      const span = container.querySelector("span") as HTMLElement;
      expect(span.getAttribute("title")?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("modified tooltip describes field-level changes", () => {
    const { container } = render(<DiffStateBadge diffState="modified" />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.getAttribute("title")).toBe("Has field-level changes");
  });
});
