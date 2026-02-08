import { describe, expect, test } from "bun:test";
import { getDiffStateStyles } from "../../src/components/diff-state-styles.ts";
import type { DiffState } from "../../src/types/diff-state.ts";

describe("getDiffStateStyles", () => {
  test("added returns themed diff classes with full opacity", () => {
    const styles = getDiffStateStyles("added");
    expect(styles.border).toBe("border-diff-added");
    expect(styles.background).toBe("bg-diff-added-soft");
    expect(styles.text).toBe("text-diff-added");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("removed returns themed diff dashed classes with full opacity", () => {
    const styles = getDiffStateStyles("removed");
    expect(styles.border).toBe("border-diff-removed");
    expect(styles.borderStyle).toBe("border-dashed");
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

  test("every DiffState returns all four style properties", () => {
    const states: readonly DiffState[] = ["added", "removed", "modified", "unchanged"];
    for (const state of states) {
      const styles = getDiffStateStyles(state);
      expect(styles).toHaveProperty("border");
      expect(styles).toHaveProperty("background");
      expect(styles).toHaveProperty("text");
      expect(styles).toHaveProperty("opacity");
    }
  });
});
