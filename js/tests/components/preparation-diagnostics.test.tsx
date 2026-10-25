import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { PreparationDiagnostics } from "../../src/components/preparation-diagnostics.tsx";

describe("preparation diagnostic disclosure", () => {
  test("renders static messages and resource keys as text", () => {
    const { getByText, getByRole, container } = render(
      <PreparationDiagnostics
        diagnostics={[
          {
            resourceKey: "resources.model_serving_endpoints.bad",
            capability: "serving-endpoint-models",
            reason: "invalid-shape",
          },
        ]}
      />,
    );
    expect(getByText("1 plan warning")).toBeTruthy();
    expect(container.querySelector("details")?.open).toBe(false);
    fireEvent.click(getByText("1 plan warning"));
    expect(getByRole("list")).toBeTruthy();
    expect(getByText("resources.model_serving_endpoints.bad")).toBeTruthy();
    expect(container.querySelector("li")?.textContent).toContain(
      "Serving endpoint model references could not be interpreted.",
    );
  });

  test("renders nothing when there are no diagnostics", () => {
    const { container } = render(<PreparationDiagnostics diagnostics={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
