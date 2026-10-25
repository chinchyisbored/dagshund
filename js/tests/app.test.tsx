import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { RawJsonDisclosure } from "../src/components/detail-panel/raw-json-disclosure.tsx";
import * as planGraphBuilder from "../src/graph/build-plan-graph.ts";
import * as resourceGraphBuilder from "../src/graph/build-resource-graph.ts";
import { useResourceGraph } from "../src/hooks/use-resource-graph.ts";
import * as planPreparer from "../src/preparation/prepare-plan.ts";
import * as planNormalizer from "../src/utils/normalize-plan.ts";

mock.module("../src/styles/output.css", () => ({}));
mock.module("../src/components/resources-view.tsx", () => ({
  ResourcesView: ({ plan }: { readonly plan: Parameters<typeof useResourceGraph>[0] }) => {
    useResourceGraph(plan);
    return (
      <>
        <RawJsonDisclosure
          data={{
            nodeKind: "resource",
            resourceKey: "resources.schemas.analytics",
            label: "analytics",
            diffState: "unchanged",
            changes: undefined,
            resourceState: undefined,
            newState: undefined,
            remoteState: undefined,
            resourceHasShapeDrift: false,
            taskChangeSummary: undefined,
          }}
        />
        <RawJsonDisclosure
          data={{
            nodeKind: "resource",
            resourceKey: "resources.job_runs.nightly",
            label: "nightly",
            diffState: "unchanged",
            changes: undefined,
            resourceState: undefined,
            newState: undefined,
            remoteState: undefined,
            resourceHasShapeDrift: false,
            taskChangeSummary: undefined,
          }}
        />
      </>
    );
  },
}));
const { App } = await import("../src/app.tsx");

afterEach(() => {
  delete (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__;
});

describe("PlanView normalization orchestration", () => {
  test("shows safe diagnostics while keeping the resource tab available", async () => {
    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = {
      plan: {
        "resources.model_serving_endpoints.secret": {
          action: "update",
          new_state: {
            value: { config: { served_entities: [{ entity_name: 42, secret: "TOP_SECRET" }] } },
          },
        },
        "resources.unknown_type.item": {
          action: "create",
          new_state: { value: { label: "opaque" } },
        },
        "resources.jobs.example": {
          action: "create",
          new_state: { value: { name: "example", tasks: [{ task_key: "task" }] } },
        },
      },
    };
    const { getByText, getByRole, queryByText } = render(<App />);
    await waitFor(() => expect(getByText("1 plan warning")).toBeTruthy());
    const resourcesTab = getByRole("button", { name: "Resources (3)" });
    const jobsTab = getByRole("button", { name: "Jobs (1)" });
    expect(resourcesTab).toBeTruthy();
    expect(queryByText("TOP_SECRET")).toBeNull();
    fireEvent.click(getByText("1 plan warning"));
    expect(getByText("resources.model_serving_endpoints.secret")).toBeTruthy();
    expect(getByText(/Serving endpoint model references could not be interpreted/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("TOP_SECRET");
    fireEvent.click(jobsTab);
    expect(jobsTab.className).toContain("border-ink");
    fireEvent.click(resourcesTab);
    expect(resourcesTab.className).toContain("border-ink");
  });

  test("tab counts exclude folded job-run effects and both graph consumers share one normalization", async () => {
    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = {
      plan: {
        "resources.schemas.analytics": {
          action: "update",
          changes: { name: { old_value: "analytics", new_value: "analytics" } },
        },
        "resources.schemas.analytics.grants": {
          action: "update",
          changes: { privileges: { old_value: ["USE"], new_value: ["USE", "SELECT"] } },
        },
        "resources.jobs.etl": { action: "skip", remote_state: { job_id: 300 } },
        "resources.job_runs.nightly": {
          action: "skip",
          remote_state: { job_id: 300 },
        },
      },
      plan_version: 1,
    };

    const normalizePlan = spyOn(planNormalizer, "normalizePlan");
    const preparePlan = spyOn(planPreparer, "preparePlan");
    const buildPlanGraph = spyOn(planGraphBuilder, "buildPlanGraph");
    const buildResourceGraph = spyOn(resourceGraphBuilder, "buildResourceGraph");
    const { getByRole, getAllByRole } = render(<App />);

    await waitFor(() => expect(getByRole("button", { name: "Jobs (1)" })).toBeTruthy());
    expect(getByRole("button", { name: "Resources (2)" })).toBeTruthy();
    await waitFor(() => expect(buildPlanGraph).toHaveBeenCalled());
    await waitFor(() => expect(buildResourceGraph).toHaveBeenCalled());
    expect(normalizePlan).toHaveBeenCalledTimes(1);
    const normalizedPlan = normalizePlan.mock.results[0]?.value;
    const preparedPlan = preparePlan.mock.results[0]?.value;
    expect(preparePlan).toHaveBeenCalledTimes(1);
    expect(preparePlan).toHaveBeenCalledWith(normalizedPlan);
    expect(buildPlanGraph.mock.calls.every(([plan]) => plan === preparedPlan)).toBe(true);
    expect(buildResourceGraph.mock.calls.every(([plan]) => plan === preparedPlan)).toBe(true);

    const rawJsonButtons = getAllByRole("button", { name: /Raw JSON/ });
    expect(rawJsonButtons.length).toBeGreaterThan(0);
    const firstRawJsonButton = rawJsonButtons[0];
    if (firstRawJsonButton !== undefined) fireEvent.click(firstRawJsonButton);
    const rawJson = document.querySelectorAll("pre");
    expect(rawJson).toHaveLength(2);
    expect(rawJson[0]?.textContent).toContain('"action": "update"');
    expect(rawJson[0]?.textContent).toContain('"name"');
    expect(rawJson[0]?.textContent).not.toContain("annotations");
    expect(rawJson[1]?.textContent).toContain('"privileges"');
    expect(rawJson[1]?.textContent).toContain('"SELECT"');

    if (rawJsonButtons[1] !== undefined) fireEvent.click(rawJsonButtons[1]);
    const expandedRawJson = document.querySelectorAll("pre");
    expect(expandedRawJson).toHaveLength(3);
    expect(expandedRawJson[2]?.textContent).toContain('"job_id": 300');
    expect(expandedRawJson[2]?.textContent).not.toContain("annotations");

    fireEvent.click(getByRole("button", { name: "Jobs (1)" }));
    fireEvent.click(getByRole("button", { name: "Resources (2)" }));
    expect(normalizePlan).toHaveBeenCalledTimes(1);
    expect(buildPlanGraph.mock.calls.every(([plan]) => plan === preparedPlan)).toBe(true);
    expect(buildResourceGraph.mock.calls.every(([plan]) => plan === preparedPlan)).toBe(true);
    normalizePlan.mockRestore();
    preparePlan.mockRestore();
    buildPlanGraph.mockRestore();
    buildResourceGraph.mockRestore();
  });
});
