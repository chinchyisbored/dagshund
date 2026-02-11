import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { getDiffBadge } from "./diff-state-styles.ts";
import { extractResourceType } from "../graph/build-resource-graph.ts";
import { NODE_WIDTH } from "../graph/index.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";

type ResourceNodeType = Node<DagNodeData, "resource">;

/** Map resource type segment to a short display badge. */
const TYPE_BADGES: Readonly<Record<string, string>> = {
  schemas: "schema",
  volumes: "volume",
  registered_models: "model",
  catalogs: "catalog",
  dashboards: "dashboard",
  genie_spaces: "genie",
  apps: "app",
  experiments: "experiment",
};

/** Extract the resource type badge from a resource key like "resources.schemas.analytics". */
const extractTypeBadge = (resourceKey: string): string | undefined => {
  const typeSegment = extractResourceType(resourceKey);
  return typeSegment !== undefined ? TYPE_BADGES[typeSegment] ?? typeSegment : undefined;
};

export const ResourceNode = memo(function ResourceNode({ id, data }: NodeProps<ResourceNodeType>) {
  const { isDimmed, dimOpacity, isHovered, isSelected, opacityClass, styles, hasIncoming, hasOutgoing } = useNodeDimming(id, data.diffState);
  const typeBadge = extractTypeBadge(data.resourceKey);
  const diffBadge = getDiffBadge(data.diffState);

  return (
    <div
      style={{ width: NODE_WIDTH, ...(isSelected ? { boxShadow: `0 0 0 2.5px ${styles.hoverGlow}` } : isHovered ? { boxShadow: `0 0 0 1.5px ${styles.hoverGlow}` } : undefined), ...(isDimmed ? { opacity: dimOpacity } : undefined) }}
      className={`flex cursor-pointer items-center gap-2 truncate rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.borderStyle} ${styles.background} ${styles.text} ${opacityClass}`}
      title={data.label}
    >
      {hasIncoming && (
        <Handle type="target" position={Position.Left} className="!bg-handle" />
      )}
      <span className="truncate">{diffBadge !== undefined && <span className="mr-1 font-semibold" aria-hidden="true">{diffBadge}</span>}{data.label}</span>
      {typeBadge !== undefined && (
        <span className="shrink-0 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] text-badge-text">
          {typeBadge}
        </span>
      )}
      {hasOutgoing && (
        <Handle type="source" position={Position.Right} className="!bg-handle" />
      )}
    </div>
  );
});
