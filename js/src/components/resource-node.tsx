import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { NODE_WIDTH } from "../graph/layout-graph.ts";
import { useJobNavigation } from "../hooks/use-job-navigation.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { extractResourceType, extractTypeBadge } from "../utils/resource-key.ts";
import { getDiffBadge } from "./diff-state-styles.ts";

type ResourceNodeType = Node<DagNodeData, "resource">;

export const ResourceNode = memo(function ResourceNode({ id, data }: NodeProps<ResourceNodeType>) {
  const { opacityClass, glowStyle, styles, hasIncoming, hasOutgoing } = useNodeDimming(
    id,
    data.diffState,
  );
  const typeBadge = extractTypeBadge(data.resourceKey);
  const diffBadge = getDiffBadge(data.diffState);
  const navigateToJob = useJobNavigation();
  const isJob = extractResourceType(data.resourceKey) === "jobs";

  return (
    <div
      style={{ width: NODE_WIDTH, ...glowStyle }}
      className={`flex cursor-pointer items-center gap-2 truncate rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.borderStyle} ${styles.background} ${styles.text} ${opacityClass}`}
      title={data.label}
    >
      {hasIncoming && <Handle type="target" position={Position.Left} className="!bg-handle" />}
      <span className="truncate">
        {diffBadge !== undefined && (
          <span className="mr-1 font-semibold" aria-hidden="true">
            {diffBadge}
          </span>
        )}
        {data.label}
      </span>
      {isJob && navigateToJob !== null ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigateToJob(data.resourceKey);
          }}
          className="shrink-0 cursor-pointer rounded bg-badge-bg px-1.5 py-0.5 text-[10px] text-badge-text transition-all hover:bg-accent/20 hover:text-accent hover:ring-1 hover:ring-accent/40"
          title="View in Jobs tab"
          aria-label="View in Jobs tab"
        >
          job →
        </button>
      ) : typeBadge !== undefined ? (
        <span className="shrink-0 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] text-badge-text">
          {typeBadge}
        </span>
      ) : null}
      {hasOutgoing && <Handle type="source" position={Position.Right} className="!bg-handle" />}
    </div>
  );
});
