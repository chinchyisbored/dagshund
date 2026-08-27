import {
  classifyJobRunEffect,
  filterJobRunChanges,
  type JobRunEffectKind,
} from "../../utils/job-run-effects.ts";
import type { JobRunEffect } from "../../utils/normalize-plan.ts";
import { ChangeEntry } from "./change-entry.tsx";
import { SectionDivider } from "./section-divider.tsx";

const EFFECT_BADGE_COLORS: Readonly<Record<JobRunEffectKind, string>> = {
  create: "text-action-create bg-action-create-soft",
  recreate: "text-action-recreate bg-action-recreate-soft",
  "every-deploy": "text-action-recreate bg-action-recreate-soft",
  "completed-success": "text-badge-text bg-badge-bg",
  "legacy-skip": "text-badge-text bg-badge-bg",
  "in-progress": "text-action-resize bg-action-resize-soft",
  "trigger-removed": "text-badge-text bg-badge-bg",
  delete: "text-action-delete bg-action-delete-soft",
  unknown: "text-badge-text bg-badge-bg",
};

function RunEffectEntry({ effect }: { readonly effect: JobRunEffect }) {
  const semantics = classifyJobRunEffect(effect);
  const colors = EFFECT_BADGE_COLORS[semantics.kind];
  const fieldChanges = Object.entries(filterJobRunChanges(effect.changes));

  return (
    <div className="rounded border border-outline-subtle bg-surface-raised/50 p-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words font-mono text-xs text-ink-secondary">
          {"▶"} {effect.name}
        </span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${colors}`}>
          {semantics.wording}
        </span>
      </div>
      {semantics.stateMessage !== undefined && (
        <p className="mt-2 text-xs text-ink-muted">State: {semantics.stateMessage}</p>
      )}
      {effect.runPageUrl !== undefined && (
        <a
          href={effect.runPageUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-block text-xs text-accent hover:underline"
        >
          View run <span aria-hidden="true">&rarr;</span>
        </a>
      )}
      {fieldChanges.length > 0 && (
        <div className="mt-2 space-y-2">
          {fieldChanges.map(([fieldPath, change]) => (
            <ChangeEntry
              key={fieldPath}
              fieldPath={fieldPath}
              change={change}
              ctx={{
                changeKey: fieldPath,
                newState: effect.newState,
                remoteState: effect.remoteState,
                resourceHasShapeDrift: false,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Deploy-triggered runs (job_runs effects) for the selected node. Rendered
 *  for every diff state — effects never change the node's own state, so they
 *  need their own section to be visible on unchanged jobs (dagshund-ocb1). */
export function RunEffectsSection({ effects }: { readonly effects: readonly JobRunEffect[] }) {
  return (
    <div className="mb-3">
      <SectionDivider label="Deploy-triggered runs" />
      <div className="space-y-2">
        {effects.map((effect) => (
          <RunEffectEntry key={effect.name} effect={effect} />
        ))}
      </div>
    </div>
  );
}
