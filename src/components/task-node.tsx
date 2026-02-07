import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useNodeConnections,
} from "@xyflow/react";
import { memo } from "react";
import { NODE_WIDTH } from "../graph/index.ts";
import { useHoverState } from "../hooks/use-hover-context.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";

type TaskNodeType = Node<DagNodeData, "task">;

const TARGET_HANDLE = { handleType: "target" } as const;
const SOURCE_HANDLE = { handleType: "source" } as const;

export const TaskNode = memo(function TaskNode({ id, data }: NodeProps<TaskNodeType>) {
  const { connectedIds, filterMatchedIds } = useHoverState();
  const incomingConnections = useNodeConnections(TARGET_HANDLE);
  const outgoingConnections = useNodeConnections(SOURCE_HANDLE);
  const isDimmedByHover = connectedIds !== null && !connectedIds.has(id);
  const isDimmedByFilter = filterMatchedIds !== null && !filterMatchedIds.has(id);
  const isDimmed = isDimmedByHover || isDimmedByFilter;
  const isFilterHighlighted = filterMatchedIds !== null && filterMatchedIds.has(id);
  const styles = getDiffStateStyles(data.diffState);
  const opacityClass = isFilterHighlighted ? "opacity-100" : styles.opacity;

  return (
    <div
      style={{ width: NODE_WIDTH, ...(isDimmed ? { opacity: 0.3 } : undefined) }}
      className={`truncate rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.background} ${styles.text} ${opacityClass}`}
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
});
