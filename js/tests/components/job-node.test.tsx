import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  resetMockConnections,
  setMockConnections,
  xyflowMockFactory,
} from "../helpers/xyflow-mock.ts";

mock.module("@xyflow/react", xyflowMockFactory);

const { render } = await import("@testing-library/react");
const { createElement } = await import("react");
const { JobNode } = await import("../../src/components/job-node.tsx");
const { compose, withInteractionState } = await import("../helpers/providers.tsx");
const { makeNodeProps } = await import("../helpers/node-props.ts");

type JobData = {
  readonly nodeKind: "job";
  readonly label: string;
  readonly diffState: "added" | "removed" | "modified" | "unchanged" | "unknown";
  readonly resourceKey: string;
  readonly changes: undefined;
  readonly resourceState: undefined;
  readonly taskChangeSummary: undefined;
};

const makeData = (overrides: Partial<JobData> = {}): JobData => ({
  nodeKind: "job",
  label: "etl_pipeline",
  diffState: "unchanged",
  resourceKey: "jobs.etl_pipeline",
  changes: undefined,
  resourceState: undefined,
  taskChangeSummary: undefined,
  ...overrides,
});

const renderJob = (overrides: Partial<JobData> = {}, wrapper = compose(withInteractionState())) =>
  render(createElement(JobNode, makeNodeProps("j1", makeData(overrides))), { wrapper });

beforeEach(() => {
  resetMockConnections();
});

describe("JobNode", () => {
  test("renders the job name in the header block", () => {
    const { getByText } = renderJob();
    expect(getByText("etl_pipeline")).toBeDefined();
  });

  test("no handles render when there are no connections", () => {
    const { queryByTestId } = renderJob();
    // job-node only renders Handle when hasIncoming/hasOutgoing is true —
    // different from the resource/task pattern which renders hidden handles.
    expect(queryByTestId("handle-target-left")).toBeNull();
    expect(queryByTestId("handle-source-right")).toBeNull();
  });

  test("target handle mounts when an incoming non-lateral connection exists", () => {
    setMockConnections({ target: [{ targetHandle: null }] });
    const { getByTestId } = renderJob();
    expect(getByTestId("handle-target-left")).toBeDefined();
  });

  test("source handle mounts when an outgoing non-lateral connection exists", () => {
    setMockConnections({ source: [{ sourceHandle: null }] });
    const { getByTestId } = renderJob();
    expect(getByTestId("handle-source-right")).toBeDefined();
  });

  test("dim state from hover applies reduced glow-style opacity", () => {
    const { container } = renderJob(
      { diffState: "added" },
      compose(withInteractionState({ hoveredNodeId: "other", connectedIds: new Set(["other"]) })),
    );
    const outer = container.firstElementChild as HTMLElement;
    // buildGlowStyle sets opacity as an inline CSS property when dimmed.
    expect(outer.style.opacity).toBe("0.3");
  });

  test("selection glow applied when the node is selected", () => {
    const { container } = renderJob(
      {},
      compose(
        withInteractionState({ selectedNodeId: "j1", selectedConnectedIds: new Set(["j1"]) }),
      ),
    );
    const outer = container.firstElementChild as HTMLElement;
    // buildGlowStyle uses 2.5px for selected vs 1.5px for hover; exact shadow
    // format is unit-tested in tests/utils/node-dimming.test.ts.
    expect(outer.style.boxShadow).toContain("2.5px");
  });
});
