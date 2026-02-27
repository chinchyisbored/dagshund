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
import { InteractionContext } from "../hooks/use-interaction-context.ts";
import { useLateralEdgeState } from "../hooks/use-lateral-edge-state.ts";
import { LateralIsolationContext } from "../hooks/use-lateral-isolation.ts";
import type { GraphLayoutState } from "../hooks/use-plan-graph.ts";
import { useResizeHandle } from "../hooks/use-resize-handle.ts";
import { useStyledEdges } from "../hooks/use-styled-edges.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import type { PhantomContext } from "../types/phantom-context.ts";
import { extractTypeBadge } from "../utils/resource-key.ts";
import { DetailPanel } from "./detail-panel/index.ts";
import { DiffFilterToolbar, type FilterableDiffState } from "./diff-filter-toolbar.tsx";
import { LateralEdgeToggle } from "./lateral-edge-toggle.tsx";

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

/** Derive inference context for a phantom node from its outgoing edges.
 *  Every outgoing edge points to a child/referenced node that caused the phantom to exist. */
const resolvePhantomContext = (
  nodeId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PhantomContext | undefined => {
  const childIds = new Set(edges.filter((e) => e.source === nodeId).map((e) => e.target));
  if (childIds.size === 0) return undefined;

  const sources = nodes
    .filter((n) => childIds.has(n.id))
    .map((n) => {
      const data = getNodeData(n);
      return {
        label: data.label,
        resourceKey: data.resourceKey,
        resourceType: extractTypeBadge(data.resourceKey),
      };
    });

  return { sources };
};

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
  const [showLateralEdges, setShowLateralEdges] = useState(false);
  const [isolatedLateralNodeId, setIsolatedLateralNodeId] = useState<string | null>(null);
  const { width: panelWidth, handlePointerDown: handleResizePointerDown } = useResizeHandle();
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Never reset — safe because FlowCanvas remounts when the plan/tab changes.
  const hasFittedRef = useRef(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    const instance = rfInstanceRef.current;
    if (instance !== null) {
      const internal = instance.getInternalNode(node.id);
      if (internal !== undefined) {
        const currentZoom = instance.getZoom();
        const { x, y } = internal.internals.positionAbsolute;
        const width = internal.measured.width ?? 200;
        const height = internal.measured.height ?? 56;
        instance.setCenter(x + width / 2, y + height / 2, { duration: 300, zoom: currentZoom });
      }
    }

    const data = getNodeData(node);
    if (data.nodeKind === "root") {
      setSelectedNode(null);
      setSelectedNodeId(null);
      return;
    }
    setSelectedNode(data);
    setSelectedNodeId(node.id);
  }, []);

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

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const layout = layoutState.status === "ready" ? layoutState.layout : null;
  // Layout produces readonly arrays; React Flow's component props and internal helpers
  // require mutable Node[]/Edge[]. The `as` casts below shed the readonly modifier.
  const baseNodes = layout?.nodes ?? EMPTY_NODES;
  const baseEdges = layout?.edges ?? EMPTY_EDGES;
  const lateralEdges = layout?.lateralEdges ?? EMPTY_EDGES;

  const { lateralNodeIds, activeLateralEdges, isolatedLateralIds, lateralHandlesByNode } =
    useLateralEdgeState(lateralEdges, showLateralEdges, isolatedLateralNodeId);

  const visibleEdges = useMemo(
    () => (activeLateralEdges.length > 0 ? [...baseEdges, ...activeLateralEdges] : baseEdges),
    [baseEdges, activeLateralEdges],
  );

  /** Fit the viewport exactly once after the layout produces nodes.
   *  Skipped when focusNodeId is set — the focus effect handles viewport positioning instead.
   *  requestAnimationFrame defers until React Flow has measured node dimensions. */
  useEffect(() => {
    if (rfInstanceRef.current && baseNodes.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true;
      if (focusNodeId != null) return;
      requestAnimationFrame(() => {
        rfInstanceRef.current?.fitView({ maxZoom: 1, padding: 0.15 });
      });
    }
  }, [baseNodes, focusNodeId]);

  /** Pan to a specific node when focusNodeId is set (cross-tab navigation).
   *  Waits for layout to be ready so the node exists in React Flow's internal store.
   *  Uses setTimeout rather than rAF because the tab container transitions from
   *  display:none to visible on navigation — React Flow's ResizeObserver needs
   *  time to recalculate before setCenter can position correctly. */
  useEffect(() => {
    if (focusNodeId === null || focusNodeId === undefined) return;
    if (layoutState.status !== "ready") return;
    const timerId = setTimeout(() => {
      const instance = rfInstanceRef.current;
      if (instance === null) return;
      const internal = instance.getInternalNode(focusNodeId);
      if (internal === undefined) return;
      const zoom = instance.getZoom();
      const { x, y } = internal.internals.positionAbsolute;
      const width = internal.measured.width ?? 200;
      const height = internal.measured.height ?? 56;
      instance.setCenter(x + width / 2, y + height / 2, { duration: 300, zoom });
      onFocusComplete?.();
    }, 50);
    return () => clearTimeout(timerId);
  }, [focusNodeId, onFocusComplete, layoutState.status]);

  const diffStateCounts = useMemo((): Readonly<Record<FilterableDiffState, number>> => {
    const counts: Record<FilterableDiffState, number> = { added: 0, modified: 0, removed: 0 };
    for (const node of baseNodes) {
      const state = getNodeData(node).diffState;
      // Safe: the `in` guard ensures state is a FilterableDiffState key.
      if (state in counts) counts[state as FilterableDiffState]++;
    }
    return counts;
  }, [baseNodes]);

  const connectedIds = useMemo(
    () =>
      hoveredNodeId !== null
        ? buildConnectedNodeIds(baseNodes as Node[], visibleEdges as Edge[], hoveredNodeId)
        : null,
    [baseNodes, visibleEdges, hoveredNodeId],
  );

  const selectedConnectedIds = useMemo(
    () =>
      selectedNodeId !== null
        ? buildConnectedNodeIds(baseNodes as Node[], visibleEdges as Edge[], selectedNodeId)
        : null,
    [baseNodes, visibleEdges, selectedNodeId],
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

  const phantomContext = useMemo(() => {
    if (selectedNode === null || selectedNode.nodeKind !== "phantom" || selectedNodeId === null)
      return undefined;
    return resolvePhantomContext(selectedNodeId, baseNodes as Node[], visibleEdges as Edge[]);
  }, [selectedNode, selectedNodeId, baseNodes, visibleEdges]);

  const interactionState = useMemo(
    () => ({
      hoveredNodeId,
      selectedNodeId,
      connectedIds,
      selectedConnectedIds,
      filterMatchedIds,
      lateralHandlesByNode,
      isolatedLateralIds,
      lateralNodeIds,
      isolatedLateralNodeId,
    }),
    [
      hoveredNodeId,
      selectedNodeId,
      connectedIds,
      selectedConnectedIds,
      filterMatchedIds,
      lateralHandlesByNode,
      isolatedLateralIds,
      lateralNodeIds,
      isolatedLateralNodeId,
    ],
  );

  const styledEdges = useStyledEdges(
    visibleEdges,
    hoveredNodeId,
    selectedNodeId,
    connectedIds,
    selectedConnectedIds,
    filterMatchedIds,
    isolatedLateralIds,
  );

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
      <InteractionContext.Provider value={interactionState}>
        <LateralIsolationContext.Provider value={handleToggleLateralIsolation}>
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
            onPaneClick={handlePaneClick}
            onInit={handleInit}
          >
            <Panel position="top-left" className="z-10 flex flex-col gap-1.5">
              <DiffFilterToolbar
                activeFilter={filterDiffState}
                onFilterChange={setFilterDiffState}
                diffStateCounts={diffStateCounts}
              />
              {lateralEdges.length > 0 && (
                <LateralEdgeToggle
                  active={showLateralEdges}
                  onToggle={() => setShowLateralEdges((prev) => !prev)}
                  count={lateralEdges.length}
                />
              )}
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
        </LateralIsolationContext.Provider>
      </InteractionContext.Provider>
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
            phantomContext={phantomContext}
          />
        </>
      )}
    </div>
  );
}
