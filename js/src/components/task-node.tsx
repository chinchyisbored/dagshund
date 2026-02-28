import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { NODE_WIDTH } from "../graph/layout-graph.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffBadge } from "../utils/diff-state-styles.ts";
import { extractTaskTypeBadge } from "../utils/task-type.ts";

type TaskNodeType = Node<DagNodeData, "task">;

export const TaskNode = memo(function TaskNode({ id, data }: NodeProps<TaskNodeType>) {
  const { opacityClass, glowStyle, styles, hasIncoming, hasOutgoing } = useNodeDimming(
    id,
    data.diffState,
  );
  const diffBadge = getDiffBadge(data.diffState);
  const typeBadge = extractTaskTypeBadge(data.resourceState);

  return (
    <div
      style={{ width: NODE_WIDTH, ...glowStyle }}
      className={`flex cursor-pointer flex-col rounded-lg border-2 px-4 py-1.5 ${styles.border} ${styles.borderStyle} ${styles.background} ${styles.text} ${opacityClass}`}
      title={data.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-handle"
        style={hasIncoming ? undefined : { visibility: "hidden" }}
      />
      <span className="truncate text-sm">
        <span className="mr-1 font-semibold" aria-hidden="true">
          {diffBadge}
        </span>
        {data.label}
      </span>
      <div className="flex items-center gap-1.5">
        {typeBadge !== undefined ? (
          <span className="shrink-0 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] text-badge-text">
            {typeBadge}
          </span>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-handle"
        style={hasOutgoing ? undefined : { visibility: "hidden" }}
      />
    </div>
  );
});
