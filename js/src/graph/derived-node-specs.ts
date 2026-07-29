import type { PlanEntry } from "../types/plan-schema.ts";
import {
  buildPrefixedNodeId,
  extractResourceType,
  type PhantomKind,
} from "../utils/resource-key.ts";
import { extractStateField, parseThreePartName } from "./extract-resource-state.ts";

type DerivedRenderingConvention = "resource";

type DerivedNodeSpec = {
  readonly idPrefix: string;
  readonly badge: string;
  readonly renderingConvention: DerivedRenderingConvention;
  readonly promotesPhantomKind: PhantomKind | undefined;
  readonly sourceTypes: ReadonlySet<string>;
  readonly extractIdentity: (entry: PlanEntry) => string | undefined;
  readonly isValidIdentity: (identity: string) => boolean;
};

const createReadonlySet = (values: readonly string[]): ReadonlySet<string> => new Set(values);

export const DERIVED_NODE_SPECS = {
  ucSyncedTable: {
    idPrefix: "uc-synced-table::",
    badge: "synced table",
    renderingConvention: "resource",
    promotesPhantomKind: "sourceTable",
    sourceTypes: createReadonlySet(["postgres_synced_tables"]),
    extractIdentity: (entry) => extractStateField(entry, "synced_table_id"),
    isValidIdentity: (identity) => parseThreePartName(identity) !== undefined,
  },
} as const satisfies Readonly<Record<string, DerivedNodeSpec>>;

export type DerivedKind = keyof typeof DERIVED_NODE_SPECS;

export type DerivedNodeRef = {
  readonly derivedKind: DerivedKind;
  readonly identity: string;
};

const isDerivedKind = (value: string): value is DerivedKind =>
  Object.hasOwn(DERIVED_NODE_SPECS, value);

const DERIVED_KINDS: readonly DerivedKind[] = Object.keys(DERIVED_NODE_SPECS).filter(isDerivedKind);

export const DERIVED_SOURCE_TYPES: ReadonlySet<string> = createReadonlySet(
  DERIVED_KINDS.flatMap((kind) => [...DERIVED_NODE_SPECS[kind].sourceTypes]),
);

export const extractDerivedNodeRefs = (
  resourceKey: string,
  entry: PlanEntry,
): readonly DerivedNodeRef[] => {
  const resourceType = extractResourceType(resourceKey);
  if (resourceType === undefined) return [];

  return DERIVED_KINDS.flatMap((derivedKind) => {
    const spec = DERIVED_NODE_SPECS[derivedKind];
    if (!spec.sourceTypes.has(resourceType)) return [];
    const identity = spec.extractIdentity(entry);
    return identity !== undefined && spec.isValidIdentity(identity)
      ? [{ derivedKind, identity }]
      : [];
  });
};

export const buildDerivedNodeId = (derivedKind: DerivedKind, identity: string): string =>
  `${DERIVED_NODE_SPECS[derivedKind].idPrefix}${identity}`;

export const extractDerivedNodeBadge = (derivedKind: DerivedKind): string =>
  DERIVED_NODE_SPECS[derivedKind].badge;

export const extractPromotedPhantomKind = (derivedKind: DerivedKind): PhantomKind | undefined =>
  DERIVED_NODE_SPECS[derivedKind].promotesPhantomKind;

export const entryOwnsPromotedPhantomIdentity = (
  resourceKey: string,
  entry: PlanEntry,
  phantomKind: PhantomKind,
  identity: string,
): boolean =>
  extractDerivedNodeRefs(resourceKey, entry).some(
    (ref) =>
      ref.identity === identity && extractPromotedPhantomKind(ref.derivedKind) === phantomKind,
  );

export const resolvePromotedPhantomNodeId = (
  phantomKind: PhantomKind,
  identity: string,
  nodeIds: ReadonlySet<string>,
): string | undefined => {
  for (const derivedKind of DERIVED_KINDS) {
    if (extractPromotedPhantomKind(derivedKind) !== phantomKind) continue;
    const derivedId = buildDerivedNodeId(derivedKind, identity);
    if (nodeIds.has(derivedId)) return derivedId;
  }

  const phantomId = buildPrefixedNodeId(phantomKind, identity);
  return nodeIds.has(phantomId) ? phantomId : undefined;
};

export const extractDerivedRenderingConvention = (
  derivedKind: DerivedKind,
): DerivedRenderingConvention => DERIVED_NODE_SPECS[derivedKind].renderingConvention;
