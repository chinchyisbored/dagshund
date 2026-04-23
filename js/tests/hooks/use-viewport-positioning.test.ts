import { describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { InternalNode, Node, ReactFlowInstance } from "@xyflow/react";
import { useViewportPositioning } from "../../src/hooks/use-viewport-positioning.ts";

type InstanceSpies = {
  readonly fitView: ReturnType<typeof mock>;
  readonly zoomIn: ReturnType<typeof mock>;
  readonly zoomOut: ReturnType<typeof mock>;
  readonly setCenter: ReturnType<typeof mock>;
  readonly getZoom: ReturnType<typeof mock>;
  readonly getInternalNode: ReturnType<typeof mock>;
};

const makeInternalNode = (id: string, x: number, y: number): InternalNode =>
  ({
    id,
    internals: { positionAbsolute: { x, y } },
    measured: { width: 200, height: 56 },
  }) as unknown as InternalNode;

const makeFakeInstance = (
  internalNodesById: ReadonlyMap<string, InternalNode> = new Map(),
): { readonly instance: ReactFlowInstance; readonly spies: InstanceSpies } => {
  const spies: InstanceSpies = {
    fitView: mock(() => true),
    zoomIn: mock(() => {}),
    zoomOut: mock(() => {}),
    setCenter: mock(() => {}),
    getZoom: mock(() => 1),
    getInternalNode: mock((id: string) => internalNodesById.get(id)),
  };
  return {
    instance: spies as unknown as ReactFlowInstance,
    spies,
  };
};

const makeNode = (id: string, parentId?: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
  ...(parentId !== undefined ? { parentId } : {}),
});

describe("useViewportPositioning", () => {
  test("handleFitView is a no-op before handleInit stores an instance", () => {
    const { result } = renderHook(() =>
      useViewportPositioning({
        baseNodes: [],
        isVisible: true,
        isLayoutReady: false,
        directMatchIds: null,
      }),
    );
    expect(() => result.current.handleFitView()).not.toThrow();
    expect(result.current.hasFitted).toBe(false);
  });

  test("handleFitView delegates to the stored instance", () => {
    const { instance, spies } = makeFakeInstance();
    const { result } = renderHook(() =>
      useViewportPositioning({
        baseNodes: [],
        isVisible: true,
        isLayoutReady: false,
        directMatchIds: null,
      }),
    );
    act(() => result.current.handleInit(instance));
    act(() => result.current.handleFitView());
    expect(spies.fitView).toHaveBeenCalledTimes(1);
  });

  test("handleZoomIn delegates to the stored instance", () => {
    const { instance, spies } = makeFakeInstance();
    const { result } = renderHook(() =>
      useViewportPositioning({
        baseNodes: [],
        isVisible: true,
        isLayoutReady: false,
        directMatchIds: null,
      }),
    );
    act(() => result.current.handleInit(instance));
    act(() => result.current.handleZoomIn());
    expect(spies.zoomIn).toHaveBeenCalledTimes(1);
  });

  test("handleZoomOut delegates to the stored instance", () => {
    const { instance, spies } = makeFakeInstance();
    const { result } = renderHook(() =>
      useViewportPositioning({
        baseNodes: [],
        isVisible: true,
        isLayoutReady: false,
        directMatchIds: null,
      }),
    );
    act(() => result.current.handleInit(instance));
    act(() => result.current.handleZoomOut());
    expect(spies.zoomOut).toHaveBeenCalledTimes(1);
  });

  test("centerOnNode delegates to instance.setCenter when the node exists", () => {
    const nodes = new Map([["n1", makeInternalNode("n1", 100, 200)]]);
    const { instance, spies } = makeFakeInstance(nodes);
    const { result } = renderHook(() =>
      useViewportPositioning({
        baseNodes: [],
        isVisible: true,
        isLayoutReady: false,
        directMatchIds: null,
      }),
    );
    act(() => result.current.handleInit(instance));
    act(() => result.current.centerOnNode("n1"));
    expect(spies.getInternalNode).toHaveBeenCalledWith("n1");
    expect(spies.setCenter).toHaveBeenCalledTimes(1);
  });

  test("auto-fits exactly once after nodes + visibility when no focus is set", async () => {
    const { instance, spies } = makeFakeInstance();
    const baseNodes = [makeNode("a")];
    const { result, rerender } = renderHook(
      ({ visible, nodes }: { visible: boolean; nodes: readonly Node[] }) =>
        useViewportPositioning({
          baseNodes: nodes,
          isVisible: visible,
          isLayoutReady: false,
          directMatchIds: null,
        }),
      { initialProps: { visible: false, nodes: [] as readonly Node[] } },
    );
    act(() => result.current.handleInit(instance));
    rerender({ visible: true, nodes: baseNodes });
    await waitFor(() => expect(spies.fitView).toHaveBeenCalledWith({ maxZoom: 1, padding: 0.15 }), {
      timeout: 500,
    });
    expect(result.current.hasFitted).toBe(true);
  });
});
