import { useCallback, useEffect, useId, useRef } from "react";
import { CopyButton } from "./copy-button.tsx";
import { CloseIcon } from "./json-block-icons.tsx";

type JsonExpandModalProps = {
  readonly title: string;
  readonly json: string;
  readonly onClose: () => void;
};

/** Trap Tab/Shift+Tab within the modal panel. */
function useFocusTrap(panelRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    panel.addEventListener("keydown", handleTab);
    return () => panel.removeEventListener("keydown", handleTab);
  }, [panelRef]);
}

export function JsonExpandModal({ title, json, onClose }: JsonExpandModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const getJson = useCallback(() => json, [json]);

  useFocusTrap(panelRef);

  // Focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape key — capture phase so it fires before the detail panel's bubble-phase handler
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [onClose]);

  // Click outside — close only when clicking the backdrop itself
  const handleBackdropMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  // Scroll lock
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss supplements Escape and close button
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-[90vw] max-w-5xl flex-col rounded-lg border border-outline bg-surface-raised shadow-md"
      >
        <div className="flex items-center gap-2 border-b border-outline-subtle px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate font-mono text-sm text-ink-secondary">
            {title}
          </h2>
          <CopyButton getText={getJson} label="Copy JSON to clipboard" />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="font-mono text-xs text-ink-muted">{json}</pre>
        </div>
      </div>
    </div>
  );
}
