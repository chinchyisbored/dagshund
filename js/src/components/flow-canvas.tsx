import type { NodeMouseHandler, NodeTypes } from "@xyflow/react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionContext } from "../hooks/use-interaction-context.ts";
import { useLateralEdgeState } from "../hooks/use-lateral-edge-state.ts";
import { LateralIsolationContext } from "../hooks/use-lateral-isolation.ts";
import { useNodeSearch } from "../hooks/use-node-search.ts";
import { usePhantomLeafState } from "../hooks/use-phantom-leaf-state.ts";
import type { GraphLayoutState } from "../hooks/use-plan-graph.ts";
import { useResizeHandle } from "../hooks/use-resize-handle.ts";
import { useStyledEdges } from "../hooks/use-styled-edges.ts";
import { useTabVisibility } from "../hooks/use-tab-visibility.ts";
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
  const [selectedNode, setSelectedNode] = useState<DagNodeData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [filterDiffState, setFilterDiffState] = useState<DiffState | null>(null);
  const [showLateralEdges, setShowLateralEdges] = useState(false);
  const [showPhantomLeaves, setShowPhantomLeaves] = useState(false);
  const [isolatedLateralNodeId, setIsolatedLateralNodeId] = useState<string | null>(null);
  const { width: panelWidth, handlePointerDown: handleResizePointerDown } = useResizeHandle();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
    setSelectedNodeId(null);
  }, []);

  const handleToggleLateralIsolation = useCallback((nodeId: string) => {
    setIsolatedLateralNodeId((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedNodeId(null);
    setIsolatedLateralNodeId(null);
  }, []);

  const handleNodeMouseEnter: NodeMouseHandler = useCallback((_, node) => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      startTransition(() => setHoveredNodeId(node.id));
      hoverTimerRef.current = null;
    }, HOVER_DEBOUNCE_MS);
  }, []);

  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      startTransition(() => setHoveredNodeId(null));
      hoverTimerRef.current = null;
    }, HOVER_DEBOUNCE_MS);
  }, []);

  const handleToggleLateralEdges = useCallback(() => {
    setShowLateralEdges((prev) => !prev);
  }, []);

  const handleTogglePhantomLeaves = useCallback(() => {
    setShowPhantomLeaves((prev) => !prev);
  }, []);

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
  } = usePhantomLeafState(rawNodes, rawEdges, showPhantomLeaves);

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
    useLateralEdgeState(lateralEdges, showLateralEdges, isolatedLateralNodeId);

  const { setSearchQuery, searchMatchedIds } = useNodeSearch(baseNodes);

  const visibleEdges = useMemo(
    () => (activeLateralEdges.length > 0 ? [...baseEdges, ...activeLateralEdges] : baseEdges),
    [baseEdges, activeLateralEdges],
  );

  /** Synchronously clear selection when the selected node is hidden by the phantom toggle.
   *  Derived via useMemo (not an effect) to avoid a one-frame flash of the detail panel. */
  const effectiveSelectedNode = useMemo(
    () => (selectedNodeId !== null && hiddenPhantomIds.has(selectedNodeId) ? null : selectedNode),
    [selectedNode, selectedNodeId, hiddenPhantomIds],
  );
  const effectiveSelectedNodeId = useMemo(
    () => (selectedNodeId !== null && hiddenPhantomIds.has(selectedNodeId) ? null : selectedNodeId),
    [selectedNodeId, hiddenPhantomIds],
  );

  const diffStateCounts = useMemo((): Readonly<Record<FilterableDiffState, number>> => {
    const counts: Record<FilterableDiffState, number> = {
      added: 0,
      modified: 0,
      removed: 0,
      unknown: 0,
    };
    for (const node of baseNodes) {
      const state = getNodeData(node).diffState;
      if (isFilterableDiffState(state)) counts[state]++;
    }
    return counts;
  }, [baseNodes]);

  const connectedIds = useMemo(
    () =>
      hoveredNodeId !== null ? buildConnectedNodeIds(baseNodes, visibleEdges, hoveredNodeId) : null,
    [baseNodes, visibleEdges, hoveredNodeId],
  );

  const selectedConnectedIds = useMemo(
    () =>
      effectiveSelectedNodeId !== null
        ? buildConnectedNodeIds(baseNodes, visibleEdges, effectiveSelectedNodeId)
        : null,
    [baseNodes, visibleEdges, effectiveSelectedNodeId],
  );

  const filterMatchedIds = useMemo((): ReadonlySet<string> | null => {
    if (filterDiffState === null) return null;
    const matched = new Set<string>();
    for (const node of baseNodes) {
      const data = getNodeData(node);
      if (data.diffState === filterDiffState) {
        matched.add(node.id);
      }
    }
    return matched;
  }, [baseNodes, filterDiffState]);

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
        setSelectedNode(null);
        setSelectedNodeId(null);
        return;
      }
      setSelectedNode(data);
      setSelectedNodeId(node.id);
    },
    [centerViewportOnNode],
  );

  const phantomContext = useMemo(() => {
    if (
      effectiveSelectedNode === null ||
      effectiveSelectedNode.nodeKind !== "phantom" ||
      effectiveSelectedNodeId === null
    )
      return undefined;
    // Include lateral edges regardless of toggle — phantom context should always
    // show inference sources even when lateral edges aren't displayed on the canvas.
    const allEdges = [...baseEdges, ...lateralEdges];
    return resolvePhantomContext(effectiveSelectedNodeId, baseNodes, allEdges);
  }, [effectiveSelectedNode, effectiveSelectedNodeId, baseNodes, baseEdges, lateralEdges]);

  const lateralContext = useMemo(() => {
    if (effectiveSelectedNodeId === null) return undefined;
    // Include all lateral edges regardless of toggle — dependency info should
    // always be visible in the detail panel even when lateral edges are hidden.
    return resolveLateralContext(effectiveSelectedNodeId, baseNodes, lateralEdges);
  }, [effectiveSelectedNodeId, baseNodes, lateralEdges]);

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      const targetNode = baseNodes.find((n) => n.id === nodeId);
      if (targetNode === undefined) return;
      const data = getNodeData(targetNode);
      if (data.nodeKind === "root") return;
      setSelectedNode(data);
      setSelectedNodeId(nodeId);
      centerViewportOnNode(nodeId);
    },
    [baseNodes, centerViewportOnNode],
  );

  const interactionState = useMemo(
    () => ({
      hoveredNodeId,
      selectedNodeId: effectiveSelectedNodeId,
      connectedIds,
      selectedConnectedIds,
      filterMatchedIds: effectiveFilterIds,
      lateralHandlesByNode,
      isolatedLateralIds,
      lateralNodeIds,
      isolatedLateralNodeId,
      showLateralEdges,
    }),
    [
      hoveredNodeId,
      effectiveSelectedNodeId,
      connectedIds,
      selectedConnectedIds,
      effectiveFilterIds,
      lateralHandlesByNode,
      isolatedLateralIds,
      lateralNodeIds,
      isolatedLateralNodeId,
      showLateralEdges,
    ],
  );

  const styledEdges = useStyledEdges(
    visibleEdges,
    hoveredNodeId,
    effectiveSelectedNodeId,
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
            activeFilter={filterDiffState}
            onFilterChange={setFilterDiffState}
            diffStateCounts={diffStateCounts}
            lateralEdgeCount={lateralEdges.length}
            showLateralEdges={showLateralEdges}
            onToggleLateralEdges={handleToggleLateralEdges}
            phantomLeafCount={phantomLeafCount}
            showPhantomLeaves={showPhantomLeaves}
            onTogglePhantomLeaves={handleTogglePhantomLeaves}
            onFitView={handleFitView}
          />
        </LateralIsolationContext.Provider>
      </InteractionContext.Provider>
      {effectiveSelectedNode !== null && (
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
            key={effectiveSelectedNode.resourceKey}
            data={effectiveSelectedNode}
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
