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

type ResourceGroupNodeType = Node<DagNodeData, "resource-group">;

export function ResourceGroupNode({ id, data }: NodeProps<ResourceGroupNodeType>) {
  const { connectedIds, filterMatchedIds } = useHoverState();
  const incomingConnections = useNodeConnections({ handleType: "target" });
  const outgoingConnections = useNodeConnections({ handleType: "source" });
  const isDimmedByHover = connectedIds !== null && !connectedIds.has(id);
  const isDimmedByFilter = filterMatchedIds !== null && !filterMatchedIds.has(id);
  const isDimmed = isDimmedByHover || isDimmedByFilter;

  return (
    <div
      style={{ width: NODE_WIDTH, ...(isDimmed ? { opacity: 0.3 } : undefined) }}
      className="truncate rounded-lg border-2 border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-300"
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
