import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { LateralEdgeToggle } from "../../src/components/lateral-edge-toggle.tsx";

describe("LateralEdgeToggle", () => {
  test("renders label with count", () => {
    const { getByText } = render(
      <LateralEdgeToggle active={false} onToggle={() => {}} count={7} />,
    );
    expect(getByText("Lateral dependencies (7)")).toBeDefined();
  });

  test("click fires onToggle exactly once", () => {
    let calls = 0;
    const { getByRole } = render(
      <LateralEdgeToggle active={false} onToggle={() => calls++} count={2} />,
    );
    fireEvent.click(getByRole("button"));
    expect(calls).toBe(1);
  });

  test("active=true sets aria-pressed and accent styling", () => {
    const { getByRole } = render(<LateralEdgeToggle active={true} onToggle={() => {}} count={0} />);
    const button = getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("border-[var(--edge-lateral)]");
  });
});
