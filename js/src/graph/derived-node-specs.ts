import type { PlanEntry } from "../types/plan-schema.ts";
import {
  buildPrefixedNodeId,
  extractResourceName,
  extractResourceType,
  type PhantomKind,
} from "../utils/resource-key.ts";
import { getUnknownProp } from "../utils/unknown-record.ts";
import { extractStateField, parseThreePartName } from "./extract-resource-state.ts";

type DerivedRenderingConvention = "resource";

export type DerivedPlacement =
  | { readonly kind: "ucLeaf" }
  | { readonly kind: "workspace"; readonly resourceType: string };

type DerivedReferenceSpec = {
  readonly symbolicOutputPaths: readonly string[];
  readonly targetResourceType: string;
  readonly extractConcreteId: (entry: PlanEntry) => string | undefined;
};

type DerivedNodeSpec = {
  readonly idPrefix: string;
  readonly badge: string;
  readonly renderingConvention: DerivedRenderingConvention;
  readonly placement: DerivedPlacement;
  readonly promotesPhantomKind: PhantomKind | undefined;
  readonly sourceTypes: ReadonlySet<string>;
  readonly reference: DerivedReferenceSpec | undefined;
  readonly extractIdentity: (resourceKey: string, entry: PlanEntry) => string | undefined;
  readonly extractLabel: (resourceKey: string, identity: string) => string;
  readonly isValidIdentity: (identity: string) => boolean;
};

const createReadonlySet = (values: readonly string[]): ReadonlySet<string> => new Set(values);
const extractIdentityLabel = (_resourceKey: string, identity: string): string =>
  identity.split(".").at(-1) ?? identity;
const normalizeConcreteOutputId = (outputId: unknown): string | undefined => {
  if (typeof outputId !== "string") return undefined;
  const normalizedId = outputId.trim();
  return normalizedId !== "" && !normalizedId.startsWith("${") ? normalizedId : undefined;
};

const extractPipelineIdFromState = (state: unknown): string | undefined =>
  normalizeConcreteOutputId(getUnknownProp(state, "pipeline_id")) ??
  normalizeConcreteOutputId(getUnknownProp(getUnknownProp(state, "status"), "pipeline_id"));

const extractPipelineOutputId = (entry: PlanEntry): string | undefined =>
  extractPipelineIdFromState(getUnknownProp(entry.new_state, "value")) ??
  extractPipelineIdFromState(entry.remote_state);

export const DERIVED_NODE_SPECS = {
  ucSyncedTable: {
    idPrefix: "uc-synced-table::",
    badge: "synced table",
    renderingConvention: "resource",
    placement: { kind: "ucLeaf" },
    promotesPhantomKind: "sourceTable",
    sourceTypes: createReadonlySet(["postgres_synced_tables"]),
    reference: undefined,
    extractIdentity: (_resourceKey, entry) => extractStateField(entry, "synced_table_id"),
    extractLabel: extractIdentityLabel,
    isValidIdentity: (identity) => parseThreePartName(identity) !== undefined,
  },
  postgresSyncedTablePipeline: {
    idPrefix: "postgres-synced-pipeline::",
    badge: "pipeline",
    renderingConvention: "resource",
    placement: { kind: "workspace", resourceType: "pipelines" },
    promotesPhantomKind: undefined,
    sourceTypes: createReadonlySet(["postgres_synced_tables"]),
    reference: {
      symbolicOutputPaths: ["pipeline_id", "status.pipeline_id"],
      targetResourceType: "pipelines",
      extractConcreteId: extractPipelineOutputId,
    },
    extractIdentity: (resourceKey, entry) => extractPipelineOutputId(entry) ?? resourceKey,
    extractLabel: (resourceKey) => `${extractResourceName(resourceKey)} pipeline`,
    isValidIdentity: (identity) => identity !== "",
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
    const spec: DerivedNodeSpec = DERIVED_NODE_SPECS[derivedKind];
    if (!spec.sourceTypes.has(resourceType)) return [];
    const identity = spec.extractIdentity(resourceKey, entry);
    return identity !== undefined && spec.isValidIdentity(identity)
      ? [{ derivedKind, identity }]
      : [];
  });
};

export const buildDerivedNodeId = (derivedKind: DerivedKind, identity: string): string =>
  `${DERIVED_NODE_SPECS[derivedKind].idPrefix}${identity}`;

export const extractDerivedNodeBadge = (derivedKind: DerivedKind): string =>
  DERIVED_NODE_SPECS[derivedKind].badge;

export const extractDerivedNodeLabel = (
  derivedKind: DerivedKind,
  resourceKey: string,
  identity: string,
): string => DERIVED_NODE_SPECS[derivedKind].extractLabel(resourceKey, identity);

export const extractDerivedPlacement = (derivedKind: DerivedKind): DerivedPlacement =>
  DERIVED_NODE_SPECS[derivedKind].placement;

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

const buildDerivedReferencePairs = (
  resourceKey: string,
  entry: PlanEntry,
  targetResourceType: string,
): readonly (readonly [string, string])[] =>
  extractDerivedNodeRefs(resourceKey, entry).flatMap((ref) => {
    const spec: DerivedNodeSpec = DERIVED_NODE_SPECS[ref.derivedKind];
    if (spec.reference?.targetResourceType !== targetResourceType) return [];
    const nodeId = buildDerivedNodeId(ref.derivedKind, ref.identity);
    const symbolicPairs = spec.reference.symbolicOutputPaths.map(
      (outputPath): readonly [string, string] => [`\${${resourceKey}.${outputPath}}`, nodeId],
    );
    const concreteId = spec.reference.extractConcreteId(entry);
    return concreteId !== undefined ? [[concreteId, nodeId], ...symbolicPairs] : symbolicPairs;
  });

export const buildDerivedReferenceIndex = (
  entries: readonly (readonly [string, PlanEntry])[],
  targetResourceType: string,
): ReadonlyMap<string, string> =>
  new Map(
    entries.flatMap(([resourceKey, entry]) =>
      buildDerivedReferencePairs(resourceKey, entry, targetResourceType),
    ),
  );
