import type { Node, NodeProps } from "@xyflow/react";
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
    <div className={`h-full w-full rounded-xl border-2 ${styles.border} ${styles.opacity}`}>
      <div
        className={`rounded-t-[10px] px-4 py-2 text-xs font-semibold uppercase tracking-wide ${styles.background} ${styles.text}`}
      >
        {jobName}
      </div>
    </div>
  );
}
