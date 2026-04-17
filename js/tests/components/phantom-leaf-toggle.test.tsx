import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { PhantomLeafToggle } from "../../src/components/phantom-leaf-toggle.tsx";

describe("PhantomLeafToggle", () => {
  test("renders label with count", () => {
    const { getByText } = render(
      <PhantomLeafToggle active={false} onToggle={() => {}} count={4} />,
    );
    expect(getByText("Inferred leaf nodes (4)")).toBeDefined();
  });

  test("click fires onToggle", () => {
    let calls = 0;
    const { getByRole } = render(
      <PhantomLeafToggle active={false} onToggle={() => calls++} count={0} />,
    );
    fireEvent.click(getByRole("button"));
    expect(calls).toBe(1);
  });

  test("active reflects into aria-pressed", () => {
    const { getByRole } = render(<PhantomLeafToggle active={true} onToggle={() => {}} count={1} />);
    expect(getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
