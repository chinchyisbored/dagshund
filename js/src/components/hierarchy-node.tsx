import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { NODE_WIDTH } from "../graph/layout-graph.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { PhantomGraphNode, RootGraphNode } from "../types/graph-types.ts";
import { getDiffBadge } from "./diff-state-styles.ts";
import { LateralHandles } from "./lateral-handles.tsx";

type HierarchyNodeType = Node<Omit<RootGraphNode | PhantomGraphNode, "id">, "root" | "phantom">;

/** Derive a type badge for phantom nodes from their ID convention. */
const extractPhantomBadge = (resourceKey: string): string | undefined => {
  if (resourceKey.startsWith("postgres-project::")) return "project";
  if (resourceKey.startsWith("external::postgres-branch::")) return "branch";
  if (resourceKey.startsWith("source-table::")) return "table";
  if (resourceKey.startsWith("catalog::")) return "catalog";
  if (resourceKey.startsWith("external::")) return "schema"; // catch-all for external:: LAST
  return undefined;
};

export const HierarchyNode = memo(function HierarchyNode({
  id,
  data,
}: NodeProps<HierarchyNodeType>) {
  const { glowStyle, styles, hasIncoming, hasOutgoing, lateralHandles } = useNodeDimming(
    id,
    data.diffState,
  );
  const isPhantom = data.nodeKind === "phantom";
  const badge = isPhantom ? extractPhantomBadge(data.resourceKey) : undefined;
  const diffBadge = getDiffBadge(data.diffState);
  const borderStyle = isPhantom ? "border-dashed" : styles.borderStyle;

  return (
    <div
      style={{ width: NODE_WIDTH, ...glowStyle }}
      className={`flex cursor-pointer items-center gap-2 truncate rounded-lg border-2 px-4 py-2 text-sm font-semibold ${styles.border} ${borderStyle} ${styles.background} ${styles.text}`}
      title={data.label}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-handle"
        style={hasIncoming ? undefined : { visibility: "hidden" }}
      />
      <span className="truncate">
        {diffBadge !== undefined && (
          <span className="mr-1" aria-hidden="true">
            {diffBadge}
          </span>
        )}
        {data.label}
      </span>
      {badge !== undefined && (
        <span className="shrink-0 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] text-badge-text">
          {badge}
        </span>
      )}
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
