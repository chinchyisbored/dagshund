import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { DetailPanel } from "../../../src/components/detail-panel/detail-panel.tsx";
import { ObjectStateCard } from "../../../src/components/detail-panel/object-state-card.tsx";
import { buildResourceGraphFromPlan } from "../../helpers/build-graphs-from-plan.ts";
import { compose, withValueFormat } from "../../helpers/providers.tsx";

const renderCard = (props: Parameters<typeof ObjectStateCard>[0]) =>
  render(<ObjectStateCard {...props} />, { wrapper: compose(withValueFormat()) });

describe("ObjectStateCard", () => {
  test("added variant renders 'was created' subtitle and DiffStateBadge 'added'", () => {
    const { container } = renderCard({
      label: "my-res",
      nodeKind: "resource",
      resourceState: { a: 1 },
      variant: "added",
    });
    expect(container.textContent).toContain("was created");
    expect(container.textContent).toContain("added");
  });

  test("removed variant renders 'was deleted' subtitle", () => {
    const { container } = renderCard({
      label: "my-res",
      nodeKind: "resource",
      resourceState: { a: 1 },
      variant: "removed",
    });
    expect(container.textContent).toContain("was deleted");
  });

  test("DetailPanel explains schedule removal from graph-produced resource context", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_snapshot_schedules.daily": {
          action: "delete",
          remote_state: {
            value: {
              branch: "projects/demo/branches/main",
              schedule: [{ cadence: "DAILY", retention_days: 7 }],
            },
          },
        },
      },
    });
    const schedule = graph.nodes.find(
      (node) => node.id === "resources.postgres_snapshot_schedules.daily",
    );
    if (!schedule) throw new Error("Expected graph to contain the removed schedule");
    const { id: _id, ...data } = schedule;

    const { container } = render(<DetailPanel data={data} onClose={() => {}} width={400} />, {
      wrapper: compose(withValueFormat()),
    });

    expect(container.textContent).toContain("disables automatic snapshots by clearing cadences");
    expect(container.textContent).toContain("Existing snapshots and the branch are preserved");
    expect(container.textContent).not.toContain("was deleted");
  });

  test("DetailPanel retains generic removal wording for other resource types", () => {
    const graph = buildResourceGraphFromPlan({
      plan: {
        "resources.postgres_branches.main": {
          action: "delete",
          remote_state: { value: { branch_id: "main" } },
        },
      },
    });
    const branch = graph.nodes.find((node) => node.id === "resources.postgres_branches.main");
    if (!branch) throw new Error("Expected graph to contain the removed branch");
    const { id: _id, ...data } = branch;

    const { container } = render(<DetailPanel data={data} onClose={() => {}} width={400} />, {
      wrapper: compose(withValueFormat()),
    });

    expect(container.textContent).toContain("was deleted");
    expect(container.textContent).not.toContain("disables automatic snapshots");
  });

  test("shows a resource-specific removal explanation when provided", () => {
    const { container } = renderCard({
      label: "daily",
      nodeKind: "resource",
      resourceState: {},
      variant: "removed",
      removalExplanation:
        "Removing this schedule disables automatic snapshots by clearing cadences. Existing snapshots and the branch are preserved.",
    });
    expect(container.textContent).toContain("disables automatic snapshots");
    expect(container.textContent).toContain("Existing snapshots and the branch are preserved");
    expect(container.textContent).not.toContain("was deleted");
  });

  test("renders one row per resourceState key, sorted", () => {
    const { container } = renderCard({
      label: "x",
      nodeKind: "resource",
      resourceState: { zebra: 1, alpha: 2 },
      variant: "added",
    });
    const text = container.textContent ?? "";
    // alpha sorts before zebra
    expect(text.indexOf("alpha")).toBeLessThan(text.indexOf("zebra"));
  });

  test("root/phantom nodeKind is labelled 'resource' in the subtitle", () => {
    const { container } = renderCard({
      label: "x",
      nodeKind: "root",
      resourceState: {},
      variant: "added",
    });
    expect(container.textContent).toContain("This resource");
  });

  test("drift re-entry variant uses the recreation subtitle", () => {
    const { container } = renderCard({
      label: "x",
      nodeKind: "task",
      resourceState: { a: 1 },
      variant: "added",
      isDriftReentry: true,
    });
    expect(container.textContent).toContain("missing from the remote");
  });
});
