import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { DiffFilterToolbar } from "../../src/components/diff-filter-toolbar.tsx";
import type { DiffState } from "../../src/types/diff-state.ts";

const baseCounts = { added: 2, modified: 3, removed: 1, unknown: 0 } as const;

describe("DiffFilterToolbar", () => {
  test("renders buttons for added/modified/removed with counts", () => {
    const { getByText } = render(
      <DiffFilterToolbar
        activeFilter={null}
        onFilterChange={() => {}}
        diffStateCounts={baseCounts}
      />,
    );
    expect(getByText("Added (2)")).toBeDefined();
    expect(getByText("Modified (3)")).toBeDefined();
    expect(getByText("Removed (1)")).toBeDefined();
  });

  test("'unknown' button is hidden when its count is 0", () => {
    const { queryByText } = render(
      <DiffFilterToolbar
        activeFilter={null}
        onFilterChange={() => {}}
        diffStateCounts={baseCounts}
      />,
    );
    expect(queryByText(/Unknown/)).toBeNull();
  });

  test("'unknown' button appears when its count is > 0", () => {
    const { getByText } = render(
      <DiffFilterToolbar
        activeFilter={null}
        onFilterChange={() => {}}
        diffStateCounts={{ ...baseCounts, unknown: 4 }}
      />,
    );
    expect(getByText("Unknown (4)")).toBeDefined();
  });

  test("clicking an inactive filter fires onFilterChange with its state", () => {
    const calls: (DiffState | null)[] = [];
    const { getByText } = render(
      <DiffFilterToolbar
        activeFilter={null}
        onFilterChange={(s) => calls.push(s)}
        diffStateCounts={baseCounts}
      />,
    );
    fireEvent.click(getByText("Added (2)"));
    expect(calls).toEqual(["added"]);
  });

  test("clicking the active filter clears it (null)", () => {
    const calls: (DiffState | null)[] = [];
    const { getByText } = render(
      <DiffFilterToolbar
        activeFilter="modified"
        onFilterChange={(s) => calls.push(s)}
        diffStateCounts={baseCounts}
      />,
    );
    fireEvent.click(getByText("Modified (3)"));
    expect(calls).toEqual([null]);
  });
});
