import type { CSSProperties } from "react";

/** Build the shared boxShadow + opacity inline style used by all node components. */
export const buildGlowStyle = (
  isSelected: boolean,
  isHovered: boolean,
  isDimmed: boolean,
  dimOpacity: number,
  hoverGlow: string,
): CSSProperties => ({
  ...(isSelected
    ? { boxShadow: `0 0 0 2.5px ${hoverGlow}` }
    : isHovered
      ? { boxShadow: `0 0 0 1.5px ${hoverGlow}` }
      : undefined),
  ...(isDimmed ? { opacity: dimOpacity } : undefined),
});
