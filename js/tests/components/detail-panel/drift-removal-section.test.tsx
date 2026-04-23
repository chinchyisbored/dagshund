import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { DriftRemovalSection } from "../../../src/components/detail-panel/drift-removal-section.tsx";
import type { ChangeDesc } from "../../../src/types/plan-schema.ts";
import { compose, withValueFormat } from "../../helpers/providers.tsx";

const wrapper = compose(withValueFormat());

describe("DriftRemovalSection", () => {
  test("renders section label, prose and one entry", () => {
    const entries: Record<string, ChangeDesc> = {
      "tasks[task_key='publish'].depends_on[task_key='ingest']": {
        action: "update",
        remote: { task_key: "ingest" },
      },
    };
    const { container } = render(<DriftRemovalSection driftRemovalChanges={entries} />, {
      wrapper,
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Removed on apply (drift)");
    expect(text).toContain("Present on the remote but missing from your bundle");
    expect(text).toContain("apply will remove it");
    // Stripped task prefix on the entry key line, '-' prefixed.
    expect(text).toContain("- depends_on[task_key='ingest']");
  });

  test("renders dashed-red-bordered card for drift styling", () => {
    const entries: Record<string, ChangeDesc> = {
      "depends_on[task_key='ingest']": {
        action: "update",
        remote: { task_key: "ingest" },
      },
    };
    const { container } = render(<DriftRemovalSection driftRemovalChanges={entries} />, {
      wrapper,
    });
    // The drift card is the only dashed border in this subtree; assert it exists.
    const dashed = container.querySelector(".border-dashed.border-diff-removed");
    expect(dashed).not.toBeNull();
  });

  test("renders empty section body (no cards) when passed empty record", () => {
    // Caller (detail-panel) gates rendering on hasDriftRemovals, so this code
    // path is defensive only: an empty record should produce zero cards but
    // shouldn't throw.
    const { container } = render(<DriftRemovalSection driftRemovalChanges={{}} />, { wrapper });
    expect(container.querySelectorAll(".border-dashed.border-diff-removed").length).toBe(0);
  });
});
