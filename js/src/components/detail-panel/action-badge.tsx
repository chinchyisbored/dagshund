const ACTION_BADGE_COLORS: Readonly<Record<string, string>> = {
  create: "text-action-create bg-action-create-soft",
  update: "text-action-update bg-action-update-soft",
  update_id: "text-action-update bg-action-update-soft",
  delete: "text-action-delete bg-action-delete-soft",
  recreate: "text-action-recreate bg-action-recreate-soft",
  resize: "text-action-resize bg-action-resize-soft",
  remote: "text-badge-text bg-badge-bg",
};

const ACTION_BADGE_TOOLTIPS: Readonly<Record<string, string>> = {
  create: "Will be created",
  update: "Will be updated in place",
  update_id: "Will be re-keyed (identifier change)",
  delete: "Will be deleted",
  recreate: "Will be deleted and recreated",
  resize: "Will be resized (cluster/compute)",
  remote: "Present on the remote, not managed by this bundle",
};

export function ActionBadge({ action }: { readonly action: string }) {
  const colors = ACTION_BADGE_COLORS[action] ?? "text-badge-text bg-badge-bg";
  const tooltip = ACTION_BADGE_TOOLTIPS[action];
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors}`} title={tooltip}>
      {action}
    </span>
  );
}
