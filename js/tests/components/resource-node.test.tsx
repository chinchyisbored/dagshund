import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  resetMockConnections,
  setMockConnections,
  xyflowMockFactory,
} from "../helpers/xyflow-mock.ts";

mock.module("@xyflow/react", xyflowMockFactory);

const { render, fireEvent } = await import("@testing-library/react");
const { createElement } = await import("react");
const { ResourceNode } = await import("../../src/components/resource-node.tsx");
const { compose, withInteractionState, withJobNavigation, withLateralIsolation } = await import(
  "../helpers/providers.tsx"
);
const { makeNodeProps } = await import("../helpers/node-props.ts");

type ResourceData = {
  readonly nodeKind: "resource";
  readonly label: string;
  readonly diffState: "added" | "removed" | "modified" | "unchanged" | "unknown";
  readonly resourceKey: string;
  readonly changes: undefined;
  readonly resourceState: undefined;
  readonly newState: undefined;
  readonly remoteState: undefined;
  readonly resourceHasShapeDrift: boolean;
  readonly taskChangeSummary: undefined;
  readonly isDrift?: boolean;
};

const makeData = (overrides: Partial<ResourceData> = {}): ResourceData => ({
  nodeKind: "resource",
  label: "my-resource",
  diffState: "unchanged",
  resourceKey: "resources.pipelines.etl_pipeline",
  changes: undefined,
  resourceState: undefined,
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
  taskChangeSummary: undefined,
  ...overrides,
});

const renderResource = (
  overrides: Partial<ResourceData> = {},
  wrapper = compose(withInteractionState()),
) => render(createElement(ResourceNode, makeNodeProps("n1", makeData(overrides))), { wrapper });

beforeEach(() => {
  resetMockConnections();
});

describe("ResourceNode", () => {
  test("renders the label and resource-type badge", () => {
    const { getByText, container } = renderResource();
    expect(getByText("my-resource")).toBeDefined();
    expect(container.textContent).toContain("pipeline");
  });

  test("isDrift=true applies border-dashed", () => {
    const { container } = renderResource({ isDrift: true });
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("border-dashed");
  });

  test("target handle is visibility:hidden when there are no incoming edges", () => {
    const { getByTestId } = renderResource();
    const target = getByTestId("handle-target-left") as HTMLElement;
    expect(target.style.visibility).toBe("hidden");
  });

  test("target handle is visible when an incoming non-lateral connection exists", () => {
    setMockConnections({ target: [{ targetHandle: null }] });
    const { getByTestId } = renderResource();
    const target = getByTestId("handle-target-left") as HTMLElement;
    expect(target.style.visibility).toBe("");
  });

  test("source handle is visibility:hidden when there are no outgoing edges", () => {
    const { getByTestId } = renderResource();
    const source = getByTestId("handle-source-right") as HTMLElement;
    expect(source.style.visibility).toBe("hidden");
  });

  test("filter-unmatched node gets dimmed inline opacity via glowStyle", () => {
    const { container } = renderResource(
      { diffState: "added" },
      compose(withInteractionState({ filterMatchedIds: new Set(["other"]) })),
    );
    const outer = container.firstElementChild as HTMLElement;
    // buildGlowStyle sets opacity: 0.3 when the node is dimmed by filter.
    expect(outer.style.opacity).toBe("0.3");
  });

  test("job resource renders job-navigation button and fires callback on pointer-down", () => {
    const calls: string[] = [];
    const handler = (key: string): void => {
      calls.push(key);
    };
    const { getByLabelText } = renderResource(
      { resourceKey: "resources.jobs.my_job" },
      compose(withInteractionState(), withJobNavigation(handler)),
    );
    const btn = getByLabelText("View in Jobs tab");
    fireEvent.pointerDown(btn);
    expect(calls).toEqual(["resources.jobs.my_job"]);
  });

  test("LateralIsolateButton renders when hasLateralEdges is true", () => {
    const { getByLabelText } = renderResource(
      {},
      compose(
        withInteractionState({ lateralNodeIds: new Set(["n1"]) }),
        withLateralIsolation(() => {}),
      ),
    );
    expect(getByLabelText("Isolate lateral edges")).toBeDefined();
  });
});
