import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ResourceStateView } from "../../../src/components/detail-panel/resource-state-view.tsx";
import { compose, withValueFormat } from "../../helpers/providers.tsx";

const renderView = (state: Readonly<Record<string, unknown>>, format: "json" | "yaml" = "json") =>
  render(<ResourceStateView resourceState={state} />, {
    wrapper: compose(withValueFormat(format)),
  });

describe("ResourceStateView", () => {
  test("renders each key with its formatted value", () => {
    const { container } = renderView({ name: "alpha", count: 3 });
    expect(container.textContent).toContain("name");
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("count");
    expect(container.textContent).toContain("3");
  });

  test("keys render in sorted order", () => {
    const { container } = renderView({ zebra: 1, alpha: 2, mango: 3 });
    const text = container.textContent ?? "";
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("mango"));
    expect(text.indexOf("mango")).toBeLessThan(text.indexOf("zebra"));
  });

  test("null values render without throwing", () => {
    expect(() => renderView({ nullable: null })).not.toThrow();
  });

  test("nested object values render via formatValue", () => {
    const { container } = renderView({ nested: { inner: "v" } });
    expect(container.textContent).toContain("inner");
  });

  test("empty object renders no rows", () => {
    const { container } = renderView({});
    // Outer flex container with no children rows beyond the wrapper div.
    const rows = container.querySelectorAll("div.rounded.border");
    expect(rows.length).toBe(0);
  });
});
