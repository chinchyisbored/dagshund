import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  resetMockConnections,
  setMockConnections,
  xyflowMockFactory,
} from "../helpers/xyflow-mock.ts";

mock.module("@xyflow/react", xyflowMockFactory);

const { render } = await import("@testing-library/react");
const { createElement } = await import("react");
const { HierarchyNode } = await import("../../src/components/hierarchy-node.tsx");
const { compose, withInteractionState, withLateralIsolation } = await import(
  "../helpers/providers.tsx"
);
const { makeNodeProps } = await import("../helpers/node-props.ts");

type HierarchyData = {
  readonly nodeKind: "root" | "phantom";
  readonly label: string;
  readonly diffState: "added" | "removed" | "modified" | "unchanged" | "unknown";
  readonly resourceKey: string;
  readonly changes: undefined;
  readonly resourceState: undefined;
};

const makeData = (overrides: Partial<HierarchyData> = {}): HierarchyData => ({
  nodeKind: "root",
  label: "Pipelines",
  diffState: "unchanged",
  resourceKey: "pipelines",
  changes: undefined,
  resourceState: undefined,
  ...overrides,
});

const renderHierarchy = (
  overrides: Partial<HierarchyData> = {},
  wrapper = compose(withInteractionState()),
) => render(createElement(HierarchyNode, makeNodeProps("h1", makeData(overrides))), { wrapper });

beforeEach(() => {
  resetMockConnections();
});

describe("HierarchyNode", () => {
  test("renders the label", () => {
    const { getByText } = renderHierarchy();
    expect(getByText("Pipelines")).toBeDefined();
  });

  test("phantom nodes apply border-dashed regardless of diffState", () => {
    const { container } = renderHierarchy({ nodeKind: "phantom", diffState: "unchanged" });
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("border-dashed");
  });

  test("phantom nodes render a badge derived from the resource key", () => {
    // Pick a resourceKey whose badge word does not appear in the label, so
    // the assertion can't pass by accident via label text.
    const { container } = renderHierarchy({
      nodeKind: "phantom",
      resourceKey: "catalog::prod",
      label: "prod",
    });
    const badge = container.querySelector("span.bg-badge-bg") as HTMLElement | null;
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("catalog");
  });

  test("root nodes do not render a phantom badge", () => {
    // A root node with a resourceKey that would otherwise produce a badge.
    const { container } = renderHierarchy({ resourceKey: "jobs" });
    // The outer row for the badge still renders but should be empty.
    // Assert there's no element with the badge's distinctive classes.
    const badges = container.querySelectorAll("span.bg-badge-bg");
    expect(badges.length).toBe(0);
  });

  test("target handle hidden when no incoming connections", () => {
    const { getByTestId } = renderHierarchy();
    const target = getByTestId("handle-target-left") as HTMLElement;
    expect(target.style.visibility).toBe("hidden");
  });

  test("source handle visible when an outgoing non-lateral connection exists", () => {
    setMockConnections({ source: [{ sourceHandle: null }] });
    const { getByTestId } = renderHierarchy();
    const source = getByTestId("handle-source-right") as HTMLElement;
    expect(source.style.visibility).toBe("");
  });

  test("LateralIsolateButton renders when node is a lateral node", () => {
    const { getByLabelText } = renderHierarchy(
      {},
      compose(
        withInteractionState({ lateralNodeIds: new Set(["h1"]) }),
        withLateralIsolation(() => {}),
      ),
    );
    expect(getByLabelText("Isolate lateral edges")).toBeDefined();
  });
});
