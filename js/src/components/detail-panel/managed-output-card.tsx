import type { DagNodeData } from "../../types/graph-types.ts";
import { extractResourceName, extractTypeBadge } from "../../utils/resource-key.ts";

type DerivedNodeData = Extract<DagNodeData, { nodeKind: "derived" }>;

type ManagedOutputCardProps = {
  readonly data: DerivedNodeData;
  readonly onNavigateToOwner?: (nodeId: string) => void;
};

export function ManagedOutputCard({ data, onNavigateToOwner }: ManagedOutputCardProps) {
  const ownerType = extractTypeBadge(data.ownerResourceKey) ?? "resource";
  const ownerLabel = extractResourceName(data.ownerResourceKey);

  return (
    <div className="mb-3 rounded border border-outline/60 bg-surface-inset/40 px-3 py-2 text-xs text-ink-muted">
      <p>Managed output of:</p>
      {onNavigateToOwner !== undefined ? (
        <button
          type="button"
          onClick={() => onNavigateToOwner(data.ownerResourceKey)}
          className="mt-1 flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-[11px] text-ink-secondary transition-colors hover:bg-surface-hover"
          title={data.ownerResourceKey}
        >
          <span className="truncate">
            {ownerLabel} <span className="font-sans text-ink-muted/60">({ownerType})</span>
          </span>
          <span aria-hidden="true">&rarr;</span>
        </button>
      ) : (
        <p className="mt-1 truncate pl-2 font-mono text-[11px] text-ink-secondary">
          {ownerLabel} <span className="font-sans text-ink-muted/60">({ownerType})</span>
        </p>
      )}
    </div>
  );
}
