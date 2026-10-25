import { describe, expect, test } from "bun:test";
import { buildWorkspacePlacement } from "../../src/graph/build-workspace-graph.ts";

describe("buildWorkspacePlacement", () => {
  test("groups repeated real workspace resource types", () => {
    const placement = buildWorkspacePlacement(
      [
        ["resources.jobs.first", { action: "create" }],
        ["resources.jobs.second", { action: "create" }],
      ],
      [],
      false,
    );

    expect(placement.categoryTypes.has("jobs")).toBe(true);
    expect(placement.fallbackParentId).toBe("other-resources-root");
  });

  test("does not create categories for phantoms and keeps singleton plans flat", () => {
    const placement = buildWorkspacePlacement(
      [["resources.jobs.only", { action: "create" }]],
      [],
      false,
    );

    expect(placement.categoryTypes.size).toBe(0);
    expect(placement.fallbackParentId).toBe("workspace-root");
  });

  test("uses fallback root when Lakebase exists without repeated categories", () => {
    const placement = buildWorkspacePlacement(
      [["resources.jobs.only", { action: "create" }]],
      [],
      true,
    );

    expect(placement.categoryTypes.size).toBe(0);
    expect(placement.fallbackParentId).toBe("other-resources-root");
  });
});
