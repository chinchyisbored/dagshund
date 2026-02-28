import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { NODE_WIDTH } from "../graph/layout-graph.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { PhantomGraphNode, RootGraphNode } from "../types/graph-types.ts";
import { getDiffBadge } from "../utils/diff-state-styles.ts";
import { extractPhantomBadge } from "../utils/resource-key.ts";
import { LateralHandles } from "./lateral-handles.tsx";
import { LateralIsolateButton } from "./lateral-isolate-button.tsx";

type HierarchyNodeType = Node<Omit<RootGraphNode | PhantomGraphNode, "id">, "root" | "phantom">;

export const HierarchyNode = memo(function HierarchyNode({
  id,
  data,
}: NodeProps<HierarchyNodeType>) {
  const {
    glowStyle,
    styles,
    hasIncoming,
    hasOutgoing,
    lateralHandles,
    hasLateralEdges,
    isLateralIsolated,
  } = useNodeDimming(id, data.diffState);
  const isPhantom = data.nodeKind === "phantom";
  const badge = isPhantom ? extractPhantomBadge(data.resourceKey) : undefined;
  const diffBadge = isPhantom ? getDiffBadge(data.diffState) : undefined;
  const borderStyle = isPhantom ? "border-dashed" : styles.borderStyle;

  return (
    <div
      style={{ width: NODE_WIDTH, ...glowStyle }}
      className={`flex cursor-pointer flex-col rounded-lg border-2 px-4 py-1.5 font-semibold ${styles.border} ${borderStyle} ${styles.background} ${styles.text}`}
      title={data.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-handle"
        style={hasIncoming ? undefined : { visibility: "hidden" }}
      />
      <span className="truncate text-sm">
        {diffBadge !== undefined && (
          <span className="mr-1" aria-hidden="true">
            {diffBadge}
          </span>
        )}
        {data.label}
      </span>
      <div className="flex items-center gap-1.5">
        {badge !== undefined && (
          <span className="shrink-0 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] font-normal text-badge-text">
            {badge}
          </span>
        )}
        {hasLateralEdges && <LateralIsolateButton nodeId={id} isActive={isLateralIsolated} />}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-handle"
        style={hasOutgoing ? undefined : { visibility: "hidden" }}
      />
      <LateralHandles lateralHandles={lateralHandles} />
    </div>
  );
});
