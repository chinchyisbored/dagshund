import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ChangeEntry } from "../../../src/components/detail-panel/change-entry.tsx";
import type { ChangeDesc } from "../../../src/types/plan-schema.ts";

const makeChange = (overrides: Partial<ChangeDesc> = {}): ChangeDesc =>
  ({
    action: "update",
    old: "a",
    new: "b",
    ...overrides,
  }) as ChangeDesc;

describe("ChangeEntry", () => {
  test("renders the fieldPath", () => {
    const { getByText } = render(<ChangeEntry fieldPath="spec.name" change={makeChange()} />);
    expect(getByText("spec.name")).toBeDefined();
  });

  test("renders the action badge text from the change.action", () => {
    const { container } = render(
      <ChangeEntry fieldPath="x" change={makeChange({ action: "create" })} />,
    );
    expect(container.textContent).toContain("create");
  });

  test("primitive old→new values both render as text", () => {
    const { container } = render(
      <ChangeEntry fieldPath="x" change={makeChange({ old: "alpha", new: "omega" })} />,
    );
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("omega");
  });

  test("null old/new renders without throwing", () => {
    const change = makeChange({ old: null, new: "val" });
    expect(() => render(<ChangeEntry fieldPath="x" change={change} />)).not.toThrow();
  });

  test("nested object values render as text", () => {
    const change = makeChange({ old: { k: 1 }, new: { k: 2 } });
    const { container } = render(<ChangeEntry fieldPath="x" change={change} />);
    expect(container.textContent).toContain("k");
  });

  test("field-level drift (old==new with divergent remote) renders the DriftPill", () => {
    // isDrift triggers when computeStructuralDiff detects the drift swap shape:
    // action=update, old===new structurally, and a `remote` field diverges.
    const change = makeChange({
      old: { k: 1 },
      new: { k: 1 },
      remote: { k: 2 },
    }) as ChangeDesc;
    const { container } = render(<ChangeEntry fieldPath="x" change={change} />);
    expect(container.textContent).toContain("drift");
  });
});
