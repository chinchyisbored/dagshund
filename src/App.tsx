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
import "@xyflow/react/dist/style.css";
import "./styles/output.css";

import { DetailPanel } from "./components/detail-panel.tsx";
import { DiffFilterToolbar } from "./components/diff-filter-toolbar.tsx";
import { JobNode } from "./components/job-node.tsx";
import { ResourcesView } from "./components/resources-view.tsx";
import { TabBar } from "./components/tab-bar.tsx";
import { TaskNode } from "./components/task-node.tsx";
import { hasNonJobResources } from "./graph/build-resource-graph.ts";
import { HoverContext } from "./hooks/use-hover-context.ts";
import { usePlanGraph } from "./hooks/use-plan-graph.ts";
import { useStdinPlan } from "./hooks/use-stdin-plan.ts";
import type { DiffState } from "./types/diff-state.ts";
import type { DagNodeData } from "./types/graph-types.ts";
import type { Plan } from "./types/plan-schema.ts";

const NODE_TYPES = { job: JobNode, task: TaskNode };

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
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

  /** Fit the viewport exactly once after the ELK layout produces nodes. */
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
      // Hover styling takes precedence when active
      if (connectedIds !== null) {
        const isConnected =
          edge.source === hoveredNodeId || edge.target === hoveredNodeId;
        return isConnected
          ? { ...edge, style: { ...baseStyle, strokeWidth: 2.5, filter: "brightness(1.5)" } }
          : { ...edge, style: { ...baseStyle, strokeWidth: 2, opacity: 0.15 } };
      }
      // Filter dimming: dim edges where neither endpoint is in the matched set
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

function PlanView({ plan }: { readonly plan: Plan }) {
  const showTabs = hasNonJobResources(plan);
  const [activeTab, setActiveTab] = useState<"jobs" | "resources">("jobs");

  if (!showTabs) {
    return <DagView plan={plan} />;
  }

  return (
    <div className="flex h-full flex-col">
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="min-h-0 flex-1">
        {activeTab === "jobs" && <DagView plan={plan} />}
        {activeTab === "resources" && <ResourcesView plan={plan} />}
      </div>
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
      {planState.status === "ready" && <PlanView plan={planState.plan} />}
    </div>
  );
}
