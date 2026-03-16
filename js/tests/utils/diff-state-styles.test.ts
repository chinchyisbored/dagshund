import { describe, expect, test } from "bun:test";
import type { DiffState } from "../../src/types/diff-state.ts";
import type { EdgeDiffState } from "../../src/types/graph-types.ts";
import {
  getDiffBadge,
  getDiffStateStyles,
  getEdgeStyle,
} from "../../src/utils/diff-state-styles.ts";

describe("getDiffStateStyles", () => {
  test("added returns themed diff classes with full opacity", () => {
    const styles = getDiffStateStyles("added");
    expect(styles.border).toBe("border-diff-added");
    expect(styles.background).toBe("bg-diff-added-soft");
    expect(styles.text).toBe("text-diff-added");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("removed returns themed diff classes with full opacity and no dashed border", () => {
    const styles = getDiffStateStyles("removed");
    expect(styles.border).toBe("border-diff-removed");
    expect(styles.borderStyle).toBe("");
    expect(styles.background).toBe("bg-diff-removed-soft");
    expect(styles.text).toBe("text-diff-removed");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("modified returns themed diff classes with full opacity", () => {
    const styles = getDiffStateStyles("modified");
    expect(styles.border).toBe("border-diff-modified");
    expect(styles.background).toBe("bg-diff-modified-soft");
    expect(styles.text).toBe("text-diff-modified");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("unchanged returns themed diff classes with full opacity", () => {
    const styles = getDiffStateStyles("unchanged");
    expect(styles.border).toBe("border-diff-unchanged-border");
    expect(styles.background).toBe("bg-diff-unchanged-bg");
    expect(styles.text).toBe("text-diff-unchanged-text");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("unknown returns themed diff classes with dashed border", () => {
    const styles = getDiffStateStyles("unknown");
    expect(styles.border).toBe("border-diff-unknown");
    expect(styles.borderStyle).toBe("border-dashed");
    expect(styles.background).toBe("bg-diff-unknown-soft");
    expect(styles.text).toBe("text-diff-unknown");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("every DiffState returns all six style properties", () => {
    const states: readonly DiffState[] = ["added", "removed", "modified", "unchanged", "unknown"];
    for (const state of states) {
      const styles = getDiffStateStyles(state);
      expect(styles).toHaveProperty("border");
      expect(styles).toHaveProperty("borderStyle");
      expect(styles).toHaveProperty("background");
      expect(styles).toHaveProperty("text");
      expect(styles).toHaveProperty("opacity");
      expect(styles).toHaveProperty("hoverGlow");
    }
  });
});

describe("getDiffBadge", () => {
  test("returns + for added", () => {
    expect(getDiffBadge("added")).toBe("+");
  });

  test("returns minus sign for removed", () => {
    expect(getDiffBadge("removed")).toBe("\u2212");
  });

  test("returns ~ for modified", () => {
    expect(getDiffBadge("modified")).toBe("~");
  });

  test("returns = for unchanged", () => {
    expect(getDiffBadge("unchanged")).toBe("=");
  });

  test("returns ? for unknown", () => {
    expect(getDiffBadge("unknown")).toBe("?");
  });
});

describe("getEdgeStyle", () => {
  test("added edges use added color with no dash", () => {
    const style = getEdgeStyle("added");
    expect(style.stroke).toBe("var(--edge-added)");
    expect(style.opacity).toBe(1);
    expect(style.strokeDasharray).toBeUndefined();
  });

  test("removed edges use removed color with dashed stroke", () => {
    const style = getEdgeStyle("removed");
    expect(style.stroke).toBe("var(--edge-removed)");
    expect(style.opacity).toBe(1);
    expect(style.strokeDasharray).toBe("6 4");
  });

  test("unchanged edges use unchanged color with no dash", () => {
    const style = getEdgeStyle("unchanged");
    expect(style.stroke).toBe("var(--edge-unchanged)");
    expect(style.opacity).toBe(1);
    expect(style.strokeDasharray).toBeUndefined();
  });

  test("every EdgeDiffState returns all three style properties", () => {
    const states: readonly EdgeDiffState[] = ["added", "removed", "unchanged"];
    for (const state of states) {
      const style = getEdgeStyle(state);
      expect(style).toHaveProperty("stroke");
      expect(style).toHaveProperty("opacity");
      expect(style).toHaveProperty("strokeDasharray");
    }
  });
});
