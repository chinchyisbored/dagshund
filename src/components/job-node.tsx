import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useNodeConnections,
} from "@xyflow/react";
import { memo } from "react";
import { useHoverState } from "../hooks/use-hover-context.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { extractResourceName } from "../utils/resource-key.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";

type JobNodeType = Node<DagNodeData, "job">;

const TARGET_HANDLE = { handleType: "target" } as const;
const SOURCE_HANDLE = { handleType: "source" } as const;

export const JobNode = memo(function JobNode({ id, data }: NodeProps<JobNodeType>) {
  const { connectedIds, filterMatchedIds } = useHoverState();
  const incomingConnections = useNodeConnections(TARGET_HANDLE);
  const outgoingConnections = useNodeConnections(SOURCE_HANDLE);
  const isDimmedByHover = connectedIds !== null && !connectedIds.has(id);
  const isDimmedByFilter = filterMatchedIds !== null && !filterMatchedIds.has(id);
  const isDimmed = isDimmedByHover || isDimmedByFilter;
  const isFilterHighlighted = filterMatchedIds !== null && filterMatchedIds.has(id);
  const styles = getDiffStateStyles(data.diffState);
  const opacityClass = isFilterHighlighted ? "opacity-100" : styles.opacity;
  const jobName = extractResourceName(data.resourceKey);

  return (
    <div
      className={`h-full w-full rounded-xl border-2 ${styles.border} ${styles.borderStyle} ${opacityClass}`}
      style={isDimmed ? { opacity: 0.3 } : undefined}
    >
      {incomingConnections.length > 0 && (
        <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      )}
      <div
        className={`rounded-t-[10px] px-4 py-2 text-xs font-semibold uppercase tracking-wide ${styles.background} ${styles.text}`}
      >
        {jobName}
      </div>
      {outgoingConnections.length > 0 && (
        <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
      )}
    </div>
  );
});
