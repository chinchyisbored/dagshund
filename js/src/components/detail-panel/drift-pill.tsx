/**
 * Small textual pill signaling drift between the bundle and the remote:
 * a manual edit that apply will reconcile. Covers three cases — field-level
 * drift (apply will overwrite), topology re-add (apply will re-add), and
 * reclassified list-element delete (apply will remove).
 *
 * Deliberately NOT composed with DiffStateBadge — drift is an orthogonal
 * dimension (runs alongside added/modified/unchanged), with distinct
 * semantics, geometry, and color.
 */
export function DriftPill() {
  return (
    <span
      title="Differs from remote — apply will reconcile this"
      className="rounded-full border border-dashed border-ink-muted px-1.5 py-0 text-[10px] font-medium text-ink-muted"
    >
      drift
    </span>
  );
}
