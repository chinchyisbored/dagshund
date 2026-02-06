import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";

type TaskNodeType = Node<DagNodeData, "task">;

export function TaskNode({ data }: NodeProps<TaskNodeType>) {
  const styles = getDiffStateStyles(data.diffState);

  return (
    <div
      className={`rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.background} ${styles.text} ${styles.opacity}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <span>{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  );
}
