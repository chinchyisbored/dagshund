import {
  Background,
  Controls,
  type DefaultEdgeOptions,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
} from "@xyflow/react";
import { useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./styles/output.css";

import { DetailPanel } from "./components/detail-panel.tsx";
import { JobNode } from "./components/job-node.tsx";
import { TaskNode } from "./components/task-node.tsx";
import { usePlanGraph } from "./hooks/use-plan-graph.ts";
import { useStdinPlan } from "./hooks/use-stdin-plan.ts";
import type { DagNodeData } from "./types/graph-types.ts";
import type { Plan } from "./types/plan-schema.ts";

const NODE_TYPES = { job: JobNode, task: TaskNode };

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

function DagView({ plan }: { readonly plan: Plan }) {
  const layout = usePlanGraph(plan);
  const [selectedNode, setSelectedNode] = useState<DagNodeData | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

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

  const baseNodes = layout?.nodes ?? EMPTY_NODES;
  const baseEdges = layout?.edges ?? EMPTY_EDGES;

  const connectedIds = useMemo(
    () => (hoveredNodeId !== null ? buildConnectedNodeIds(baseEdges, hoveredNodeId) : null),
    [baseEdges, hoveredNodeId],
  );

  const styledNodes = useMemo((): readonly Node[] => {
    if (connectedIds === null) return [...baseNodes];
    return baseNodes.map((node) =>
      connectedIds.has(node.id) ? node : { ...node, style: { ...node.style, opacity: 0.3 } },
    );
  }, [baseNodes, connectedIds]);

  const styledEdges = useMemo((): readonly Edge[] => {
    if (connectedIds === null) return [...baseEdges];
    return baseEdges.map((edge) => {
      const isConnected =
        edge.source === hoveredNodeId || edge.target === hoveredNodeId;
      return isConnected
        ? { ...edge, style: { stroke: "#ffffff", strokeWidth: 2.5 } }
        : { ...edge, style: { stroke: "#71717a", strokeWidth: 2, opacity: 0.15 } };
    });
  }, [baseEdges, connectedIds, hoveredNodeId]);

  return (
    <div className="flex h-full">
      <ReactFlow
        className="flex-1"
        nodes={styledNodes as Node[]}
        edges={styledEdges as Edge[]}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        nodesConnectable={false}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap style={{ backgroundColor: "#18181b" }} />
      </ReactFlow>
      {selectedNode !== null && <DetailPanel data={selectedNode} onClose={handleClosePanel} />}
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex h-full items-center justify-center text-zinc-500">Loading plan...</div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
      <p className="text-lg">No plan loaded</p>
      <p className="text-sm text-zinc-600">Pipe a plan to get started:</p>
      <code className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-400">
        databricks bundle plan -o json | dagshund
      </code>
    </div>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-red-400">
      <p className="text-lg">Failed to load plan</p>
      <code className="max-w-lg rounded bg-zinc-800 px-3 py-1.5 text-sm text-red-300">
        {message}
      </code>
    </div>
  );
}

export function App() {
  const planState = useStdinPlan();

  return (
    <div className="h-screen w-screen bg-zinc-950">
      {planState.status === "loading" && <LoadingIndicator />}
      {planState.status === "empty" && <EmptyState />}
      {planState.status === "error" && <ErrorMessage message={planState.message} />}
      {planState.status === "ready" && <DagView plan={planState.plan} />}
    </div>
  );
}
