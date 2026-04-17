import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  resetMockConnections,
  setMockConnections,
  xyflowMockFactory,
} from "../helpers/xyflow-mock.ts";

mock.module("@xyflow/react", xyflowMockFactory);

const { render } = await import("@testing-library/react");
const { createElement } = await import("react");
const { TaskNode } = await import("../../src/components/task-node.tsx");
const { compose, withInteractionState } = await import("../helpers/providers.tsx");
const { makeNodeProps } = await import("../helpers/node-props.ts");

type TaskData = {
  readonly nodeKind: "task";
  readonly label: string;
  readonly diffState: "added" | "removed" | "modified" | "unchanged" | "unknown";
  readonly resourceKey: string;
  readonly taskKey: string;
  readonly changes: undefined;
  readonly resourceState: Readonly<Record<string, unknown>> | undefined;
  readonly isDrift?: boolean;
};

const makeData = (overrides: Partial<TaskData> = {}): TaskData => ({
  nodeKind: "task",
  label: "ingest",
  diffState: "unchanged",
  resourceKey: "jobs.etl",
  taskKey: "jobs.etl::ingest",
  changes: undefined,
  resourceState: { notebook_task: { notebook_path: "/Shared/x" } },
  ...overrides,
});

const renderTask = (overrides: Partial<TaskData> = {}, wrapper = compose(withInteractionState())) =>
  render(createElement(TaskNode, makeNodeProps("t1", makeData(overrides))), { wrapper });

beforeEach(() => {
  resetMockConnections();
});

describe("TaskNode", () => {
  test("renders the task label and a type badge from resourceState", () => {
    const { getByText, container } = renderTask();
    expect(getByText("ingest")).toBeDefined();
    expect(container.textContent).toMatch(/notebook/i);
  });

  test("isDrift=true applies border-dashed", () => {
    const { container } = renderTask({ isDrift: true });
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("border-dashed");
  });

  test("target handle is hidden when no incoming connections exist", () => {
    const { getByTestId } = renderTask();
    const target = getByTestId("handle-target-left") as HTMLElement;
    expect(target.style.visibility).toBe("hidden");
  });

  test("source handle is hidden when no outgoing connections exist", () => {
    const { getByTestId } = renderTask();
    const source = getByTestId("handle-source-right") as HTMLElement;
    expect(source.style.visibility).toBe("hidden");
  });

  test("both handles become visible with non-lateral connections", () => {
    setMockConnections({
      target: [{ targetHandle: null }],
      source: [{ sourceHandle: null }],
    });
    const { getByTestId } = renderTask();
    expect((getByTestId("handle-target-left") as HTMLElement).style.visibility).toBe("");
    expect((getByTestId("handle-source-right") as HTMLElement).style.visibility).toBe("");
  });

  test("selection glow style applied when the node is selected", () => {
    const { container } = renderTask(
      {},
      compose(
        withInteractionState({ selectedNodeId: "t1", selectedConnectedIds: new Set(["t1"]) }),
      ),
    );
    const outer = container.firstElementChild as HTMLElement;
    // buildGlowStyle uses 2.5px for selected vs 1.5px for hover; exact shadow
    // format is unit-tested in tests/utils/node-dimming.test.ts.
    expect(outer.style.boxShadow).toContain("2.5px");
  });
});
