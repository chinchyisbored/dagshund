import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ModifiedBody } from "../../../src/components/detail-panel/modified-body.tsx";
import type { DagNodeData } from "../../../src/types/graph-types.ts";
import type { ChangeDesc } from "../../../src/types/plan-schema.ts";
import { compose, withValueFormat } from "../../helpers/providers.tsx";

/** Build a DagNodeData stub (jobs / tasks / sub-resources share this shape for the body). */
const makeData = (overrides: Partial<DagNodeData> = {}): DagNodeData =>
  ({
    nodeKind: "job",
    label: "job",
    diffState: "modified",
    resourceKey: "resources.jobs.j",
    changes: undefined,
    resourceState: undefined,
    newState: undefined,
    remoteState: undefined,
    resourceHasShapeDrift: false,
    taskChangeSummary: undefined,
    ...overrides,
  }) as DagNodeData;

const renderBody = (
  fieldChanges: readonly (readonly [string, ChangeDesc])[],
  data: DagNodeData = makeData(),
) =>
  render(<ModifiedBody data={data} fieldChanges={fieldChanges} />, {
    wrapper: compose(withValueFormat()),
  });

/** Extract section labels in document order. The body emits SectionDivider
 *  per group; those carry a short label span we can scan by text content. */
const sectionLabels = (container: HTMLElement): string[] => {
  const known = [
    "Added",
    "Modified",
    "Removed",
    "Remote-only (not managed by bundle)",
    "Unchanged",
  ];
  const text = container.textContent ?? "";
  return known.filter((label) => text.includes(label));
};

describe("ModifiedBody groupChangesByCategory (dagshund-1naj)", () => {
  test("derived-create entries land under 'Added' (not 'Modified')", () => {
    // CLI emits action:"update" for every field inside an update — shape is has_new only.
    const change: ChangeDesc = { action: "update", new: { task_key: "transform" } };
    const { container } = renderBody([
      ["tasks[task_key='t'].depends_on[task_key='transform']", change],
    ]);
    const labels = sectionLabels(container);
    expect(labels).toContain("Added");
    expect(labels).not.toContain("Modified");
  });

  test("derived-delete entries land under 'Removed'", () => {
    const change: ChangeDesc = { action: "update", old: "goodbye" };
    const { container } = renderBody([["some_field", change]]);
    const labels = sectionLabels(container);
    expect(labels).toContain("Removed");
  });

  test("update-family entries (old+new) land under 'Modified'", () => {
    const change: ChangeDesc = { action: "update", old: "a", new: "b" };
    const { container } = renderBody([["some_field", change]]);
    const labels = sectionLabels(container);
    expect(labels).toContain("Modified");
  });

  test("remote-only entries land under the new 'Remote-only' section", () => {
    const change: ChangeDesc = { action: "update", remote: "server_val" };
    const { container } = renderBody([["email_notifications", change]]);
    const labels = sectionLabels(container);
    expect(labels).toContain("Remote-only (not managed by bundle)");
  });

  test("list-element remote-only reclassified as delete → 'Removed' section (not Remote-only)", () => {
    // Bug 1: key with [field='value'] filter + parent state showing element in remote-not-new
    // should be a delete, not a remote. Grouping follows the derived action.
    const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
    const data = makeData({
      newState: {
        value: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "transform" }] }] },
      },
      remoteState: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "ingest" }] }] },
    });
    const { container } = renderBody(
      [["tasks[task_key='publish'].depends_on[task_key='ingest']", change]],
      data,
    );
    const labels = sectionLabels(container);
    expect(labels).toContain("Removed");
    expect(labels).not.toContain("Remote-only (not managed by bundle)");
  });

  test("task node inherits parent job's shape-drift flag for drift styling (dagshund-1naj)", () => {
    // The publish task's own fieldChanges have no shape-drift signal (the
    // edit_mode drift lives at the job level). `resourceHasShapeDrift` on the
    // node data carries the job-level flag down so the list-element delete
    // below renders with drift styling — matches Python's terminal output.
    const change: ChangeDesc = { action: "update", remote: { task_key: "ingest" } };
    const data = makeData({
      newState: {
        value: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "transform" }] }] },
      },
      remoteState: { tasks: [{ task_key: "publish", depends_on: [{ task_key: "ingest" }] }] },
      resourceHasShapeDrift: true,
    });
    const { container } = renderBody(
      [["tasks[task_key='publish'].depends_on[task_key='ingest']", change]],
      data,
    );
    expect(container.textContent).toContain("drift");
  });

  test("mixed entries split into all applicable sections", () => {
    const data = makeData({
      newState: { value: { depends_on: [{ task_key: "x" }] } },
      remoteState: { depends_on: [] },
    });
    const changes: readonly (readonly [string, ChangeDesc])[] = [
      ["creates", { action: "update", new: "v" }],
      ["modifies", { action: "update", old: "a", new: "b" }],
      ["removes", { action: "update", old: "v" }],
      ["remotes", { action: "update", remote: "server" }],
    ];
    const { container } = renderBody(changes, data);
    const labels = sectionLabels(container);
    expect(labels).toContain("Added");
    expect(labels).toContain("Modified");
    expect(labels).toContain("Removed");
    expect(labels).toContain("Remote-only (not managed by bundle)");
  });
});
