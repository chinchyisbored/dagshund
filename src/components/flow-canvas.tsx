import {
  Controls,
  type DefaultEdgeOptions,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DetailPanel } from "./detail-panel/index.ts";
import { DiffFilterToolbar, type FilterableDiffState } from "./diff-filter-toolbar.tsx";
import { HoverContext } from "../hooks/use-hover-context.ts";
import type { GraphLayoutState } from "../hooks/use-plan-graph.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";

type FlowCanvasProps = {
  readonly layoutState: GraphLayoutState;
  readonly nodeTypes: NodeTypes;
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

export function FlowCanvas({ layoutState, nodeTypes }: FlowCanvasProps) {
  const [selectedNode, setSelectedNode] = useState<DagNodeData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [filterDiffState, setFilterDiffState] = useState<DiffState | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const hasFittedRef = useRef(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node.data as DagNodeData);
    setSelectedNodeId(node.id);
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

  const layout = layoutState.status === "ready" ? layoutState.layout : null;
  const baseNodes = layout?.nodes ?? EMPTY_NODES;
  const baseEdges = layout?.edges ?? EMPTY_EDGES;

  /** Fit the viewport exactly once after the layout produces nodes. */
  useEffect(() => {
    if (rfInstanceRef.current && baseNodes.length > 0 && !hasFittedRef.current) {
      rfInstanceRef.current.fitView();
      hasFittedRef.current = true;
    }
  }, [baseNodes]);

  const diffStateCounts = useMemo((): Readonly<Record<FilterableDiffState, number>> => {
    const counts: Record<FilterableDiffState, number> = { added: 0, modified: 0, removed: 0 };
    for (const node of baseNodes) {
      const state = (node.data as DagNodeData).diffState;
      if (state in counts) counts[state as FilterableDiffState]++;
    }
    return counts;
  }, [baseNodes]);

  const connectedIds = useMemo(
    () => (hoveredNodeId !== null ? buildConnectedNodeIds(baseNodes as Node[], baseEdges, hoveredNodeId) : null),
    [baseNodes, baseEdges, hoveredNodeId],
  );

  const selectedConnectedIds = useMemo(
    () => (selectedNodeId !== null ? buildConnectedNodeIds(baseNodes as Node[], baseEdges, selectedNodeId) : null),
    [baseNodes, baseEdges, selectedNodeId],
  );

  const filterMatchedIds = useMemo((): ReadonlySet<string> | null => {
    if (filterDiffState === null) return null;
    const matched = new Set<string>();
    for (const node of baseNodes) {
      const data = node.data as DagNodeData;
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
    if (connectedIds === null && selectedConnectedIds === null && filterMatchedIds === null) return baseEdges as Edge[];
    return baseEdges.map((edge) => {
      const baseStyle = edge.style ?? {};
      if (connectedIds !== null) {
        const isDirectlyConnected =
          edge.source === hoveredNodeId || edge.target === hoveredNodeId;
        const isBetweenConnected =
          connectedIds.has(edge.source) && connectedIds.has(edge.target);
        return isDirectlyConnected
          ? { ...edge, style: { ...baseStyle, strokeWidth: 2.5, filter: "brightness(1.5)" } }
          : isBetweenConnected
            ? { ...edge, style: baseStyle }
            : { ...edge, style: { ...baseStyle, strokeWidth: 2, opacity: 0.15 } };
      }
      if (filterMatchedIds !== null) {
        const isRelevant =
          filterMatchedIds.has(edge.source) || filterMatchedIds.has(edge.target);
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
  }, [baseEdges, connectedIds, selectedConnectedIds, filterMatchedIds, hoveredNodeId, selectedNodeId]);

  if (layoutState.status === "error") {
    return (
      <div className="flex h-full items-center justify-center text-danger">
        <p>Layout failed: {layoutState.message}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <HoverContext.Provider value={hoverState}>
        <ReactFlow
          className="flex-1"
          nodes={baseNodes as Node[]}
          edges={styledEdges as Edge[]}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          nodesConnectable={false}
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onPaneClick={handleClosePanel}
          onInit={handleInit}
        >
          <Panel position="top-left">
            <DiffFilterToolbar activeFilter={filterDiffState} onFilterChange={setFilterDiffState} diffStateCounts={diffStateCounts} />
          </Panel>
          <Controls />
          <MiniMap style={{ backgroundColor: "var(--minimap-bg)" }} />
        </ReactFlow>
      </HoverContext.Provider>
      {selectedNode !== null && <DetailPanel key={selectedNode.resourceKey} data={selectedNode} onClose={handleClosePanel} />}
    </div>
  );
}
