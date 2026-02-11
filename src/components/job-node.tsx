import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { getDiffBadge } from "./diff-state-styles.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { extractResourceName } from "../utils/resource-key.ts";

type JobNodeType = Node<DagNodeData, "job">;

export const JobNode = memo(function JobNode({ id, data }: NodeProps<JobNodeType>) {
  const { isDimmed, dimOpacity, isHovered, isSelected, opacityClass, styles, hasIncoming, hasOutgoing } = useNodeDimming(id, data.diffState);
  const jobName = extractResourceName(data.resourceKey);
  const badge = getDiffBadge(data.diffState);

  return (
    <div
      className={`h-full w-full cursor-pointer rounded-xl border-2 ${styles.border} ${styles.borderStyle} ${opacityClass}`}
      style={{ ...(isSelected ? { boxShadow: `0 0 0 2.5px ${styles.hoverGlow}` } : isHovered ? { boxShadow: `0 0 0 1.5px ${styles.hoverGlow}` } : undefined), ...(isDimmed ? { opacity: dimOpacity } : undefined) }}
    >
      {hasIncoming && (
        <Handle type="target" position={Position.Left} className="!bg-handle" />
      )}
      <div
        className={`rounded-t-[10px] px-4 py-2 text-xs font-semibold uppercase tracking-wide ${styles.background} ${styles.text}`}
      >
        {badge !== undefined && <span className="mr-1" aria-hidden="true">{badge}</span>}{jobName}
      </div>
      {hasOutgoing && (
        <Handle type="source" position={Position.Right} className="!bg-handle" />
      )}
    </div>
  );
});
