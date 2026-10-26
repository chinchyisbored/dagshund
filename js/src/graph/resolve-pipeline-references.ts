import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import { extractPromotedPhantomKind } from "./derived-node-specs.ts";
import {
  extractStateField,
  parseThreePartName,
  resolveUcLeafParentIdentity,
} from "./extract-resource-state.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";

const extractRequiredHierarchySchemas = (
  context: ReferenceResolutionContext,
): ReadonlySet<string> => {
  const schemas = new Set<string>();
  for (const [resourceKey, entry] of context.entries) {
    const resourceType = extractResourceType(resourceKey);
    if (resourceType === "volumes" || resourceType === "registered_models") {
      const parent = resolveUcLeafParentIdentity({
        catalog: extractStateField(entry, "catalog_name"),
        schema: extractStateField(entry, "schema_name"),
        name: extractStateField(entry, "name"),
      });
      if (parent?.kind === "schema") schemas.add(parent.identity);
    }
    if (resourceType === "model_serving_endpoints") {
      const names = context.preparedPlan.byResourceKey.get(resourceKey)?.servedEntityNames;
      if (names?.status !== "supported") continue;
      for (const name of names.value) {
        const parsed = parseThreePartName(name);
        if (parsed !== undefined) schemas.add(`${parsed.catalog}.${parsed.schema}`);
      }
    }
  }
  return schemas;
};

export const resolvePipelineIngestionReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const prepared = context.preparedPlan.byResourceKey.get(sourceResourceKey);
  const resourceType = extractResourceType(sourceResourceKey);
  if (resourceType !== "pipelines") return [];
  {
    const schemas = prepared?.pipelineIngestionSchemas;
    if (schemas?.status === "supported") {
      const knownTableIdentities = [
        ...[...context.identityCatalog.nodeIdByAlias.keys()]
          .filter((alias) => alias.startsWith("sourceTable:"))
          .map((alias) => alias.slice("sourceTable:".length)),
        ...[...context.ownedDerivedRefs.values()].flatMap((refs) =>
          refs
            .filter((ref) => extractPromotedPhantomKind(ref.derivedKind) === "sourceTable")
            .map((ref) => ref.identity),
        ),
        ...[...context.preparedPlan.byResourceKey.values()].flatMap((resource) => [
          ...(resource.sourceTableFullName.status === "supported"
            ? [resource.sourceTableFullName.value]
            : []),
          ...(resource.qualityMonitorTableName.status === "supported"
            ? [resource.qualityMonitorTableName.value]
            : []),
          ...(resource.qualityMonitorBaselineTableName.status === "supported"
            ? [resource.qualityMonitorBaselineTableName.value]
            : []),
          ...(resource.vectorIndex.status === "supported"
            ? [resource.vectorIndex.value.sourceTable]
            : []),
          ...(resource.appResources?.status === "supported"
            ? resource.appResources.value.flatMap((ref) =>
                ref.kind === "uc_securable" && ref.securableType === "TABLE" ? [ref.fullName] : [],
              )
            : []),
        ]),
      ];
      const knownTableSchemas = new Set(
        knownTableIdentities.flatMap((identity) => {
          const parsed = parseThreePartName(identity);
          return parsed === undefined ? [] : [`${parsed.catalog}.${parsed.schema}`];
        }),
      );
      const requiredSchemas = new Set([
        ...knownTableSchemas,
        ...extractRequiredHierarchySchemas(context),
      ]);
      const ingestionReferences = schemas.value.flatMap<ReferenceResolution>((identity) => {
        const alias = `schemas:${identity}`;
        const targetNodeId = context.identityCatalog.nodeIdByAlias.get(alias);
        if (targetNodeId !== undefined) {
          return {
            kind: "resolved" as const,
            sourceResourceKey,
            targetNodeId,
            targetResourceKey: context.identityCatalog.resourceKeyByAlias.get(alias),
            provenance: "real" as const,
            direction: "entry-to-target" as const,
          };
        }
        if (!requiredSchemas.has(identity)) return [];
        const phantomId = buildPrefixedNodeId("schema", identity);
        return [
          {
            kind: "phantom",
            sourceResourceKey,
            targetNodeId: phantomId,
            resourceKey: phantomId,
            label: identity.split(".").at(-1) ?? identity,
            phantomKind: "schema",
            placement: { kind: "hierarchy", identity, tier: 1 },
            direction: "entry-to-target",
          },
        ];
      });
      return ingestionReferences;
    }
  }

  return [];
};
