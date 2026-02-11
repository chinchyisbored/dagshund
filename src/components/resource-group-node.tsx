import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { NODE_WIDTH } from "../graph/index.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";

type ResourceGroupNodeType = Node<DagNodeData, "resource-group">;

/** Derive a type badge for virtual group nodes from their ID convention. */
const extractGroupBadge = (resourceKey: string, isExternal: boolean): string | undefined => {
  if (isExternal) return "schema";
  if (resourceKey.startsWith("catalog::")) return "catalog";
  return undefined;
};

export const ResourceGroupNode = memo(function ResourceGroupNode({ id, data }: NodeProps<ResourceGroupNodeType>) {
  const { isDimmed, styles, hasIncoming, hasOutgoing } = useNodeDimming(id, data.diffState);

  const isExternal = data.external;
  const groupBadge = extractGroupBadge(data.resourceKey, isExternal);
  const borderStyleOverride = isExternal ? "border-dashed" : styles.borderStyle;

  return (
    <div
      style={{
        width: NODE_WIDTH,
        ...(isDimmed ? { opacity: 0.3 } : undefined),
      }}
      className={`flex items-center gap-2 truncate rounded-lg border-2 px-4 py-2 text-sm font-semibold ${styles.border} ${borderStyleOverride} ${styles.background} ${styles.text}`}
      title={data.label}
    >
      {hasIncoming && (
        <Handle type="target" position={Position.Left} className="!bg-handle" />
      )}
      <span className="truncate">{data.label}</span>
      {groupBadge !== undefined && (
        <span className="shrink-0 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] text-badge-text">
          {groupBadge}
        </span>
      )}
      {hasOutgoing && (
        <Handle type="source" position={Position.Right} className="!bg-handle" />
      )}
    </div>
  );
});
