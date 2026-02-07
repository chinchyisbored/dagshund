import { describe, expect, test } from "bun:test";
import { getDiffStateStyles } from "../../src/components/diff-state-styles.ts";
import type { DiffState } from "../../src/types/diff-state.ts";

describe("getDiffStateStyles", () => {
  test("added returns emerald classes with full opacity", () => {
    const styles = getDiffStateStyles("added");
    expect(styles.border).toBe("border-emerald-500");
    expect(styles.background).toBe("bg-emerald-500/10");
    expect(styles.text).toBe("text-emerald-300");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("removed returns red dashed classes with full opacity", () => {
    const styles = getDiffStateStyles("removed");
    expect(styles.border).toBe("border-red-500");
    expect(styles.borderStyle).toBe("border-dashed");
    expect(styles.background).toBe("bg-red-500/10");
    expect(styles.text).toBe("text-red-400");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("modified returns amber classes with full opacity", () => {
    const styles = getDiffStateStyles("modified");
    expect(styles.border).toBe("border-amber-500");
    expect(styles.background).toBe("bg-amber-500/10");
    expect(styles.text).toBe("text-amber-300");
    expect(styles.opacity).toBe("opacity-100");
  });

  test("unchanged returns zinc classes with full opacity", () => {
    const styles = getDiffStateStyles("unchanged");
    expect(styles.border).toBe("border-zinc-600");
    expect(styles.background).toBe("bg-zinc-800");
    expect(styles.text).toBe("text-zinc-300");
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
