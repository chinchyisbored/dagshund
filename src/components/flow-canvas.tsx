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

import { DetailPanel } from "./detail-panel.tsx";
import { DiffFilterToolbar } from "./diff-filter-toolbar.tsx";
import { HoverContext } from "../hooks/use-hover-context.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";

export type FlowCanvasLayout = {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
};

type FlowCanvasProps = {
  readonly layout: FlowCanvasLayout | null;
  readonly nodeTypes: NodeTypes;
};

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  style: { stroke: "var(--edge-default)", strokeWidth: 2 },
};

const EMPTY_NODES: readonly never[] = [];
const EMPTY_EDGES: readonly never[] = [];

/** Returns the hovered node ID plus all node IDs sharing an edge with it. */
const buildConnectedNodeIds = (
  edges: readonly Edge[],
  hoveredNodeId: string,
): ReadonlySet<string> => {
  const connected = new Set<string>([hoveredNodeId]);
  for (const edge of edges) {
    if (edge.source === hoveredNodeId) connected.add(edge.target);
    if (edge.target === hoveredNodeId) connected.add(edge.source);
  }
  return connected;
};

export function FlowCanvas({ layout, nodeTypes }: FlowCanvasProps) {
  const [selectedNode, setSelectedNode] = useState<DagNodeData | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [filterDiffState, setFilterDiffState] = useState<DiffState | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const hasFittedRef = useRef(false);

  const handleNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNode(node.data as DagNodeData);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleNodeMouseEnter: NodeMouseHandler = useCallback((_, node) => {
    setHoveredNodeId(node.id);
  }, []);

  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;
  }, []);

  const baseNodes = layout?.nodes ?? EMPTY_NODES;
  const baseEdges = layout?.edges ?? EMPTY_EDGES;

  /** Fit the viewport exactly once after the layout produces nodes. */
  useEffect(() => {
    if (rfInstanceRef.current && baseNodes.length > 0 && !hasFittedRef.current) {
      rfInstanceRef.current.fitView();
      hasFittedRef.current = true;
    }
  }, [baseNodes]);

  const connectedIds = useMemo(
    () => (hoveredNodeId !== null ? buildConnectedNodeIds(baseEdges, hoveredNodeId) : null),
    [baseEdges, hoveredNodeId],
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
    () => ({ connectedIds, filterMatchedIds }),
    [connectedIds, filterMatchedIds],
  );

  const styledEdges = useMemo((): readonly Edge[] => {
    if (connectedIds === null && filterMatchedIds === null) return baseEdges as Edge[];
    return baseEdges.map((edge) => {
      const baseStyle = edge.style ?? {};
      if (connectedIds !== null) {
        const isConnected =
          edge.source === hoveredNodeId || edge.target === hoveredNodeId;
        return isConnected
          ? { ...edge, style: { ...baseStyle, strokeWidth: 2.5, filter: "brightness(1.5)" } }
          : { ...edge, style: { ...baseStyle, strokeWidth: 2, opacity: 0.15 } };
      }
      if (filterMatchedIds !== null) {
        const isRelevant =
          filterMatchedIds.has(edge.source) || filterMatchedIds.has(edge.target);
        return isRelevant
          ? { ...edge, style: baseStyle }
          : { ...edge, style: { ...baseStyle, opacity: 0.15 } };
      }
      return { ...edge, style: baseStyle };
    });
  }, [baseEdges, connectedIds, filterMatchedIds, hoveredNodeId]);

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
          onInit={handleInit}
        >
          <Panel position="top-left">
            <DiffFilterToolbar activeFilter={filterDiffState} onFilterChange={setFilterDiffState} />
          </Panel>
          <Controls />
          <MiniMap style={{ backgroundColor: "var(--minimap-bg)" }} />
        </ReactFlow>
      </HoverContext.Provider>
      {selectedNode !== null && <DetailPanel data={selectedNode} onClose={handleClosePanel} />}
    </div>
  );
}
