import { useCallback, useEffect, useRef, useState } from "react";
import type { Provenance } from "../types/provenance-schema.ts";

const PANEL_ID = "dagshund-provenance-panel";
const HEADING_ID = "dagshund-provenance-heading";
const DESCRIPTION_ID = "dagshund-provenance-description";
const UNKNOWN = "unknown";

type ProvenancePanelProps = {
  readonly provenance?: Provenance | null;
};

const InfoIcon = () => (
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
);

const CloseIcon = () => (
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
    aria-hidden="true"
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const valueOrUnknown = (value: string | null | undefined): string => value ?? UNKNOWN;

export function ProvenancePanel({ provenance }: ProvenancePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  const handleToggle = useCallback(() => {
    if (isOpen) {
      close();
      return;
    }
    setIsOpen(true);
  }, [close, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();

    const handleClickOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target))
        return;
      close();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [close, isOpen]);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title="Show provenance information"
        aria-label="Show provenance information"
        aria-expanded={isOpen}
        aria-controls={PANEL_ID}
        aria-haspopup="dialog"
        className={`rounded-md p-1.5 transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          isOpen ? "text-ink" : "text-ink-muted"
        }`}
      >
        <InfoIcon />
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          id={PANEL_ID}
          role="dialog"
          aria-modal="false"
          aria-labelledby={HEADING_ID}
          aria-describedby={DESCRIPTION_ID}
          tabIndex={-1}
          className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1rem)] rounded-md border border-outline bg-surface-raised p-3 text-xs text-ink shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={HEADING_ID} className="font-semibold text-ink">
                HTML provenance
              </h2>
              <p id={DESCRIPTION_ID} className="mt-1 text-ink-muted">
                This self-contained HTML artifact includes provenance for the exact source plan
                consumed by Dagshund.
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={close}
              title="Close provenance information"
              aria-label="Close provenance information"
              className="shrink-0 rounded p-0.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <CloseIcon />
            </button>
          </div>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-ink-muted">Source plan</dt>
              <dd className="mt-0.5 break-words text-ink">
                {valueOrUnknown(provenance?.source_name)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Last modified</dt>
              <dd className="mt-0.5 break-words text-ink">
                {valueOrUnknown(provenance?.source_modified_at)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Source plan SHA-256</dt>
              <dd className="mt-0.5 break-all font-mono text-ink">
                {valueOrUnknown(provenance?.source_plan_sha256)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Dagshund version</dt>
              <dd className="mt-0.5 break-words text-ink">
                {valueOrUnknown(provenance?.dagshund_version)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Databricks CLI version (plan metadata)</dt>
              <dd className="mt-0.5 break-words text-ink">
                {valueOrUnknown(provenance?.plan_cli_version)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
