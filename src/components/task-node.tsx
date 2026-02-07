import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useNodeConnections,
} from "@xyflow/react";
import { NODE_WIDTH } from "../graph/index.ts";
import { useHoverState } from "../hooks/use-hover-context.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";

type TaskNodeType = Node<DagNodeData, "task">;

export function TaskNode({ id, data }: NodeProps<TaskNodeType>) {
  const { connectedIds } = useHoverState();
  const incomingConnections = useNodeConnections({ handleType: "target" });
  const outgoingConnections = useNodeConnections({ handleType: "source" });
  const isDimmed = connectedIds !== null && !connectedIds.has(id);
  const styles = getDiffStateStyles(data.diffState);

  return (
    <div
      style={{ width: NODE_WIDTH, ...(isDimmed ? { opacity: 0.3 } : undefined) }}
      className={`truncate rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.background} ${styles.text} ${styles.opacity}`}
      title={data.label}
    >
      {incomingConnections.length > 0 && (
        <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      )}
      <span>{data.label}</span>
      {outgoingConnections.length > 0 && (
        <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
      )}
    </div>
  );
}
