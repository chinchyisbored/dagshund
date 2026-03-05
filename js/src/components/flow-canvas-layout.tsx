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
import type { DiffState } from "../types/diff-state.ts";
import { DiffFilterToolbar, type FilterableDiffState } from "./diff-filter-toolbar.tsx";
import { LateralEdgeToggle } from "./lateral-edge-toggle.tsx";
import { PhantomLeafToggle } from "./phantom-leaf-toggle.tsx";
import { SearchBar } from "./search-bar.tsx";

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  style: { stroke: "var(--edge-default)", strokeWidth: 2 },
};

type FlowCanvasLayoutProps = {
  // ReactFlow core
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly nodeTypes: NodeTypes;

  // Handlers
  readonly onNodeClick: NodeMouseHandler;
  readonly onNodeMouseEnter: NodeMouseHandler;
  readonly onNodeMouseLeave: NodeMouseHandler;
  readonly onPaneClick: () => void;
  readonly onInit: (instance: ReactFlowInstance) => void;

  // Status
  readonly isLoading: boolean;

  // Search
  readonly onSearch: (query: string) => void;
  readonly matchCount: number;

  // Diff filter
  readonly activeFilter: DiffState | null;
  readonly onFilterChange: (state: DiffState | null) => void;
  readonly diffStateCounts: Readonly<Record<FilterableDiffState, number>>;

  // Lateral edges
  readonly lateralEdgeCount: number;
  readonly showLateralEdges: boolean;
  readonly onToggleLateralEdges: () => void;

  // Phantom leaves
  readonly phantomLeafCount: number;
  readonly showPhantomLeaves: boolean;
  readonly onTogglePhantomLeaves: () => void;

  // Fit view
  readonly onFitView: () => void;
};

export function FlowCanvasLayout({
  nodes,
  edges,
  nodeTypes,
  onNodeClick,
  onNodeMouseEnter,
  onNodeMouseLeave,
  onPaneClick,
  onInit,
  isLoading,
  onSearch,
  matchCount,
  activeFilter,
  onFilterChange,
  diffStateCounts,
  lateralEdgeCount,
  showLateralEdges,
  onToggleLateralEdges,
  phantomLeafCount,
  showPhantomLeaves,
  onTogglePhantomLeaves,
  onFitView,
}: FlowCanvasLayoutProps) {
  return (
    <>
      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface/80">
          <p className="animate-pulse text-ink-muted">Computing layout...</p>
        </div>
      )}
      <ReactFlow
        className="flex-1"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        nodesConnectable={false}
        nodeClickDistance={5}
        paneClickDistance={5}
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={onPaneClick}
        onInit={onInit}
      >
        <Panel position="top-left" className="z-10 flex flex-col gap-1.5">
          <SearchBar onSearch={onSearch} matchCount={matchCount} />
          <DiffFilterToolbar
            activeFilter={activeFilter}
            onFilterChange={onFilterChange}
            diffStateCounts={diffStateCounts}
          />
          {lateralEdgeCount > 0 && (
            <LateralEdgeToggle
              active={showLateralEdges}
              onToggle={onToggleLateralEdges}
              count={lateralEdgeCount}
            />
          )}
          {phantomLeafCount > 0 && (
            <PhantomLeafToggle
              active={showPhantomLeaves}
              onToggle={onTogglePhantomLeaves}
              count={phantomLeafCount}
            />
          )}
        </Panel>
        <Panel position="bottom-right" className="z-10">
          <button
            type="button"
            onClick={onFitView}
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
    </>
  );
}
