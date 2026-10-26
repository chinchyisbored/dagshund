import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { DetailPanel } from "../../../src/components/detail-panel/detail-panel.tsx";
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

const PROVIDER_PLAN: Plan = {
  plan: {
    "resources.model_provider_services.provider": {
      action: "create",
      new_state: {
        value: {
          parent: "schemas/main.ai",
          model_provider_service_id: "provider",
          config: {
            amazon_bedrock: {
              direct: {
                service_credential: { name: "credentials/aws" },
                aws_access_key_id: "[REDACTED]",
              },
            },
          },
        },
      },
    },
  },
};

const PROVIDER_DATA: Extract<DagNodeData, { nodeKind: "resource" }> = {
  nodeKind: "resource",
  label: "provider",
  diffState: "added",
  resourceKey: "resources.model_provider_services.provider",
  changes: undefined,
  resourceState: {
    parent: "schemas/main.ai",
    model_provider_service_id: "provider",
    config: {
      amazon_bedrock: {
        direct: {
          service_credential: { name: "credentials/aws", aws_access_key_id: "[REDACTED]" },
        },
      },
    },
  },
  newState: undefined,
  remoteState: undefined,
  resourceHasShapeDrift: false,
  taskChangeSummary: undefined,
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
  test("renders an ordinary provider state and field change in the detail panel", () => {
    const { container } = render(
      <PlanContext.Provider value={PROVIDER_PLAN}>
        <DetailPanel
          data={{
            ...PROVIDER_DATA,
            diffState: "modified",
            changes: { "config.safe": { action: "update", old: false, new: true } },
          }}
          onClose={() => {}}
          width={400}
        />
      </PlanContext.Provider>,
    );

    expect(container.textContent).toContain("provider");
    expect(container.textContent).toContain("Modified");
    expect(container.textContent).toContain("safe");
    expect(container.textContent).toContain("true");
  });

  test("renders ordinary provider raw JSON with only redacted credential data", () => {
    const { getByText, container } = render(
      <PlanContext.Provider value={PROVIDER_PLAN}>
        <RawJsonDisclosure data={PROVIDER_DATA} />
      </PlanContext.Provider>,
    );

    fireEvent.click(getByText("Raw JSON"));

    expect(container.textContent).toContain("credentials/aws");
    expect(container.textContent).toContain("[REDACTED]");
    expect(container.textContent).not.toContain("secret-value");
  });

  test("does not expose the owner entry for a derived node", () => {
    const { queryByText } = render(
      <PlanContext.Provider value={PLAN}>
        <RawJsonDisclosure data={DERIVED_DATA} />
      </PlanContext.Provider>,
    );

    expect(queryByText("Raw JSON")).toBeNull();
  });
});
