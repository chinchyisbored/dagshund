import { useCallback, useEffect, useRef, useState } from "react";
import { SearchHelpPopover } from "./search-help-popover.tsx";

const DEBOUNCE_MS = 300;

type SearchBarProps = {
  readonly onSearch: (query: string) => void;
  readonly matchCount: number;
};

export function SearchBar({ onSearch, matchCount }: SearchBarProps) {
  const [rawInput, setRawInput] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearSearch = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setRawInput("");
    onSearch("");
  }, [onSearch]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setRawInput(value);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onSearch(value.trim().toLowerCase());
        timerRef.current = null;
      }, DEBOUNCE_MS);
    },
    [onSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        clearSearch();
        inputRef.current?.blur();
      }
    },
    [clearSearch],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      if (!(e.target instanceof Element)) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // offsetParent is null for elements inside display:none (e.g. hidden tab).
      if (inputRef.current === null || inputRef.current.offsetParent === null) return;
      e.preventDefault();
      inputRef.current.focus();
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const hasQuery = rawInput.length > 0;

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative flex-1">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={rawInput}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search…"
          aria-label="Search nodes"
          className="h-7 w-full rounded-md border border-outline bg-surface-raised pl-7 pr-7 text-xs text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {hasQuery && (
          <button
            type="button"
            onClick={clearSearch}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-muted transition-colors hover:text-ink"
            aria-label="Clear search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <span className="text-xs text-ink-muted" aria-live="polite">
        {hasQuery ? `${matchCount} ${matchCount === 1 ? "match" : "matches"}` : ""}
      </span>
      <SearchHelpPopover />
    </div>
  );
}
