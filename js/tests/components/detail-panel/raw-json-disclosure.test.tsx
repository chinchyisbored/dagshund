import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { RawJsonDisclosure } from "../../../src/components/detail-panel/raw-json-disclosure.tsx";
import { PlanContext } from "../../../src/hooks/contexts.ts";
import type { DagNodeData } from "../../../src/types/graph-types.ts";
import type { Plan } from "../../../src/types/plan-schema.ts";

const PLAN: Plan = {
  plan: {
    "resources.postgres_synced_tables.weather": {
      action: "create",
      new_state: { value: { synced_table_id: "catalog.schema.weather" } },
    },
  },
};

const DERIVED_DATA: Extract<DagNodeData, { nodeKind: "derived" }> = {
  nodeKind: "derived",
  derivedKind: "ucSyncedTable",
  ownerResourceKey: "resources.postgres_synced_tables.weather",
  label: "weather",
  diffState: "added",
  resourceKey: "uc-synced-table::catalog.schema.weather",
  changes: undefined,
  resourceState: undefined,
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
};

describe("RawJsonDisclosure", () => {
  test("does not expose the owner entry for a derived node", () => {
    const { queryByText } = render(
      <PlanContext.Provider value={PLAN}>
        <RawJsonDisclosure data={DERIVED_DATA} />
      </PlanContext.Provider>,
    );

    expect(queryByText("Raw JSON")).toBeNull();
  });
});
