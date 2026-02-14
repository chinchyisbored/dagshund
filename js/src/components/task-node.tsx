import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { NODE_WIDTH } from "../graph/index.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffBadge } from "./diff-state-styles.ts";

type TaskNodeType = Node<DagNodeData, "task">;

export const TaskNode = memo(function TaskNode({ id, data }: NodeProps<TaskNodeType>) {
  const {
    isDimmed,
    dimOpacity,
    isHovered,
    isSelected,
    opacityClass,
    styles,
    hasIncoming,
    hasOutgoing,
  } = useNodeDimming(id, data.diffState);
  const badge = getDiffBadge(data.diffState);

  return (
    <div
      style={{
        width: NODE_WIDTH,
        ...(isSelected
          ? { boxShadow: `0 0 0 2.5px ${styles.hoverGlow}` }
          : isHovered
            ? { boxShadow: `0 0 0 1.5px ${styles.hoverGlow}` }
            : undefined),
        ...(isDimmed ? { opacity: dimOpacity } : undefined),
      }}
      className={`cursor-pointer truncate rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.borderStyle} ${styles.background} ${styles.text} ${opacityClass}`}
      title={data.label}
    >
      {hasIncoming && <Handle type="target" position={Position.Left} className="!bg-handle" />}
      <span>
        {badge !== undefined && (
          <span className="mr-1 font-semibold" aria-hidden="true">
            {badge}
          </span>
        )}
        {data.label}
      </span>
      {hasOutgoing && <Handle type="source" position={Position.Right} className="!bg-handle" />}
    </div>
  );
});
