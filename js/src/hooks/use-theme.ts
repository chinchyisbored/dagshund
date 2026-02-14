import { useCallback, useEffect, useMemo, useState } from "react";

type ThemePreference = "light" | "dark" | "high-contrast" | "system";
type ResolvedTheme = "light" | "dark" | "high-contrast";

const STORAGE_KEY = "dagshund-theme";

const readPreference = (): ThemePreference => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "high-contrast" || stored === "system")
    return stored;
  return "system";
};

const resolveSystemTheme = (): ResolvedTheme => {
  if (window.matchMedia("(prefers-contrast: more)").matches) return "high-contrast";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

const applyToDom = (resolved: ResolvedTheme): void => {
  const classes = document.documentElement.classList;
  classes.toggle("dark", resolved === "dark");
  classes.toggle("high-contrast", resolved === "high-contrast");
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
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const contrastQuery = window.matchMedia("(prefers-contrast: more)");

    const update = () => setSystemTheme(resolveSystemTheme());

    darkQuery.addEventListener("change", update);
    contrastQuery.addEventListener("change", update);
    return () => {
      darkQuery.removeEventListener("change", update);
      contrastQuery.removeEventListener("change", update);
    };
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
