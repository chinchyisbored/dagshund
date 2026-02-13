import { useCallback, useEffect, useRef } from "react";
import { useTheme } from "../hooks/use-theme.ts";

/** Sun icon — shown in dark mode (click to switch to light). */
const SunIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

/** Moon icon — shown in light mode (click to switch to dark). */
const MoonIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

/** Contrast icon — half-filled circle for high contrast toggle. */
const ContrastIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" />
  </svg>
);

export function ThemeToggle() {
  const { resolved, setPreference } = useTheme();

  // Track the last non-HC theme so contrast toggle can return to it
  const previousThemeRef = useRef<"light" | "dark">(
    resolved === "high-contrast" ? "dark" : resolved === "light" ? "light" : "dark",
  );

  useEffect(() => {
    if (resolved !== "high-contrast") {
      previousThemeRef.current = resolved;
    }
  }, [resolved]);

  // Sun/moon: always toggles light↔dark, exits HC if active.
  // HC is visually dark, so sun icon → go to light.
  const handleThemeClick = useCallback(() => {
    const isLight = resolved === "light";
    setPreference(isLight ? "dark" : "light");
  }, [resolved, setPreference]);

  // Contrast: toggles HC on/off, returning to previous theme when toggling off.
  const handleContrastClick = useCallback(() => {
    if (resolved === "high-contrast") {
      setPreference(previousThemeRef.current);
    } else {
      setPreference("high-contrast");
    }
  }, [resolved, setPreference]);

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={handleThemeClick}
        className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={
          resolved === "light" ? "Switch to dark mode" : "Switch to light mode"
        }
      >
        {resolved === "light" ? <MoonIcon /> : <SunIcon />}
      </button>
      <button
        type="button"
        onClick={handleContrastClick}
        className={`rounded-md p-1.5 transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          resolved === "high-contrast" ? "text-ink" : "text-ink-muted"
        }`}
        aria-label="Toggle high contrast mode"
      >
        <ContrastIcon />
      </button>
    </div>
  );
}
