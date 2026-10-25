import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { xyflowMockFactory } from "./helpers/xyflow-mock.ts";

mock.module("@xyflow/react", xyflowMockFactory);
mock.module("../src/styles/output.css", () => ({}));
const { App } = await import("../src/app.tsx");

const wheelChange = {
  action: "update",
  old: "/artifacts/lib-1.0-py3-none-any.whl",
  new: "/artifacts/lib-2.0-py3-none-any.whl",
};

const integrationPlan = {
  plan: {
    "resources.jobs.mixed": {
      action: "update",
      changes: {
        "tasks[task_key='wheel'].libraries[0].whl": wheelChange,
        "tasks[task_key='regular'].notebook_path": {
          action: "update",
          old: "/old.py",
          new: "/new.py",
        },
      },
      new_state: {
        value: {
          job_id: 17,
          tasks: [{ task_key: "wheel" }, { task_key: "regular" }],
        },
      },
    },
    "resources.jobs.wheel-only": {
      action: "update",
      changes: { "tasks[task_key='wheel'].libraries[0].whl": wheelChange },
      new_state: { value: { job_id: 18, tasks: [{ task_key: "wheel" }] } },
    },
  },
};

afterEach(() => {
  delete (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__;
});

describe("wheel suppression through application views", () => {
  test("refreshes selected resource details and preserves original raw JSON through on/off/on", async () => {
    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = integrationPlan;

    const view = render(<App />);
    await waitFor(() => expect(view.getByTestId("flow-node-workspace-root")).toBeTruthy());
    const nodes = view.getAllByTestId("flow-node-resources.jobs.mixed");
    const resourceNode = nodes[nodes.length - 1];
    if (resourceNode === undefined) throw new Error("Resources graph node was not rendered");
    fireEvent.click(resourceNode);
    const taskSummary = () => view.getByText("Task Changes").parentElement?.nextElementSibling;
    expect(taskSummary()?.textContent).toContain("wheel");
    expect(taskSummary()?.textContent).toContain("regular");
    expect(view.getByRole("button", { name: "Modified (2)" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: /Raw JSON/ }));
    expect(view.container.querySelector("pre")?.textContent).toContain("lib-1.0-py3-none-any.whl");

    const toggle = () => view.getByRole("button", { name: /Hide wheel updates/ });
    fireEvent.click(toggle());
    await waitFor(() => expect(view.getByRole("button", { name: "Modified (1)" })).toBeTruthy());
    expect(taskSummary()?.textContent).not.toContain("wheel");
    expect(taskSummary()?.textContent).toContain("regular");
    fireEvent.click(view.getByRole("button", { name: /Raw JSON/ }));
    expect(view.container.querySelector("pre")?.textContent).toContain("lib-1.0-py3-none-any.whl");
    expect(view.getByRole("region", { name: "Wheel updates" })).toBeTruthy();

    fireEvent.click(toggle());
    await waitFor(() => expect(view.getByRole("button", { name: "Modified (2)" })).toBeTruthy());
    expect(taskSummary()?.textContent).toContain("wheel");
    expect(taskSummary()?.textContent).toContain("regular");
    fireEvent.click(toggle());
    await waitFor(() => expect(view.getByRole("button", { name: "Modified (1)" })).toBeTruthy());
    fireEvent.click(view.getByRole("button", { name: "Modified (1)" }));
    expect(view.getByRole("region", { name: "Wheel updates" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Modified (1)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(view.getByRole("button", { name: "Jobs (2)" }));
    const jobsToggle = view.getByRole("button", { name: "Hide wheel updates (2)" });
    expect(jobsToggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(jobsToggle);
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Hide wheel updates (2)" }).getAttribute("aria-pressed"),
      ).toBe("false"),
    );
    fireEvent.click(view.getByRole("button", { name: /Hide wheel updates/ }));
    await waitFor(() =>
      expect(
        view.getByRole("button", { name: "Hide wheel updates (2)" }).getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });

  test("keeps a selected wheel task detail reversible across Jobs controls", async () => {
    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = integrationPlan;
    const view = render(<App />);
    fireEvent.click(view.getByRole("button", { name: "Jobs (2)" }));
    await waitFor(() =>
      expect(view.getByTestId("flow-node-resources.jobs.wheel-only::wheel")).toBeTruthy(),
    );
    fireEvent.click(view.getByTestId("flow-node-resources.jobs.wheel-only::wheel"));

    const originalRequirement = "lib-1.0-py3-none-any.whl";
    const revisedRequirement = "lib-2.0-py3-none-any.whl";
    const assertOriginalTaskDetail = () => {
      expect(view.container.querySelector('[title="Has field-level changes"]')).toBeTruthy();
      expect(view.container.textContent).toContain(originalRequirement);
      expect(view.container.textContent).toContain(revisedRequirement);
    };
    assertOriginalTaskDetail();

    const toggle = () => view.getByRole("button", { name: /Hide wheel updates/ });
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(view.container.querySelector('[title="No changes planned"]')).toBeTruthy(),
    );
    expect(view.container.textContent).not.toContain(originalRequirement);
    expect(view.container.textContent).not.toContain(revisedRequirement);

    fireEvent.click(toggle());
    await waitFor(() =>
      expect(view.container.querySelector('[title="Has field-level changes"]')).toBeTruthy(),
    );
    assertOriginalTaskDetail();
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(view.container.querySelector('[title="No changes planned"]')).toBeTruthy(),
    );
  });

  test("modified search and counts follow effective wheel-only task state", async () => {
    (window as { __DAGSHUND_PLAN__?: unknown }).__DAGSHUND_PLAN__ = integrationPlan;
    const view = render(<App />);
    await waitFor(() => expect(view.getByRole("button", { name: "Modified (2)" })).toBeTruthy());

    fireEvent.click(view.getByRole("button", { name: "Jobs (2)" }));
    await waitFor(() =>
      expect(view.getByTestId("flow-node-resources.jobs.wheel-only::wheel")).toBeTruthy(),
    );
    const search = view.getByRole("textbox", { name: "Search nodes" });
    await userEvent.setup().type(search, "status:modified");
    await waitFor(() => expect(search).toHaveProperty("value", "status:modified"));
    expect(view.getByRole("button", { name: "Modified (5)" })).toBeTruthy();
    await waitFor(() => expect(view.getByText("5 matches")).toBeTruthy());

    expect(search).toHaveProperty("value", "status:modified");
    fireEvent.click(view.getByRole("button", { name: "Modified (5)" }));
    fireEvent.click(view.getByRole("button", { name: "Hide wheel updates (2)" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Modified (2)" })).toBeTruthy());
    expect(search).toHaveProperty("value", "status:modified");
    expect(view.getByRole("button", { name: "Modified (2)" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await waitFor(() => expect(view.getByText("2 matches")).toBeTruthy());
    expect(view.getByRole("region", { name: "Wheel updates" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "Resources (2)" }));
    const resourceToggle = view.getByRole("button", { name: "Hide wheel updates (2)" });
    expect(resourceToggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(resourceToggle);
    await waitFor(() => expect(view.getByRole("button", { name: "Modified (2)" })).toBeTruthy());
    expect(view.queryByRole("region", { name: "Wheel updates" })).toBeNull();
  });
});
