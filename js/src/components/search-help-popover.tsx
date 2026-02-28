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
        className="text-xs text-ink-muted transition-colors hover:text-ink"
        aria-label="Search syntax help"
        aria-expanded={isOpen}
      >
        i
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
