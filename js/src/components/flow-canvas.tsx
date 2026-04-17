import type { NodeMouseHandler, NodeTypes } from "@xyflow/react";
import { startTransition, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  InteractionContext,
  LateralIsolationContext,
  useTabVisibility,
} from "../hooks/contexts.ts";
import { useLateralEdgeState } from "../hooks/use-lateral-edge-state.ts";
import { useNodeSearch } from "../hooks/use-node-search.ts";
import { usePhantomLeafState } from "../hooks/use-phantom-leaf-state.ts";
import type { GraphLayoutState } from "../hooks/use-plan-graph.ts";
import { useResizeHandle } from "../hooks/use-resize-handle.ts";
import { useStyledEdges } from "../hooks/use-styled-edges.ts";
import { useViewportPositioning } from "../hooks/use-viewport-positioning.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import {
  buildConnectedNodeIds,
  resolveLateralContext,
  resolvePhantomContext,
} from "../utils/connected-nodes.ts";
import { getNodeData } from "../utils/node-data.ts";
import { DetailPanel } from "./detail-panel/index.ts";
import { type FilterableDiffState, isFilterableDiffState } from "./diff-filter-toolbar.tsx";
import { FlowCanvasLayout } from "./flow-canvas-layout.tsx";

type FlowCanvasProps = {
  readonly layoutState: GraphLayoutState;
  readonly nodeTypes: NodeTypes;
  readonly focusNodeId?: string | null;
  readonly onFocusComplete?: () => void;
  readonly emptyLabel?: string;
};

type SelectedNode = { readonly id: string; readonly data: DagNodeData };

type CanvasState = {
  readonly selected: SelectedNode | null;
  readonly hoveredNodeId: string | null;
  readonly filterDiffState: DiffState | null;
  readonly showLateralEdges: boolean;
  readonly showPhantomLeaves: boolean;
  readonly isolatedLateralNodeId: string | null;
};

type CanvasAction =
  | { type: "SELECT_NODE"; id: string; data: DagNodeData }
  | { type: "CLEAR_SELECTION" }
  | { type: "HOVER_NODE"; id: string | null }
  | { type: "SET_FILTER"; diffState: DiffState | null }
  | { type: "TOGGLE_LATERAL_EDGES" }
  | { type: "TOGGLE_PHANTOM_LEAVES" }
  | { type: "TOGGLE_LATERAL_ISOLATION"; id: string }
  | { type: "CLICK_PANE" };

const INITIAL_CANVAS_STATE: CanvasState = {
  selected: null,
  hoveredNodeId: null,
  filterDiffState: null,
  showLateralEdges: false,
  showPhantomLeaves: false,
  isolatedLateralNodeId: null,
};

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "SELECT_NODE":
      return { ...state, selected: { id: action.id, data: action.data } };
    case "CLEAR_SELECTION":
      return { ...state, selected: null };
    case "HOVER_NODE":
      return { ...state, hoveredNodeId: action.id };
    case "SET_FILTER":
      return { ...state, filterDiffState: action.diffState };
    case "TOGGLE_LATERAL_EDGES":
      return { ...state, showLateralEdges: !state.showLateralEdges };
    case "TOGGLE_PHANTOM_LEAVES":
      return { ...state, showPhantomLeaves: !state.showPhantomLeaves };
    case "TOGGLE_LATERAL_ISOLATION":
      return {
        ...state,
        isolatedLateralNodeId: state.isolatedLateralNodeId === action.id ? null : action.id,
      };
    case "CLICK_PANE":
      return { ...state, selected: null, isolatedLateralNodeId: null };
  }
}

const EMPTY_NODES: readonly never[] = [];
const EMPTY_EDGES: readonly never[] = [];
const HOVER_DEBOUNCE_MS = 50;

export function FlowCanvas({
  layoutState,
  nodeTypes,
  focusNodeId,
  onFocusComplete,
  emptyLabel,
}: FlowCanvasProps) {
  const isVisible = useTabVisibility();
  const [state, dispatch] = useReducer(canvasReducer, INITIAL_CANVAS_STATE);
  const { width: panelWidth, handlePointerDown: handleResizePointerDown } = useResizeHandle();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClosePanel = useCallback(() => dispatch({ type: "CLEAR_SELECTION" }), []);

  const handleToggleLateralIsolation = useCallback(
    (nodeId: string) => dispatch({ type: "TOGGLE_LATERAL_ISOLATION", id: nodeId }),
    [],
  );

  const handlePaneClick = useCallback(() => dispatch({ type: "CLICK_PANE" }), []);

  const handleNodeMouseEnter: NodeMouseHandler = useCallback((_, node) => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      startTransition(() => dispatch({ type: "HOVER_NODE", id: node.id }));
      hoverTimerRef.current = null;
    }, HOVER_DEBOUNCE_MS);
  }, []);

  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      startTransition(() => dispatch({ type: "HOVER_NODE", id: null }));
      hoverTimerRef.current = null;
    }, HOVER_DEBOUNCE_MS);
  }, []);

  const handleToggleLateralEdges = useCallback(
    () => dispatch({ type: "TOGGLE_LATERAL_EDGES" }),
    [],
  );

  const handleTogglePhantomLeaves = useCallback(
    () => dispatch({ type: "TOGGLE_PHANTOM_LEAVES" }),
    [],
  );

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const layout = layoutState.status === "ready" ? layoutState.layout : null;
  // Layout produces readonly arrays; React Flow requires mutable Node[]/Edge[].
  // Spread copies at the FlowCanvasLayout boundary shed the readonly modifier.
  const rawNodes = layout?.nodes ?? EMPTY_NODES;
  const rawEdges = layout?.edges ?? EMPTY_EDGES;
  const rawLateralEdges = layout?.lateralEdges ?? EMPTY_EDGES;

  const {
    visibleNodes: baseNodes,
    visibleEdges: baseEdges,
    phantomLeafCount,
    hiddenPhantomIds,
  } = usePhantomLeafState(rawNodes, rawEdges, state.showPhantomLeaves);

  const lateralEdges = useMemo(
    () =>
      hiddenPhantomIds.size === 0
        ? rawLateralEdges
        : rawLateralEdges.filter(
            (e) => !hiddenPhantomIds.has(e.source) && !hiddenPhantomIds.has(e.target),
          ),
    [rawLateralEdges, hiddenPhantomIds],
  );

  const { lateralNodeIds, activeLateralEdges, isolatedLateralIds, lateralHandlesByNode } =
    useLateralEdgeState(lateralEdges, state.showLateralEdges, state.isolatedLateralNodeId);

  const { setSearchQuery, searchMatchedIds } = useNodeSearch(baseNodes);

  const visibleEdges = useMemo(
    () => (activeLateralEdges.length > 0 ? [...baseEdges, ...activeLateralEdges] : baseEdges),
    [baseEdges, activeLateralEdges],
  );

  /** Synchronously clear selection when the selected node is hidden by the phantom toggle.
   *  Derived via useMemo (not an effect) to avoid a one-frame flash of the detail panel. */
  const effectiveSelected = useMemo(
    () =>
      state.selected !== null && hiddenPhantomIds.has(state.selected.id) ? null : state.selected,
    [state.selected, hiddenPhantomIds],
  );

  const diffStateCounts = useMemo((): Readonly<Record<FilterableDiffState, number>> => {
    const counts: Record<FilterableDiffState, number> = {
      added: 0,
      modified: 0,
      removed: 0,
      unknown: 0,
    };
    for (const node of baseNodes) {
      const ds = getNodeData(node).diffState;
      if (isFilterableDiffState(ds)) counts[ds]++;
    }
    return counts;
  }, [baseNodes]);

  const connectedIds = useMemo(
    () =>
      state.hoveredNodeId !== null
        ? buildConnectedNodeIds(baseNodes, visibleEdges, state.hoveredNodeId)
        : null,
    [baseNodes, visibleEdges, state.hoveredNodeId],
  );

  const selectedConnectedIds = useMemo(
    () =>
      effectiveSelected !== null
        ? buildConnectedNodeIds(baseNodes, visibleEdges, effectiveSelected.id)
        : null,
    [baseNodes, visibleEdges, effectiveSelected],
  );

  const filterMatchedIds = useMemo((): ReadonlySet<string> | null => {
    if (state.filterDiffState === null) return null;
    const matched = new Set<string>();
    for (const node of baseNodes) {
      const data = getNodeData(node);
      if (data.diffState === state.filterDiffState) {
        matched.add(node.id);
      }
    }
    return matched;
  }, [baseNodes, state.filterDiffState]);

  /** Direct matches — used for centering and match count (excludes parent containers). */
  const directMatchIds = useMemo((): ReadonlySet<string> | null => {
    if (filterMatchedIds === null) return searchMatchedIds;
    if (searchMatchedIds === null) return filterMatchedIds;
    const intersection = new Set<string>();
    for (const id of filterMatchedIds) {
      if (searchMatchedIds.has(id)) intersection.add(id);
    }
    return intersection;
  }, [filterMatchedIds, searchMatchedIds]);

  /** Effective filter with parent job containers included for dimming. */
  const effectiveFilterIds = useMemo((): ReadonlySet<string> | null => {
    if (directMatchIds === null) return null;
    const withParents = new Set(directMatchIds);
    for (const node of baseNodes) {
      if (node.parentId !== undefined && withParents.has(node.id)) {
        withParents.add(node.parentId);
      }
    }
    return withParents;
  }, [baseNodes, directMatchIds]);

  const {
    hasFitted,
    handleInit,
    handleFitView,
    centerOnNode: centerViewportOnNode,
  } = useViewportPositioning({
    baseNodes,
    isVisible,
    focusNodeId,
    onFocusComplete,
    isLayoutReady: layoutState.status === "ready",
    directMatchIds,
  });

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      centerViewportOnNode(node.id);
      const data = getNodeData(node);
      if (data.nodeKind === "root") {
        dispatch({ type: "CLEAR_SELECTION" });
        return;
      }
      dispatch({ type: "SELECT_NODE", id: node.id, data });
    },
    [centerViewportOnNode],
  );

  const phantomContext = useMemo(() => {
    if (effectiveSelected === null || effectiveSelected.data.nodeKind !== "phantom")
      return undefined;
    // Include lateral edges regardless of toggle — phantom context should always
    // show inference sources even when lateral edges aren't displayed on the canvas.
    const allEdges = [...baseEdges, ...lateralEdges];
    return resolvePhantomContext(effectiveSelected.id, baseNodes, allEdges);
  }, [effectiveSelected, baseNodes, baseEdges, lateralEdges]);

  const lateralContext = useMemo(() => {
    if (effectiveSelected === null) return undefined;
    // Include all lateral edges regardless of toggle — dependency info should
    // always be visible in the detail panel even when lateral edges are hidden.
    return resolveLateralContext(effectiveSelected.id, baseNodes, lateralEdges);
  }, [effectiveSelected, baseNodes, lateralEdges]);

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      const targetNode = baseNodes.find((n) => n.id === nodeId);
      if (targetNode === undefined) return;
      const data = getNodeData(targetNode);
      if (data.nodeKind === "root") return;
      dispatch({ type: "SELECT_NODE", id: nodeId, data });
      centerViewportOnNode(nodeId);
    },
    [baseNodes, centerViewportOnNode],
  );

  const handleFilterChange = useCallback(
    (diffState: DiffState | null) => dispatch({ type: "SET_FILTER", diffState }),
    [],
  );

  const interactionState = useMemo(
    () => ({
      hoveredNodeId: state.hoveredNodeId,
      selectedNodeId: effectiveSelected?.id ?? null,
      connectedIds,
      selectedConnectedIds,
      filterMatchedIds: effectiveFilterIds,
      lateralHandlesByNode,
      isolatedLateralIds,
      lateralNodeIds,
      isolatedLateralNodeId: state.isolatedLateralNodeId,
      showLateralEdges: state.showLateralEdges,
    }),
    [
      state.hoveredNodeId,
      effectiveSelected,
      connectedIds,
      selectedConnectedIds,
      effectiveFilterIds,
      lateralHandlesByNode,
      isolatedLateralIds,
      lateralNodeIds,
      state.isolatedLateralNodeId,
      state.showLateralEdges,
    ],
  );

  const styledEdges = useStyledEdges(
    visibleEdges,
    state.hoveredNodeId,
    effectiveSelected?.id ?? null,
    connectedIds,
    selectedConnectedIds,
    effectiveFilterIds,
    isolatedLateralIds,
  );

  // Layout produces readonly arrays; React Flow requires mutable Node[]/Edge[].
  const flowNodes = useMemo(() => [...baseNodes], [baseNodes]);
  const flowEdges = useMemo(() => [...styledEdges], [styledEdges]);

  if (layoutState.status === "error") {
    return (
      <div className="flex h-full items-center justify-center text-danger">
        <p>Layout failed: {layoutState.message}</p>
      </div>
    );
  }

  if (layoutState.status === "ready" && baseNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        <p>{emptyLabel ?? "No nodes in this plan"}</p>
      </div>
    );
  }

  return (
    <div className={`flex h-full${hasFitted ? "" : " opacity-0"}`}>
      <InteractionContext.Provider value={interactionState}>
        <LateralIsolationContext.Provider value={handleToggleLateralIsolation}>
          <FlowCanvasLayout
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseLeave={handleNodeMouseLeave}
            onPaneClick={handlePaneClick}
            onInit={handleInit}
            isLoading={layoutState.status === "loading"}
            onSearch={setSearchQuery}
            matchCount={directMatchIds?.size ?? 0}
            activeFilter={state.filterDiffState}
            onFilterChange={handleFilterChange}
            diffStateCounts={diffStateCounts}
            lateralEdgeCount={lateralEdges.length}
            showLateralEdges={state.showLateralEdges}
            onToggleLateralEdges={handleToggleLateralEdges}
            phantomLeafCount={phantomLeafCount}
            showPhantomLeaves={state.showPhantomLeaves}
            onTogglePhantomLeaves={handleTogglePhantomLeaves}
            onFitView={handleFitView}
          />
        </LateralIsolationContext.Provider>
      </InteractionContext.Provider>
      {effectiveSelected !== null && (
        <>
          <div
            className="flex w-2 cursor-col-resize items-center justify-center bg-transparent transition-colors hover:bg-accent/40"
            onPointerDown={handleResizePointerDown}
          >
            <svg
              width="4"
              height="16"
              viewBox="0 0 4 16"
              className="text-ink-muted/50"
              aria-hidden="true"
            >
              <circle cx="2" cy="3" r="1" fill="currentColor" />
              <circle cx="2" cy="8" r="1" fill="currentColor" />
              <circle cx="2" cy="13" r="1" fill="currentColor" />
            </svg>
          </div>
          <DetailPanel
            key={effectiveSelected.data.resourceKey}
            data={effectiveSelected.data}
            onClose={handleClosePanel}
            width={panelWidth}
            phantomContext={phantomContext}
            lateralContext={lateralContext}
            onNavigateToNode={handleNavigateToNode}
          />
        </>
      )}
    </div>
  );
}
