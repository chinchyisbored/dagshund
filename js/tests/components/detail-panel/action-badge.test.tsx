import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ActionBadge } from "../../../src/components/detail-panel/action-badge.tsx";

describe("ActionBadge", () => {
  test("renders the action text", () => {
    const { getByText } = render(<ActionBadge action="create" />);
    expect(getByText("create")).toBeDefined();
  });

  test("known action gets its color class", () => {
    const { container } = render(<ActionBadge action="delete" />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.className).toContain("text-action-delete");
  });

  test("unknown action falls back to the badge palette", () => {
    const { container } = render(<ActionBadge action="mystery" />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.className).toContain("text-badge-text");
  });
});
