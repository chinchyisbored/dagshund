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
});
