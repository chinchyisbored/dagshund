import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffStateStyles } from "./diff-state-styles.ts";

type JobNodeType = Node<DagNodeData, "job">;

/** Extract the short job name from a resource key like "resources.jobs.etl_pipeline". */
const formatJobLabel = (resourceKey: string): string => {
  const segments = resourceKey.split(".");
  return segments[segments.length - 1] ?? resourceKey;
};

export function JobNode({ data }: NodeProps<JobNodeType>) {
  const styles = getDiffStateStyles(data.diffState);
  const jobName = formatJobLabel(data.resourceKey);

  return (
    <div
      className={`rounded-lg border-2 px-5 py-3 text-center ${styles.border} ${styles.background} ${styles.text} ${styles.opacity}`}
    >
      <div className="text-xs uppercase tracking-wide opacity-60">job</div>
      <div className="text-sm font-semibold">{jobName}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  );
}
