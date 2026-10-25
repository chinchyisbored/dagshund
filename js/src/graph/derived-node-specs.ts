import type { PreparedResource } from "../types/prepared-plan.ts";
import type { ReferenceResolution } from "../types/reference-resolution.ts";
import {
  extractResourceName,
  extractResourceType,
  type PhantomKind,
} from "../utils/resource-key.ts";

import { parseThreePartName } from "./extract-resource-state.ts";

type DerivedRenderingConvention = "resource";

export type DerivedPlacement =
  | { readonly kind: "ucLeaf" }
  | { readonly kind: "workspace"; readonly resourceType: string };

type DerivedReferenceSpec = {
  readonly symbolicOutputPaths: readonly string[];
  readonly targetResourceType: string;
  readonly extractConcreteId: (prepared: PreparedResource) => string | undefined;
};

type DerivedNodeSpec = {
  readonly idPrefix: string;
  readonly badge: string;
  readonly renderingConvention: DerivedRenderingConvention;
  readonly placement: DerivedPlacement;
  readonly promotesPhantomKind: PhantomKind | undefined;
  readonly sourceTypes: ReadonlySet<string>;
  readonly reference: DerivedReferenceSpec | undefined;
  readonly extractIdentity: (resourceKey: string, prepared: PreparedResource) => string | undefined;
  readonly extractLabel: (resourceKey: string, identity: string) => string;
  readonly isValidIdentity: (identity: string) => boolean;
};

const createReadonlySet = (values: readonly string[]): ReadonlySet<string> => new Set(values);
const extractIdentityLabel = (_resourceKey: string, identity: string): string =>
  identity.split(".").at(-1) ?? identity;
export const DERIVED_NODE_SPECS = {
  pipelineEventLog: {
    idPrefix: "pipeline-event-log::",
    badge: "event log",
    renderingConvention: "resource",
    placement: { kind: "ucLeaf" },
    promotesPhantomKind: "sourceTable",
    sourceTypes: createReadonlySet(["pipelines"]),
    reference: undefined,
    extractIdentity: (_resourceKey, prepared) => {
      const projection = prepared.pipelineEventLog;
      return projection?.status === "supported"
        ? `${projection.value.catalog}.${projection.value.schema}.${projection.value.name}`
        : undefined;
    },
    extractLabel: extractIdentityLabel,
    isValidIdentity: (identity) => parseThreePartName(identity) !== undefined,
  },
  ucSyncedTable: {
    idPrefix: "uc-synced-table::",
    badge: "synced table",
    renderingConvention: "resource",
    placement: { kind: "ucLeaf" },
    promotesPhantomKind: "sourceTable",
    sourceTypes: createReadonlySet(["postgres_synced_tables"]),
    reference: undefined,
    extractIdentity: (_resourceKey, prepared) =>
      prepared.syncedTableId.status === "supported" ? prepared.syncedTableId.value : undefined,
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
      extractConcreteId: (prepared) =>
        prepared.pipelineOutputId.status === "supported"
          ? prepared.pipelineOutputId.value
          : undefined,
    },
    extractIdentity: (resourceKey, prepared) =>
      prepared.existingPipelineId.status === "absent"
        ? prepared.pipelineOutputId.status === "supported"
          ? prepared.pipelineOutputId.value
          : resourceKey
        : undefined,
    extractLabel: (resourceKey) => `${extractResourceName(resourceKey)} pipeline`,
    isValidIdentity: (identity) => identity !== "",
  },
} as const satisfies Readonly<Record<string, DerivedNodeSpec>>;

export type DerivedKind = keyof typeof DERIVED_NODE_SPECS;

export type DerivedNodeRef = {
  readonly derivedKind: DerivedKind;
  readonly identity: string;
};

export type OwnedDerivedNodeRefs = ReadonlyMap<string, readonly DerivedNodeRef[]>;

export const resolveDerivedOutputReferences = (
  sourceResourceKey: string,
  ownedDerivedRefs: readonly DerivedNodeRef[],
): readonly ReferenceResolution[] =>
  ownedDerivedRefs.map((ref) => ({
    kind: "resolved",
    sourceResourceKey,
    targetNodeId: buildDerivedNodeId(ref.derivedKind, ref.identity),
    provenance: "derived",
    direction: "target-to-entry",
  }));

export const collectOwnedDerivedNodeRefs = (
  preparedByResourceKey: ReadonlyMap<string, PreparedResource>,
): OwnedDerivedNodeRefs =>
  new Map(
    [...preparedByResourceKey].map(([resourceKey, prepared]) => [
      resourceKey,
      extractDerivedNodeRefs(resourceKey, prepared),
    ]),
  );

const isDerivedKind = (value: string): value is DerivedKind =>
  Object.hasOwn(DERIVED_NODE_SPECS, value);

const DERIVED_KINDS: readonly DerivedKind[] = Object.keys(DERIVED_NODE_SPECS).filter(isDerivedKind);

export const DERIVED_SOURCE_TYPES: ReadonlySet<string> = createReadonlySet(
  DERIVED_KINDS.flatMap((kind) => [...DERIVED_NODE_SPECS[kind].sourceTypes]),
);

export const extractDerivedNodeRefs = (
  resourceKey: string,
  prepared: PreparedResource,
): readonly DerivedNodeRef[] => {
  const resourceType = extractResourceType(resourceKey);
  if (resourceType === undefined) return [];

  return DERIVED_KINDS.flatMap((derivedKind) => {
    const spec: DerivedNodeSpec = DERIVED_NODE_SPECS[derivedKind];
    if (!spec.sourceTypes.has(resourceType)) return [];
    const identity = spec.extractIdentity(resourceKey, prepared);
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

export const ownedRefsContainPromotedPhantomIdentity = (
  ownedRefs: readonly DerivedNodeRef[],
  phantomKind: PhantomKind,
  identity: string,
): boolean =>
  ownedRefs.some(
    (ref) =>
      ref.identity === identity && extractPromotedPhantomKind(ref.derivedKind) === phantomKind,
  );

export const extractDerivedRenderingConvention = (
  derivedKind: DerivedKind,
): DerivedRenderingConvention => DERIVED_NODE_SPECS[derivedKind].renderingConvention;

const buildDerivedReferencePairs = (
  resourceKey: string,
  targetResourceType: string,
  prepared: PreparedResource,
  ownedRefs: readonly DerivedNodeRef[],
): readonly (readonly [string, string])[] =>
  ownedRefs.flatMap((ref) => {
    const spec: DerivedNodeSpec = DERIVED_NODE_SPECS[ref.derivedKind];
    if (spec.reference?.targetResourceType !== targetResourceType) return [];
    const nodeId = buildDerivedNodeId(ref.derivedKind, ref.identity);
    const symbolicPairs = spec.reference.symbolicOutputPaths.map(
      (outputPath): readonly [string, string] => [`\${${resourceKey}.${outputPath}}`, nodeId],
    );
    const concreteId = spec.reference.extractConcreteId(prepared);
    return concreteId !== undefined ? [[concreteId, nodeId], ...symbolicPairs] : symbolicPairs;
  });

export const buildDerivedReferenceIndex = (
  targetResourceType: string,
  ownedDerivedRefs: OwnedDerivedNodeRefs,
  preparedByResourceKey: ReadonlyMap<string, PreparedResource>,
): ReadonlyMap<string, string> =>
  new Map(
    [...ownedDerivedRefs].flatMap(([resourceKey, ownedRefs]) => {
      const prepared = preparedByResourceKey.get(resourceKey);
      return prepared === undefined
        ? []
        : buildDerivedReferencePairs(resourceKey, targetResourceType, prepared, ownedRefs);
    }),
  );
