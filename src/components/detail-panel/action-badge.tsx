const ACTION_BADGE_COLORS: Readonly<Record<string, string>> = {
  create: "text-action-create bg-action-create-soft",
  update: "text-action-update bg-action-update-soft",
  update_id: "text-action-update bg-action-update-soft",
  delete: "text-action-delete bg-action-delete-soft",
  recreate: "text-action-recreate bg-action-recreate-soft",
  resize: "text-action-resize bg-action-resize-soft",
};

export function ActionBadge({ action }: { readonly action: string }) {
  const colors = ACTION_BADGE_COLORS[action] ?? "text-badge-text bg-badge-bg";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors}`}>{action}</span>;
}
