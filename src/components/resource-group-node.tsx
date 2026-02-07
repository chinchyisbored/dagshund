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

type ResourceGroupNodeType = Node<DagNodeData, "resource-group">;

const TARGET_HANDLE = { handleType: "target" } as const;
const SOURCE_HANDLE = { handleType: "source" } as const;

/** Derive a type badge for virtual group nodes from their ID convention. */
const extractGroupBadge = (resourceKey: string, isExternal: boolean): string | undefined => {
  if (isExternal) return "schema";
  if (resourceKey.startsWith("catalog::")) return "catalog";
  return undefined;
};

export const ResourceGroupNode = memo(function ResourceGroupNode({ id, data }: NodeProps<ResourceGroupNodeType>) {
  const { connectedIds, filterMatchedIds } = useHoverState();
  const incomingConnections = useNodeConnections(TARGET_HANDLE);
  const outgoingConnections = useNodeConnections(SOURCE_HANDLE);
  const isDimmedByHover = connectedIds !== null && !connectedIds.has(id);
  const isDimmedByFilter = filterMatchedIds !== null && !filterMatchedIds.has(id);
  const isDimmed = isDimmedByHover || isDimmedByFilter;

  const isExternal = data.external;
  const groupBadge = extractGroupBadge(data.resourceKey, isExternal);
  const borderColor = isExternal ? "border-zinc-600/60" : "border-zinc-600";
  const bgClass = isExternal ? "bg-zinc-800/40" : "bg-zinc-800";
  const textClass = isExternal ? "text-zinc-400" : "text-zinc-300";

  return (
    <div
      style={{
        width: NODE_WIDTH,
        borderStyle: isExternal ? "dashed" : "solid",
        ...(isDimmed ? { opacity: 0.3 } : undefined),
      }}
      className={`flex items-center gap-2 truncate rounded-lg border-2 px-4 py-2 text-sm font-semibold ${borderColor} ${bgClass} ${textClass}`}
      title={data.label}
    >
      {incomingConnections.length > 0 && (
        <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      )}
      <span className="truncate">{data.label}</span>
      {groupBadge !== undefined && (
        <span className="shrink-0 rounded bg-zinc-600/40 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {groupBadge}
        </span>
      )}
      {outgoingConnections.length > 0 && (
        <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
      )}
    </div>
  );
});
