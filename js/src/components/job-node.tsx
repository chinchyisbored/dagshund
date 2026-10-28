import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffBadge } from "../utils/diff-state-styles.ts";
import { extractResourceName } from "../utils/resource-key.ts";
import { RunEffectBadge } from "./run-effect-badge.tsx";

type JobNodeType = Node<DagNodeData, "job">;

export const JobNode = memo(function JobNode({ id, data }: NodeProps<JobNodeType>) {
  const { opacityClass, glowStyle, styles, hasIncoming, hasOutgoing } = useNodeDimming(
    id,
    data.diffState,
  );
  const jobName = extractResourceName(data.resourceKey);
  const badge = getDiffBadge(data.diffState);
  const effects = data.nodeKind === "job" ? data.effects : undefined;

  return (
    <div
      className={`job-node h-full w-full rounded-xl border-2 ${styles.border} ${styles.borderStyle} ${opacityClass}`}
      style={glowStyle}
    >
      {hasIncoming && <Handle type="target" position={Position.Left} className="!bg-handle" />}
      <button
        type="button"
        className={`job-node-header flex h-9 w-full items-center overflow-hidden rounded-t-[10px] border-0 px-4 text-left text-xs font-semibold uppercase tracking-wide ${styles.background} ${styles.text} ${data.diffState === "unchanged" ? "job-node-header-unchanged" : ""} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-accent`}
        aria-label={`Open job details for ${jobName}`}
        title={jobName}
        style={{ pointerEvents: "auto" }}
      >
        <span className="mr-1 shrink-0" aria-hidden="true">
          {badge}
        </span>
        <span className="truncate">{jobName}</span>
        {data.isStateCleanup === true && (
          <span className="ml-2 shrink-0 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-badge-text">
            State cleanup
          </span>
        )}
        {effects !== undefined && <RunEffectBadge effects={effects} className="ml-2 shrink-0" />}
      </button>
      {hasOutgoing && <Handle type="source" position={Position.Right} className="!bg-handle" />}
    </div>
  );
});
