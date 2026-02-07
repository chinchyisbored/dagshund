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

type ResourceNodeType = Node<DagNodeData, "resource">;

const TARGET_HANDLE = { handleType: "target" } as const;
const SOURCE_HANDLE = { handleType: "source" } as const;

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

/** Extract the resource type from a resource key like "resources.schemas.analytics". */
const extractTypeBadge = (resourceKey: string): string | undefined => {
  const segments = resourceKey.split(".");
  const typeSegment = segments[1];
  return typeSegment !== undefined ? TYPE_BADGES[typeSegment] ?? typeSegment : undefined;
};

export const ResourceNode = memo(function ResourceNode({ id, data }: NodeProps<ResourceNodeType>) {
  const { connectedIds, filterMatchedIds } = useHoverState();
  const incomingConnections = useNodeConnections(TARGET_HANDLE);
  const outgoingConnections = useNodeConnections(SOURCE_HANDLE);
  const isDimmedByHover = connectedIds !== null && !connectedIds.has(id);
  const isDimmedByFilter = filterMatchedIds !== null && !filterMatchedIds.has(id);
  const isDimmed = isDimmedByHover || isDimmedByFilter;
  const isFilterHighlighted = filterMatchedIds?.has(id);
  const styles = getDiffStateStyles(data.diffState);
  const opacityClass = isFilterHighlighted ? "opacity-100" : styles.opacity;
  const typeBadge = extractTypeBadge(data.resourceKey);

  return (
    <div
      style={{ width: NODE_WIDTH, ...(isDimmed ? { opacity: 0.3 } : undefined) }}
      className={`flex items-center gap-2 truncate rounded-lg border-2 px-4 py-2 text-sm ${styles.border} ${styles.background} ${styles.text} ${opacityClass}`}
      title={data.label}
    >
      {incomingConnections.length > 0 && (
        <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      )}
      <span className="truncate">{data.label}</span>
      {typeBadge !== undefined && (
        <span className="shrink-0 rounded bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {typeBadge}
        </span>
      )}
      {outgoingConnections.length > 0 && (
        <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
      )}
    </div>
  );
});
