import { describe, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "../../src/components/search-bar.tsx";

// SearchBar debounces onSearch by 300ms. Use user-event to simulate real
// typing (handles React's native input-value descriptor correctly — happy-dom
// + fireEvent.change hits a React/happy-dom integration edge case where the
// event instance can't be resolved and React throws `inst.tag null`).

describe("SearchBar", () => {
  test("typing fires onSearch with the lowercased trimmed query (debounced)", async () => {
    const calls: string[] = [];
    const user = userEvent.setup();
    const { getByLabelText } = render(<SearchBar onSearch={(q) => calls.push(q)} matchCount={0} />);
    const input = getByLabelText("Search nodes") as HTMLInputElement;
    await user.type(input, "HELLO");
    await waitFor(() => expect(calls.at(-1)).toBe("hello"), { timeout: 800 });
  });

  test("clear button resets the input and fires onSearch with empty string", async () => {
    const calls: string[] = [];
    const user = userEvent.setup();
    const { getByLabelText } = render(<SearchBar onSearch={(q) => calls.push(q)} matchCount={3} />);
    const input = getByLabelText("Search nodes") as HTMLInputElement;
    await user.type(input, "foo");
    await user.click(getByLabelText("Clear search"));
    expect(input.value).toBe("");
    expect(calls.at(-1)).toBe("");
  });

  test("shows match count when a query is active", async () => {
    const user = userEvent.setup();
    const { getByLabelText, container } = render(<SearchBar onSearch={() => {}} matchCount={5} />);
    const input = getByLabelText("Search nodes") as HTMLInputElement;
    await user.type(input, "q");
    expect(container.textContent).toContain("5 matches");
  });

  test("Escape clears the input", async () => {
    const user = userEvent.setup();
    const { getByLabelText } = render(<SearchBar onSearch={() => {}} matchCount={0} />);
    const input = getByLabelText("Search nodes") as HTMLInputElement;
    await user.type(input, "abc");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
  });
});
