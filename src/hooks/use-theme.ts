import { useCallback, useEffect, useMemo, useState } from "react";

type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "dagshund-theme";

const readPreference = (): ThemePreference => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
};

const resolveSystemTheme = (): ResolvedTheme =>
  window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

const applyToDom = (resolved: ResolvedTheme): void => {
  document.documentElement.classList.toggle("dark", resolved === "dark");
};

export const useTheme = (): {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (next: ThemePreference) => void;
} => {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(resolveSystemTheme);

  const resolved = useMemo<ResolvedTheme>(
    () => (preference === "system" ? systemTheme : preference),
    [preference, systemTheme],
  );

  // Sync DOM whenever resolved theme changes
  useEffect(() => {
    applyToDom(resolved);
  }, [resolved]);

  // Listen for OS preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return { preference, resolved, setPreference };
};
