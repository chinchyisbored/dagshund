import { type CSSProperties, createElement, type ReactElement, useEffect } from "react";

// Shared @xyflow/react module mock for tests that render node components or
// exercise useNodeConnections.
//
// IMPORTANT — install per test file only:
//   import { mock } from "bun:test";
//   import { xyflowMockFactory } from "../helpers/xyflow-mock.ts";
//   mock.module("@xyflow/react", xyflowMockFactory);
//
// Do NOT hoist into tests/setup.ts. bun:test's mock.module is process-global
// and sticky; any future test that needs the real @xyflow/react (e.g. a
// <ReactFlowProvider>-backed flow-canvas test) would silently see the mock.
// Scoping the install to each file makes the intent visible per test.

type MockConnection = {
  readonly sourceHandle?: string | null;
  readonly targetHandle?: string | null;
};

type ConnectionsConfig = {
  readonly target: readonly MockConnection[];
  readonly source: readonly MockConnection[];
};

let currentConnections: ConnectionsConfig = { target: [], source: [] };

/** Configure the connections that useNodeConnections returns. Call before render. */
export const setMockConnections = (config: Partial<ConnectionsConfig>): void => {
  currentConnections = {
    target: config.target ?? [],
    source: config.source ?? [],
  };
};

/** Reset to empty arrays. Call from afterEach to prevent leakage across tests. */
export const resetMockConnections = (): void => {
  currentConnections = { target: [], source: [] };
};

type HandleProps = {
  readonly type: "source" | "target";
  readonly position: string;
  readonly className?: string;
  readonly style?: CSSProperties;
};

type MockFlowNode = {
  readonly id: string;
  readonly data?: {
    readonly label?: string;
  };
};

type ReactFlowProps = {
  readonly nodes?: readonly MockFlowNode[];
  readonly children?: ReactElement | readonly ReactElement[];
  readonly onInit?: (instance: {
    readonly fitView: () => void;
    readonly zoomIn: () => void;
    readonly zoomOut: () => void;
    readonly setCenter: () => void;
    readonly getNodes: () => readonly MockFlowNode[];
  }) => void;
};

const ReactFlow = ({ nodes = [], children, onInit }: ReactFlowProps): ReactElement => {
  useEffect(() => {
    onInit?.({
      fitView: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      setCenter: () => undefined,
      getNodes: () => nodes,
    });
  }, [nodes, onInit]);

  return createElement(
    "div",
    { "data-testid": "react-flow" },
    nodes.map((node) =>
      createElement(
        "div",
        { key: node.id, "data-testid": `flow-node-${node.id}` },
        node.data?.label ?? node.id,
      ),
    ),
    children,
  );
};

const Panel = ({
  children,
}: {
  readonly children?: ReactElement | readonly ReactElement[];
}): ReactElement => createElement("div", { "data-testid": "flow-panel" }, children);

// Stub that spreads all props (including style, className) so tests can assert
// on the real production style.visibility conditional used by resource/task/
// hierarchy-node. The type+position compose into a stable testid.
const Handle = ({ type, position, ...rest }: HandleProps): ReactElement =>
  createElement("div", {
    "data-testid": `handle-${type}-${position}`,
    "data-handle-type": type,
    "data-handle-position": position,
    ...rest,
  });

const Position = { Top: "top", Bottom: "bottom", Left: "left", Right: "right" } as const;

const useNodeConnections = (opts: {
  readonly handleType: "source" | "target";
}): readonly MockConnection[] =>
  opts.handleType === "target" ? currentConnections.target : currentConnections.source;

export const xyflowMockFactory = (): Record<string, unknown> => ({
  Handle,
  Panel,
  Position,
  ReactFlow,
  useNodeConnections,
});
