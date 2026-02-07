import {
  Background,
  Controls,
  type DefaultEdgeOptions,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DetailPanel } from "./detail-panel.tsx";
import { DiffFilterToolbar } from "./diff-filter-toolbar.tsx";
import { ResourceGroupNode } from "./resource-group-node.tsx";
import { ResourceNode } from "./resource-node.tsx";
import { HoverContext } from "../hooks/use-hover-context.ts";
import { useResourceGraph } from "../hooks/use-resource-graph.ts";
import type { DiffState } from "../types/diff-state.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import type { Plan } from "../types/plan-schema.ts";

const NODE_TYPES = { resource: ResourceNode, "resource-group": ResourceGroupNode };

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: "smoothstep",
  style: { stroke: "#71717a", strokeWidth: 2 },
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

export function ResourcesView({ plan }: { readonly plan: Plan }) {
  const layout = useResourceGraph(plan);
  const [selectedNode, setSelectedNode] = useState<DagNodeData | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [filterDiffState, setFilterDiffState] = useState<DiffState | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const hasFittedRef = useRef(false);

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    setSelectedNode(node.data as DagNodeData);
  };

  const handleClosePanel = () => {
    setSelectedNode(null);
  };

  const handleNodeMouseEnter: NodeMouseHandler = (_, node) => {
    setHoveredNodeId(node.id);
  };

  const handleNodeMouseLeave: NodeMouseHandler = () => {
    setHoveredNodeId(null);
  };

  const handleInit = (instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;
  };

  const baseNodes = layout?.nodes ?? EMPTY_NODES;
  const baseEdges = layout?.edges ?? EMPTY_EDGES;

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
    if (connectedIds === null && filterMatchedIds === null) return [...baseEdges];
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
          nodeTypes={NODE_TYPES}
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
          <Background />
          <Controls />
          <MiniMap style={{ backgroundColor: "#18181b" }} />
        </ReactFlow>
      </HoverContext.Provider>
      {selectedNode !== null && <DetailPanel data={selectedNode} onClose={handleClosePanel} />}
    </div>
  );
}
