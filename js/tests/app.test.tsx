import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import * as planGraphBuilder from "../src/graph/build-plan-graph.ts";
import * as resourceGraphBuilder from "../src/graph/build-resource-graph.ts";
import * as planPreparer from "../src/preparation/prepare-plan.ts";
import * as planNormalizer from "../src/utils/normalize-plan.ts";

mock.module("../src/styles/output.css", () => ({}));
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
    const { getByRole } = render(<App />);

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

  test("pipeline-only suppression is shared by both graph views and keeps its global summary", async () => {
    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = {
      plan: {
        "resources.pipelines.only": {
          action: "update",
          changes: {
            "libraries[0].whl": {
              action: "update",
              old: "/artifacts/lib-1.0-py3-none-any.whl",
              new: "/artifacts/lib-2.0-py3-none-any.whl",
            },
          },
          new_state: { value: { pipeline_id: "pipeline-1" } },
        },
        "resources.pipelines.second": {
          action: "update",
          changes: {
            "libraries[0].whl": {
              action: "update",
              old: "/artifacts/other-1.0-py3-none-any.whl",
              new: "/artifacts/other-2.0-py3-none-any.whl",
            },
          },
          new_state: { value: { pipeline_id: "pipeline-2" } },
        },
      },
    };
    const buildPlanGraph = spyOn(planGraphBuilder, "buildPlanGraph");
    const buildResourceGraph = spyOn(resourceGraphBuilder, "buildResourceGraph");
    const view = render(<App />);

    fireEvent.click(view.getByRole("button", { name: /^Hide wheel updates/ }));
    await waitFor(() => expect(view.getByRole("region", { name: "Wheel updates" })).toBeTruthy());
    const summary = view.getByRole("region", { name: "Wheel updates" });
    expect(summary.querySelectorAll("li")).toHaveLength(2);
    expect(summary.textContent).toContain("1 pipelines");
    expect(summary.textContent).not.toMatch(/0 (tasks|environments|pipelines)/);
    expect(view.getByRole("status").textContent).toBe("No non-wheel changes");
    await waitFor(() =>
      expect(
        buildPlanGraph.mock.calls.some(
          ([plan]) => plan.normalized.entries["resources.pipelines.only"]?.action === "skip",
        ),
      ).toBe(true),
    );
    expect(
      buildResourceGraph.mock.calls.some(
        ([plan]) => plan.normalized.entries["resources.pipelines.only"]?.action === "skip",
      ),
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: /^Hide wheel updates/ }));
    expect(view.queryByRole("region", { name: "Wheel updates" })).toBeNull();
    expect(view.queryByRole("status")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /^Hide wheel updates/ }));
    expect(view.getByRole("status").textContent).toBe("No non-wheel changes");
    buildPlanGraph.mockRestore();
    buildResourceGraph.mockRestore();
  });

  test("empty states ignore skipped attached and orphan run effects", async () => {
    const plans = [
      {
        "resources.jobs.nightly": { action: "skip", remote_state: { job_id: 300 } },
        "resources.job_runs.nightly": {
          action: "skip",
          remote_state: { job_id: 300 },
        },
      },
      {
        "resources.job_runs.orphan": {
          action: "skip",
          remote_state: { job_id: 999 },
        },
      },
    ];

    for (const plan of plans) {
      (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = { plan };
      const view = render(<App />);
      await waitFor(() => expect(view.getByRole("status").textContent).toBe("No changes"));
      view.unmount();
    }
  });

  test("in-progress attached and orphan runs remain activity through wheel suppression", async () => {
    const pendingRun = {
      action: "skip",
      changes: { result_state: { action: "skip", reason: "run in progress" } },
      remote_state: { job_id: 100, run_id: 7, state: { life_cycle_state: "RUNNING" } },
    };
    const plans = [
      {
        "resources.jobs.pending": { action: "skip", remote_state: { job_id: 100 } },
        "resources.job_runs.pending": {
          ...pendingRun,
          depends_on: [{ node: "resources.jobs.pending" }],
        },
      },
      { "resources.job_runs.orphan": pendingRun },
    ];

    for (const plan of plans) {
      (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = { plan };
      const view = render(<App />);
      await waitFor(() => expect(view.queryByRole("status")).toBeNull());
      view.unmount();
    }

    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = {
      plan: {
        "resources.jobs.wheel": {
          action: "update",
          changes: {
            "tasks[task_key='task'].libraries[0].whl": {
              action: "update",
              old: "/artifacts/lib-1.0-py3-none-any.whl",
              new: "/artifacts/lib-2.0-py3-none-any.whl",
            },
          },
          remote_state: { job_id: 100 },
          new_state: { value: { job_id: 100, tasks: [{ task_key: "task" }] } },
        },
        "resources.job_runs.pending": {
          ...pendingRun,
          depends_on: [{ node: "resources.jobs.wheel" }],
        },
      },
    };
    const view = render(<App />);
    const toggle = view.getByRole("button", { name: /^Hide wheel updates/ });
    fireEvent.click(toggle);
    await waitFor(() => expect(view.queryByRole("status")).toBeNull());
    expect(view.getByRole("region", { name: "Wheel updates" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(view.queryByRole("status")).toBeNull();
    expect(view.queryByRole("region", { name: "Wheel updates" })).toBeNull();
    fireEvent.click(toggle);
    expect(view.queryByRole("status")).toBeNull();
  });

  test("wheel-only empty state is shown after suppression and active effects remain activity", async () => {
    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = {
      plan: {
        "resources.jobs.wheel": {
          action: "update",
          changes: {
            "tasks[task_key='task'].libraries[0].whl": {
              action: "update",
              old: "/artifacts/lib-1.0-py3-none-any.whl",
              new: "/artifacts/lib-2.0-py3-none-any.whl",
            },
          },
          new_state: { value: { tasks: [{ task_key: "task" }] } },
        },
      },
    };
    const view = render(<App />);
    fireEvent.click(view.getByRole("button", { name: /^Hide wheel updates/ }));
    await waitFor(() => expect(view.getByRole("status").textContent).toBe("No non-wheel changes"));
    expect(view.getByRole("region", { name: "Wheel updates" })).toBeTruthy();
    view.unmount();

    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = {
      plan: {
        "resources.jobs.nightly": { action: "skip", remote_state: { job_id: 300 } },
        "resources.job_runs.nightly": {
          action: "create",
          new_state: { value: { job_id: 300 } },
        },
      },
    };
    const activeView = render(<App />);
    await waitFor(() => expect(activeView.queryByRole("status")).toBeNull());
  });
});
