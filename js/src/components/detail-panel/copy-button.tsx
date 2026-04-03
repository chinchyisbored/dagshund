import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, ClipboardIcon } from "./json-block-icons.tsx";

type CopyButtonProps = {
  readonly getText: () => string;
  readonly className?: string;
  readonly label?: string;
};

const FEEDBACK_DURATION_MS = 1500;

export function CopyButton({
  getText,
  className = "rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  label = "Copy to clipboard",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(getText()).then(() => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      setCopied(true);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = undefined;
      }, FEEDBACK_DURATION_MS);
    }, console.warn);
  }, [getText]);

  return (
    <button type="button" onClick={handleClick} className={className} aria-label={label}>
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-diff-added" /> : <ClipboardIcon />}
    </button>
  );
}
