import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { DriftCard } from "../../../src/components/detail-panel/drift-card.tsx";
import { compose, withValueFormat } from "../../helpers/providers.tsx";

const wrapper = compose(withValueFormat());

describe("DriftCard", () => {
  test("reentry variant renders '+' prefixes and added palette", () => {
    const { container } = render(
      <DriftCard
        fieldPath="depends_on[task_key='transform']"
        value="transform"
        variant="reentry"
      />,
      { wrapper },
    );
    const card = container.firstElementChild;
    expect(card?.className).toContain("border-diff-added");
    expect(card?.className).toContain("border-dashed");
    const text = container.textContent ?? "";
    // Two PrefixedBlock rows: key then value, both prefixed with '+'
    expect(text).toContain("+ depends_on[task_key='transform']");
    expect(container.querySelectorAll(".text-diff-added").length).toBeGreaterThan(0);
  });

  test("removal variant renders '-' prefixes and removed palette", () => {
    const { container } = render(
      <DriftCard
        fieldPath="depends_on[task_key='ingest']"
        value={{ task_key: "ingest" }}
        variant="removal"
      />,
      { wrapper },
    );
    const card = container.firstElementChild;
    expect(card?.className).toContain("border-diff-removed");
    expect(card?.className).toContain("border-dashed");
    const text = container.textContent ?? "";
    expect(text).toContain("- depends_on[task_key='ingest']");
    expect(container.querySelectorAll(".text-diff-removed").length).toBeGreaterThan(0);
  });
});
