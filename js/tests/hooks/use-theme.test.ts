import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "../../src/hooks/use-theme.ts";

type MediaQueryStub = {
  readonly media: string;
  matches: boolean;
  readonly listeners: ((ev: MediaQueryListEvent) => void)[];
  readonly addEventListener: (type: "change", cb: (ev: MediaQueryListEvent) => void) => void;
  readonly removeEventListener: (type: "change", cb: (ev: MediaQueryListEvent) => void) => void;
  readonly dispatchEvent: (ev: MediaQueryListEvent) => void;
};

const makeStub = (media: string, initialMatches: boolean): MediaQueryStub => {
  const stub: MediaQueryStub = {
    media,
    matches: initialMatches,
    listeners: [],
    addEventListener: (_type, cb) => {
      stub.listeners.push(cb);
    },
    removeEventListener: (_type, cb) => {
      const idx = stub.listeners.indexOf(cb);
      if (idx >= 0) stub.listeners.splice(idx, 1);
    },
    dispatchEvent: (ev) => {
      for (const cb of [...stub.listeners]) cb(ev);
    },
  };
  return stub;
};

const originalMatchMedia = window.matchMedia;
type StubKey =
  | "(prefers-color-scheme: dark)"
  | "(prefers-color-scheme: light)"
  | "(prefers-contrast: more)";
let stubs: Record<StubKey, MediaQueryStub>;

beforeEach(() => {
  stubs = {
    "(prefers-color-scheme: dark)": makeStub("(prefers-color-scheme: dark)", false),
    "(prefers-color-scheme: light)": makeStub("(prefers-color-scheme: light)", true),
    "(prefers-contrast: more)": makeStub("(prefers-contrast: more)", false),
  };
  // biome-ignore lint/suspicious/noExplicitAny: stubbing a browser global for tests
  (window as any).matchMedia = (query: string): MediaQueryList => {
    const stub = (stubs as Record<string, MediaQueryStub | undefined>)[query];
    if (stub === undefined) return makeStub(query, false) as unknown as MediaQueryList;
    return stub as unknown as MediaQueryList;
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

describe("useTheme", () => {
  test("defaults to 'system' when storage is empty", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
  });

  test("resolves to 'light' when prefers-color-scheme: light matches", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("resolves to 'dark' when neither light nor high-contrast match", () => {
    stubs["(prefers-color-scheme: light)"].matches = false;
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("resolves to 'high-contrast' when prefers-contrast: more matches", () => {
    stubs["(prefers-contrast: more)"].matches = true;
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("high-contrast");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
  });

  test("setPreference persists to localStorage and applies the class", () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference("dark");
    });
    expect(localStorage.getItem("dagshund-theme")).toBe("dark");
    expect(result.current.preference).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("setPreference('system') clears storage", () => {
    localStorage.setItem("dagshund-theme", "dark");
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference("system");
    });
    expect(localStorage.getItem("dagshund-theme")).toBeNull();
  });

  test("readPreference picks up a persisted value on mount", () => {
    localStorage.setItem("dagshund-theme", "high-contrast");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("high-contrast");
    expect(result.current.resolved).toBe("high-contrast");
  });
});
