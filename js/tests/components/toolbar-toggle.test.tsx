import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { ToolbarToggle } from "../../src/components/toolbar-toggle.tsx";

describe("ToolbarToggle", () => {
  test("renders label with count", () => {
    const { getByText } = render(
      <ToolbarToggle label="Lateral dependencies" active={false} onToggle={() => {}} count={7} />,
    );
    expect(getByText("Lateral dependencies (7)")).toBeDefined();
  });

  test("click fires onToggle exactly once", () => {
    let calls = 0;
    const { getByRole } = render(
      <ToolbarToggle
        label="Inferred leaf nodes"
        active={false}
        onToggle={() => calls++}
        count={2}
      />,
    );
    fireEvent.click(getByRole("button"));
    expect(calls).toBe(1);
  });

  test("active=true sets aria-pressed and the custom active styling", () => {
    const { getByRole } = render(
      <ToolbarToggle
        label="Lateral dependencies"
        active={true}
        onToggle={() => {}}
        count={0}
        activeClassName="border-[var(--edge-lateral)] text-[var(--edge-lateral)]"
      />,
    );
    const button = getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("border-[var(--edge-lateral)]");
  });

  test("active=true without a custom palette uses the neutral ink styling", () => {
    const { getByRole } = render(
      <ToolbarToggle label="Hide wheel updates" active={true} onToggle={() => {}} count={3} />,
    );
    expect(getByRole("button").className).toContain("border-ink-muted");
  });

  test("title renders as the button tooltip", () => {
    const { getByRole } = render(
      <ToolbarToggle
        label="Hide wheel updates"
        active={false}
        onToggle={() => {}}
        count={3}
        title="Collapse wheel version bumps"
      />,
    );
    expect(getByRole("button").getAttribute("title")).toBe("Collapse wheel version bumps");
  });
});
