import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProvenancePanel } from "../../src/components/provenance-panel.tsx";
import type { Provenance } from "../../src/types/provenance-schema.ts";

const PRESENT_PROVENANCE: Provenance = {
  source_name: "source.json",
  source_modified_at: "2026-08-27T12:00:00Z",
  source_plan_sha256: "a".repeat(64),
  dagshund_version: "0.15.0",
  plan_cli_version: "1.14.0",
};

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Show provenance information"]',
  );
  if (!button) throw new Error("provenance button not found");
  await user.click(button);
  return button;
};

describe("ProvenancePanel", () => {
  test("renders provenance values in the required order", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProvenancePanel provenance={PRESENT_PROVENANCE} />);

    await openPanel(user);

    const labels = Array.from(
      container.querySelectorAll("dl > div dt"),
      (label) => label.textContent,
    );
    expect(labels).toEqual([
      "Source plan",
      "Last modified",
      "Source plan SHA-256",
      "Dagshund version",
      "Databricks CLI version (plan metadata)",
    ]);
    expect(container.textContent).toContain("source.json");
    expect(container.textContent).toContain("2026-08-27T12:00:00Z");
    expect(container.textContent).toContain("0.15.0");
    expect(container.textContent).toContain("1.14.0");
  });

  test("renders unknown values without provenance metadata", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProvenancePanel />);

    await openPanel(user);

    const values = Array.from(container.querySelectorAll("dl dd"), (value) => value.textContent);
    expect(values).toEqual(["unknown", "unknown", "unknown", "unknown", "unknown"]);
  });

  test("has an accessible icon button and expanded state", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<ProvenancePanel provenance={PRESENT_PROVENANCE} />);
    const button = getByRole("button", { name: "Show provenance information" });

    expect(button.getAttribute("title")).toBe("Show provenance information");
    expect(button.getAttribute("aria-controls")).toBe("dagshund-provenance-panel");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await user.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(getByRole("dialog")).toBeDefined();
  });

  test("opens with keyboard activation and focuses the close button", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(<ProvenancePanel provenance={PRESENT_PROVENANCE} />);
    const button = getByRole("button", { name: "Show provenance information" });
    button.focus();

    await user.keyboard("{Enter}");

    expect(getByRole("dialog")).toBeDefined();
    expect(document.activeElement).toBe(
      getByRole("button", { name: "Close provenance information" }),
    );
  });

  test("explicit close returns focus to the information button", async () => {
    const user = userEvent.setup();
    const { queryByRole, getByRole } = render(<ProvenancePanel provenance={PRESENT_PROVENANCE} />);
    const button = await openPanel(user);
    await user.click(getByRole("button", { name: "Close provenance information" }));

    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("Escape closes and returns focus to the information button", async () => {
    const user = userEvent.setup();
    const { queryByRole } = render(<ProvenancePanel provenance={PRESENT_PROVENANCE} />);
    const button = await openPanel(user);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("outside click closes and returns focus to the information button", async () => {
    const user = userEvent.setup();
    const { queryByRole } = render(<ProvenancePanel provenance={PRESENT_PROVENANCE} />);
    const button = await openPanel(user);

    fireEvent.mouseDown(document.body);

    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
