import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { DriftPill } from "../../../src/components/detail-panel/drift-pill.tsx";

describe("DriftPill", () => {
  test("renders the 'drift' label with a tooltip title", () => {
    const { getByText, container } = render(<DriftPill />);
    expect(getByText("drift")).toBeDefined();
    const span = container.querySelector("span") as HTMLElement;
    expect(span.title).toContain("re-added on apply");
  });

  test("has the dashed-border visual treatment", () => {
    const { container } = render(<DriftPill />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.className).toContain("border-dashed");
  });
});
