import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { ObjectStateCard } from "../../../src/components/detail-panel/object-state-card.tsx";
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
