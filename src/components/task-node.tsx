import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { NODE_WIDTH } from "../graph/index.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";

type TaskNodeType = Node<DagNodeData, "task">;

export function TaskNode({ data }: NodeProps<TaskNodeType>) {
  const styles = getDiffStateStyles(data.diffState);

  return (
    <div
      style={{ width: NODE_WIDTH }}
      className={`truncate rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.background} ${styles.text} ${styles.opacity}`}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      <span>{data.label}</span>
      <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
    </div>
  );
}
