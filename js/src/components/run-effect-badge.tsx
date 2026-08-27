import { classifyJobRunEffect, describeJobRunEffect } from "../utils/job-run-effects.ts";
import type { JobRunEffect } from "../utils/normalize-plan.ts";

/** Summarize a node's deploy-triggered runs without changing the node's diff state. */
export function RunEffectBadge({
  effects,
  className = "",
}: {
  readonly effects: readonly JobRunEffect[];
  readonly className?: string;
}) {
  const classified = effects.map((effect) => ({ effect, semantics: classifyJobRunEffect(effect) }));
  const visible = classified.filter(({ semantics }) => semantics.badgeVisible);
  if (visible.length === 0) return null;

  const firesOnDeploy = visible.some(({ semantics }) => semantics.firesOnDeploy);
  const isInProgress =
    !firesOnDeploy && visible.some(({ semantics }) => semantics.kind === "in-progress");
  const colors = firesOnDeploy
    ? "bg-action-create-soft text-action-create"
    : isInProgress
      ? "bg-action-resize-soft text-action-resize"
      : "bg-badge-bg text-badge-text";
  const symbol = isInProgress ? "⏳" : "▶";

  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal ${colors} ${className}`}
      title={effects.map(describeJobRunEffect).join(", ")}
    >
      {symbol}
      {visible.length > 1 ? ` ${visible.length}` : ""}
    </span>
  );
}
