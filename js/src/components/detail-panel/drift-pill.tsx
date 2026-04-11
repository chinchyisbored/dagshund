/**
 * Small textual pill signaling that a node carries topology drift:
 * a sub-entity defined in the bundle but missing from the remote, which
 * Databricks will re-add on apply.
 *
 * Deliberately NOT composed with DiffStateBadge — drift is an orthogonal
 * dimension (runs alongside added/modified/unchanged), with distinct
 * semantics, geometry, and color.
 */
export function DriftPill() {
  return (
    <span
      title="Sub-entity is missing from the remote — will be re-added on apply"
      className="rounded-full border border-dashed border-ink-muted px-1.5 py-0 text-[10px] font-medium text-ink-muted"
    >
      drift
    </span>
  );
}
