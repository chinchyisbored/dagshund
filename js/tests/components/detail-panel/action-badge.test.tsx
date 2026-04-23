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

  test("known action carries a hover tooltip (dagshund-rkqa)", () => {
    const { container } = render(<ActionBadge action="recreate" />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.getAttribute("title")).toBe("Will be deleted and recreated");
  });

  test("update_id tooltip distinguishes it from update", () => {
    const { container } = render(<ActionBadge action="update_id" />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.getAttribute("title")).toBe("Will be re-keyed (identifier change)");
  });

  test("unknown action has no tooltip (omitted rather than misleading)", () => {
    const { container } = render(<ActionBadge action="mystery" />);
    const span = container.querySelector("span") as HTMLElement;
    expect(span.getAttribute("title")).toBeNull();
  });
});
