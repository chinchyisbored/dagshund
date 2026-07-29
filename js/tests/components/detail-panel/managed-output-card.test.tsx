import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { ManagedOutputCard } from "../../../src/components/detail-panel/managed-output-card.tsx";
import type { DagNodeData } from "../../../src/types/graph-types.ts";

const DATA: Extract<DagNodeData, { nodeKind: "derived" }> = {
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

describe("ManagedOutputCard", () => {
  test("describes the owner without exposing owner state", () => {
    const { container } = render(<ManagedOutputCard data={DATA} />);

    expect(container.textContent).toContain("Managed output of:");
    expect(container.textContent).toContain("weather");
    expect(container.textContent).toContain("postgres synced table");
  });

  test("navigates to the owner resource", () => {
    const visited: string[] = [];
    const { getByRole } = render(
      <ManagedOutputCard data={DATA} onNavigateToOwner={(nodeId) => visited.push(nodeId)} />,
    );

    fireEvent.click(getByRole("button"));

    expect(visited).toEqual(["resources.postgres_synced_tables.weather"]);
  });
});
