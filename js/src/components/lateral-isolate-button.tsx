import { memo, type PointerEvent } from "react";
import { useLateralIsolation } from "../hooks/contexts.ts";

type LateralIsolateButtonProps = {
  readonly nodeId: string;
  readonly isActive: boolean;
};

/** Per-node chain icon that toggles lateral-edge isolation on click.
 *  Uses onPointerDown + stopPropagation to prevent node drag initiation
 *  and avoid click event interference from d3-drag or hover re-renders. */
export const LateralIsolateButton = memo(function LateralIsolateButton({
  nodeId,
  isActive,
}: LateralIsolateButtonProps) {
  const toggleIsolation = useLateralIsolation();
  if (toggleIsolation === null) return null;

  const handlePointerDown = (e: PointerEvent) => {
    e.stopPropagation();
    toggleIsolation(nodeId);
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      className={`ml-auto shrink-0 cursor-pointer rounded bg-badge-bg px-1.5 py-0.5 transition-all ${
        isActive
          ? "text-[var(--edge-lateral)] ring-1 ring-[var(--edge-lateral)]/40"
          : "text-badge-text hover:text-[var(--edge-lateral)] hover:ring-1 hover:ring-[var(--edge-lateral)]/40"
      }`}
      title="Isolate lateral edges"
      aria-label="Isolate lateral edges"
      aria-pressed={isActive}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
  );
});
