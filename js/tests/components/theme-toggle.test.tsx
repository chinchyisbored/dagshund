import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { ThemeToggle } from "../../src/components/theme-toggle.tsx";

type MediaQueryStub = {
  readonly media: string;
  matches: boolean;
  readonly addEventListener: () => void;
  readonly removeEventListener: () => void;
  readonly dispatchEvent: () => boolean;
};

const makeStub = (media: string, matches: boolean): MediaQueryStub => ({
  media,
  matches,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  // Default: light mode, no high-contrast.
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a browser global for tests
  (window as any).matchMedia = (query: string): MediaQueryList => {
    const matches = query === "(prefers-color-scheme: light)";
    return makeStub(query, matches) as unknown as MediaQueryList;
  };
  localStorage.clear();
  document.documentElement.classList.remove("dark", "high-contrast");
});

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: restoring browser global
  (window as any).matchMedia = originalMatchMedia;
  localStorage.clear();
  document.documentElement.classList.remove("dark", "high-contrast");
});

describe("ThemeToggle", () => {
  test("renders a theme button and a contrast button", () => {
    const { getByLabelText } = render(<ThemeToggle />);
    // In light mode, the theme button label is "Switch to dark mode".
    expect(getByLabelText("Switch to dark mode")).toBeDefined();
    expect(getByLabelText("Toggle high contrast mode")).toBeDefined();
  });

  test("click on the theme button flips light → dark", () => {
    const { getByLabelText } = render(<ThemeToggle />);
    fireEvent.click(getByLabelText("Switch to dark mode"));
    expect(localStorage.getItem("dagshund-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("click on the contrast button enables high-contrast", () => {
    const { getByLabelText } = render(<ThemeToggle />);
    fireEvent.click(getByLabelText("Toggle high contrast mode"));
    expect(localStorage.getItem("dagshund-theme")).toBe("high-contrast");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
  });
});
