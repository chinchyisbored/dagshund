import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { useInteractionState } from "../hooks/contexts.ts";
import { useNodeDimming } from "../hooks/use-node-dimming.ts";
import type { DagNodeData } from "../types/graph-types.ts";
import { getDiffBadge } from "../utils/diff-state-styles.ts";
import { extractResourceName } from "../utils/resource-key.ts";
import type { WheelUpdate } from "../utils/wheel-updates.ts";
import { RunEffectBadge } from "./run-effect-badge.tsx";

type JobNodeType = Node<DagNodeData, "job">;

const formatWheelUpdate = (update: WheelUpdate): string =>
  update.oldVersion === update.newVersion
    ? `${update.distribution} updated`
    : `${update.distribution} ${update.oldVersion}→${update.newVersion}`;

/** Compact badge text: single wheel shows the version bump, multiple collapse
 *  to a count (full list lives in the title tooltip). */
const formatWheelBadge = (wheels: readonly WheelUpdate[]): string =>
  wheels.length === 1 && wheels[0] !== undefined
    ? formatWheelUpdate(wheels[0])
    : `${wheels.length} wheels updated`;

export const JobNode = memo(function JobNode({ id, data }: NodeProps<JobNodeType>) {
  const { hideWheelUpdates } = useInteractionState();
  const { opacityClass, glowStyle, styles, hasIncoming, hasOutgoing } = useNodeDimming(
    id,
    data.diffState,
  );
  const jobName = extractResourceName(data.resourceKey);
  const badge = getDiffBadge(data.diffState);
  const wheelUpdates = data.nodeKind === "job" ? data.wheelUpdates : undefined;
  const showWheelBadge = hideWheelUpdates && wheelUpdates !== undefined && wheelUpdates.length > 0;
  const effects = data.nodeKind === "job" ? data.effects : undefined;

  return (
    <div
      className={`h-full w-full cursor-pointer rounded-xl border-2 ${styles.border} ${styles.borderStyle} ${opacityClass}`}
      style={glowStyle}
    >
      {hasIncoming && <Handle type="target" position={Position.Left} className="!bg-handle" />}
      <div
        className={`rounded-t-[10px] px-4 py-2 text-xs font-semibold uppercase tracking-wide ${styles.background} ${styles.text}`}
      >
        <span className="mr-1" aria-hidden="true">
          {badge}
        </span>
        {jobName}
        {effects !== undefined && <RunEffectBadge effects={effects} className="ml-2" />}
        {showWheelBadge && (
          <span
            className="ml-2 rounded bg-badge-bg px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-badge-text"
            title={wheelUpdates.map(formatWheelUpdate).join(", ")}
          >
            {"⟳"} {formatWheelBadge(wheelUpdates)}
          </span>
        )}
      </div>
      {hasOutgoing && <Handle type="source" position={Position.Right} className="!bg-handle" />}
    </div>
  );
});
