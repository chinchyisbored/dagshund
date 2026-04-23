import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ChangeEntry } from "../../../src/components/detail-panel/change-entry.tsx";
import type { ChangeDesc } from "../../../src/types/plan-schema.ts";
import type { FieldChangeContext } from "../../../src/utils/field-action.ts";

const makeChange = (overrides: Partial<ChangeDesc> = {}): ChangeDesc =>
  ({
    action: "update",
    old: "a",
    new: "b",
    ...overrides,
  }) as ChangeDesc;

const ctxFor = (
  changeKey: string,
  overrides: Partial<FieldChangeContext> = {},
): FieldChangeContext => ({
  changeKey,
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
  ...overrides,
});

describe("ChangeEntry", () => {
  test("renders the fieldPath", () => {
    const { getByText } = render(
      <ChangeEntry fieldPath="spec.name" change={makeChange()} ctx={ctxFor("spec.name")} />,
    );
    expect(getByText("spec.name")).toBeDefined();
  });

  test("renders the action badge text from the change.action", () => {
    const { container } = render(
      <ChangeEntry fieldPath="x" change={makeChange({ action: "create" })} ctx={ctxFor("x")} />,
    );
    expect(container.textContent).toContain("create");
  });

  test("primitive old→new values both render as text", () => {
    const { container } = render(
      <ChangeEntry
        fieldPath="x"
        change={makeChange({ old: "alpha", new: "omega" })}
        ctx={ctxFor("x")}
      />,
    );
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("omega");
  });

  test("null old/new renders without throwing", () => {
    const change = makeChange({ old: null, new: "val" });
    expect(() =>
      render(<ChangeEntry fieldPath="x" change={change} ctx={ctxFor("x")} />),
    ).not.toThrow();
  });

  test("nested object values render as text", () => {
    const change = makeChange({ old: { k: 1 }, new: { k: 2 } });
    const { container } = render(<ChangeEntry fieldPath="x" change={change} ctx={ctxFor("x")} />);
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
    const { container } = render(<ChangeEntry fieldPath="x" change={change} ctx={ctxFor("x")} />);
    expect(container.textContent).toContain("drift");
  });

  test("list-element delete with shape drift renders drift styling (dagshund-1naj)", () => {
    const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
    const ctx = ctxFor("depends_on[task_key='ingest']", {
      newState: { depends_on: [] },
      remoteState: { depends_on: [{ task_key: "ingest" }] },
      resourceHasShapeDrift: true,
    });
    const { container } = render(
      <ChangeEntry fieldPath="depends_on[task_key='ingest']" change={change} ctx={ctx} />,
    );
    expect(container.textContent).toContain("delete");
    expect(container.textContent).toContain("drift");
  });

  test("list-element delete without shape drift is plain delete, no drift pill", () => {
    const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
    const ctx = ctxFor("depends_on[task_key='ingest']", {
      newState: { depends_on: [] },
      remoteState: { depends_on: [{ task_key: "ingest" }] },
      resourceHasShapeDrift: false,
    });
    const { container } = render(
      <ChangeEntry fieldPath="depends_on[task_key='ingest']" change={change} ctx={ctx} />,
    );
    expect(container.textContent).toContain("delete");
    expect(container.textContent).not.toContain("drift");
  });
});
