import { useCallback, useEffect, useRef, useState } from "react";

const SYNTAX_LINES = [
  ["word", "fuzzy name match"],
  ['"phrase"', "exact name match"],
  ["type:job", "filter by resource type"],
  ["status:added", "filter by diff state"],
] as const;

const EXAMPLE = "type:pipeline status:added ingest";

export function SearchHelpPopover() {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (popoverRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [isOpen]);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="Search syntax help"
        className={`rounded-md p-1.5 transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          isOpen ? "text-ink" : "text-ink-muted"
        }`}
        aria-label="Search syntax help"
        aria-expanded={isOpen}
      >
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
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="false"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-outline bg-surface-raised p-3 text-xs text-ink shadow-lg"
        >
          <table className="w-full">
            <tbody>
              {SYNTAX_LINES.map(([syntax, desc]) => (
                <tr key={syntax}>
                  <td className="pr-3 font-mono text-accent">{syntax}</td>
                  <td className="text-ink-muted">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 border-t border-outline pt-2 text-ink-muted">
            <div>Combine with spaces (AND):</div>
            <div className="mt-0.5 font-mono text-accent">{EXAMPLE}</div>
          </div>
        </div>
      )}
    </div>
  );
}
