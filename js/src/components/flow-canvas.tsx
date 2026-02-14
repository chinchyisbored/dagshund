import {
  type DefaultEdgeOptions,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoverContext } from "../hooks/use-hover-context.ts";
import type { GraphLayoutState } from "../hooks/use-plan-graph.ts";
import { useResizeHandle } from "../hooks/use-resize-handle.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { DetailPanel } from "./detail-panel/index.ts";
import { DiffFilterToolbar, type FilterableDiffState } from "./diff-filter-toolbar.tsx";

type FlowCanvasProps = {
  readonly layoutState: GraphLayoutState;
  readonly nodeTypes: NodeTypes;
  readonly focusNodeId?: string | null;
  readonly onFocusComplete?: () => void;
  readonly emptyLabel?: string;
};

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  style: { stroke: "var(--edge-default)", strokeWidth: 2 },
};

const EMPTY_NODES: readonly never[] = [];
const EMPTY_EDGES: readonly never[] = [];
const HOVER_DEBOUNCE_MS = 50;

/** Returns the given node ID plus all node IDs sharing an edge with it.
 *  When a job (parent) node is targeted, its child tasks are included too. */
const buildConnectedNodeIds = (
  nodes: readonly Node[],
  edges: readonly Edge[],
  targetNodeId: string,
): ReadonlySet<string> => {
  const connected = new Set<string>([targetNodeId]);
  for (const edge of edges) {
    if (edge.source === targetNodeId) connected.add(edge.target);
    if (edge.target === targetNodeId) connected.add(edge.source);
  }
  for (const node of nodes) {
    if (node.parentId === targetNodeId) connected.add(node.id);
  }
  return connected;
};

/** React Flow types node.data as Record<string, unknown>; our nodes carry DagNodeData.
 *  The cast is unavoidable because React Flow's generic param doesn't propagate to event handlers. */
const getNodeData = (node: Node): DagNodeData => node.data as DagNodeData;

export function FlowCanvas({
  layoutState,
  nodeTypes,
  focusNodeId,
  onFocusComplete,
  emptyLabel,
}: FlowCanvasProps) {
  const [selectedNode, setSelectedNode] = useState<DagNodeData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [filterDiffState, setFilterDiffState] = useState<DiffState | null>(null);
  const { width: panelWidth, handlePointerDown: handleResizePointerDown } = useResizeHandle();
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const hasFittedRef = useRef(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(getNodeData(node));
    setSelectedNodeId(node.id);

    const instance = rfInstanceRef.current;
    if (instance === null) return;

    const internal = instance.getInternalNode(node.id);
    if (internal === undefined) return;

    const currentZoom = instance.getZoom();
    const { x, y } = internal.internals.positionAbsolute;
    const width = internal.measured.width ?? 200;
    const height = internal.measured.height ?? 50;
    instance.setCenter(x + width / 2, y + height / 2, { duration: 300, zoom: currentZoom });
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
    setSelectedNodeId(null);
  }, []);

  const handleNodeMouseEnter: NodeMouseHandler = useCallback((_, node) => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredNodeId(node.id);
      hoverTimerRef.current = null;
    }, HOVER_DEBOUNCE_MS);
  }, []);

  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredNodeId(null);
      hoverTimerRef.current = null;
    }, HOVER_DEBOUNCE_MS);
  }, []);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;
  }, []);

  const handleFitView = useCallback(() => {
    rfInstanceRef.current?.fitView();
  }, []);

  const layout = layoutState.status === "ready" ? layoutState.layout : null;
  const baseNodes = layout?.nodes ?? EMPTY_NODES;
  const baseEdges = layout?.edges ?? EMPTY_EDGES;

  /** Fit the viewport exactly once after the layout produces nodes.
   *  requestAnimationFrame defers until React Flow has measured node dimensions. */
  useEffect(() => {
    if (rfInstanceRef.current && baseNodes.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true;
      requestAnimationFrame(() => {
        rfInstanceRef.current?.fitView({ maxZoom: 1, padding: 0.15 });
      });
    }
  }, [baseNodes]);

  /** Pan to a specific node when focusNodeId is set (cross-tab navigation). */
  useEffect(() => {
    if (focusNodeId === null || focusNodeId === undefined) return;
    const instance = rfInstanceRef.current;
    if (instance === null) return;
    const internal = instance.getInternalNode(focusNodeId);
    if (internal === undefined) return;
    const zoom = instance.getZoom();
    const { x, y } = internal.internals.positionAbsolute;
    const width = internal.measured.width ?? 200;
    const height = internal.measured.height ?? 50;
    instance.setCenter(x + width / 2, y + height / 2, { duration: 300, zoom });
    onFocusComplete?.();
  }, [focusNodeId, onFocusComplete]);

  const diffStateCounts = useMemo((): Readonly<Record<FilterableDiffState, number>> => {
    const counts: Record<FilterableDiffState, number> = { added: 0, modified: 0, removed: 0 };
    for (const node of baseNodes) {
      const state = getNodeData(node).diffState;
      if (state in counts) counts[state as FilterableDiffState]++;
    }
    return counts;
  }, [baseNodes]);

  const connectedIds = useMemo(
    () =>
      hoveredNodeId !== null
        ? buildConnectedNodeIds(baseNodes as Node[], baseEdges, hoveredNodeId)
        : null,
    [baseNodes, baseEdges, hoveredNodeId],
  );

  const selectedConnectedIds = useMemo(
    () =>
      selectedNodeId !== null
        ? buildConnectedNodeIds(baseNodes as Node[], baseEdges, selectedNodeId)
        : null,
    [baseNodes, baseEdges, selectedNodeId],
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

  const hoverState = useMemo(
    () => ({ hoveredNodeId, selectedNodeId, connectedIds, selectedConnectedIds, filterMatchedIds }),
    [hoveredNodeId, selectedNodeId, connectedIds, selectedConnectedIds, filterMatchedIds],
  );

  const styledEdges = useMemo((): readonly Edge[] => {
    if (connectedIds === null && selectedConnectedIds === null && filterMatchedIds === null)
      return baseEdges as Edge[];
    return baseEdges.map((edge) => {
      const baseStyle = edge.style ?? {};
      if (connectedIds !== null) {
        const isDirectlyConnected = edge.source === hoveredNodeId || edge.target === hoveredNodeId;
        const isBetweenConnected = connectedIds.has(edge.source) && connectedIds.has(edge.target);
        return isDirectlyConnected
          ? { ...edge, style: { ...baseStyle, strokeWidth: 2.5, filter: "brightness(1.5)" } }
          : isBetweenConnected
            ? { ...edge, style: baseStyle }
            : { ...edge, style: { ...baseStyle, strokeWidth: 2, opacity: 0.15 } };
      }
      if (filterMatchedIds !== null) {
        const isRelevant = filterMatchedIds.has(edge.source) || filterMatchedIds.has(edge.target);
        return isRelevant
          ? { ...edge, style: baseStyle }
          : { ...edge, style: { ...baseStyle, opacity: 0.15 } };
      }
      if (selectedConnectedIds !== null) {
        const isDirectlyConnected =
          edge.source === selectedNodeId || edge.target === selectedNodeId;
        const isBetweenConnected =
          selectedConnectedIds.has(edge.source) && selectedConnectedIds.has(edge.target);
        return isDirectlyConnected
          ? { ...edge, style: { ...baseStyle, strokeWidth: 2.5 } }
          : isBetweenConnected
            ? { ...edge, style: baseStyle }
            : { ...edge, style: { ...baseStyle, opacity: 0.3 } };
      }
      return { ...edge, style: baseStyle };
    });
  }, [
    baseEdges,
    connectedIds,
    selectedConnectedIds,
    filterMatchedIds,
    hoveredNodeId,
    selectedNodeId,
  ]);

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
    <div className="flex h-full">
      <HoverContext.Provider value={hoverState}>
        {layoutState.status === "loading" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface/80">
            <p className="animate-pulse text-ink-muted">Computing layout...</p>
          </div>
        )}
        <ReactFlow
          className="flex-1"
          nodes={baseNodes as Node[]}
          edges={styledEdges as Edge[]}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onPaneClick={handleClosePanel}
          onInit={handleInit}
        >
          <Panel position="top-left" className="z-10">
            <DiffFilterToolbar
              activeFilter={filterDiffState}
              onFilterChange={setFilterDiffState}
              diffStateCounts={diffStateCounts}
            />
          </Panel>
          <Panel position="bottom-right" className="z-10">
            <button
              type="button"
              onClick={handleFitView}
              className="rounded-md border border-outline bg-surface-raised p-1.5 text-ink-muted shadow-sm transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Fit view"
              title="Reset view"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          </Panel>
        </ReactFlow>
      </HoverContext.Provider>
      {selectedNode !== null && (
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
            key={selectedNode.resourceKey}
            data={selectedNode}
            onClose={handleClosePanel}
            width={panelWidth}
          />
        </>
      )}
    </div>
  );
}
