import { describeJobRunEffect, type JobRunEffect } from "../utils/normalize-plan.ts";

/** Play badge summarizing a node's deploy-triggered runs: green when any run
 *  fires on deploy (create/recreate), grey when every run already ran (skip).
 *  Delete-only effects render no badge — the record removal is shown in the
 *  detail panel instead (dagshund-ocb1). */
export function RunEffectBadge({
  effects,
  className = "",
}: {
  readonly effects: readonly JobRunEffect[];
  readonly className?: string;
}) {
  const visible = effects.filter((effect) => effect.action !== "delete");
  if (visible.length === 0) return null;
  const firesOnDeploy = visible.some(
    (effect) => effect.action === "create" || effect.action === "recreate",
  );
  const colors = firesOnDeploy
    ? "bg-action-create-soft text-action-create"
    : "bg-badge-bg text-badge-text";

  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal ${colors} ${className}`}
      title={effects.map(describeJobRunEffect).join(", ")}
    >
      {"▶"}
      {visible.length > 1 ? ` ${visible.length}` : ""}
    </span>
  );
}
