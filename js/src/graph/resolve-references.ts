import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { resolveDerivedOutputReferences } from "./derived-node-specs.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { resolveAiGatewayReferences } from "./resolve-ai-gateway-references.ts";
import { resolveAppReferences } from "./resolve-app-references.ts";
import { resolveConventionalReference } from "./resolve-conventional-references.ts";
import { resolveExternalLocationReferences } from "./resolve-external-location-references.ts";
import { resolveJobTriggerReferences } from "./resolve-job-trigger-references.ts";
import {
  resolveDatabaseInstanceReference,
  resolveExistingPipelineReference,
} from "./resolve-lakebase-references.ts";
import { resolvePipelineIngestionReferences } from "./resolve-pipeline-references.ts";
import { resolvePostgresReferences } from "./resolve-postgres-references.ts";
import { buildFinalRunJobTargets } from "./resolve-run-job-target.ts";
import { resolveServingModelReferences } from "./resolve-serving-references.ts";
import { resolvePreparedTaskReferences } from "./resolve-task-references.ts";
import { resolveSourceTableReference } from "./resolve-uc-table-references.ts";
import {
  resolveInstancePoolReferences,
  resolveVectorEndpointReference,
} from "./resolve-workspace-references.ts";

export const resolveReferences = (
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const jobEntries = context.entries.filter(
    ([resourceKey]) => extractResourceType(resourceKey) === "jobs",
  );
  const finalRunJobTargets = buildFinalRunJobTargets(
    jobEntries,
    context.preparedPlan,
    context.indexes.jobIdMap,
  );
  return context.entries.flatMap(([sourceResourceKey]) => [
    resolveConventionalReference(sourceResourceKey, context),
    ...resolvePostgresReferences(sourceResourceKey, context),
    ...resolveSourceTableReference(sourceResourceKey, context),
    ...resolveDerivedOutputReferences(
      sourceResourceKey,
      context.ownedDerivedRefs.get(sourceResourceKey) ?? [],
    ),
    ...resolvePipelineIngestionReferences(sourceResourceKey, context),
    ...resolveServingModelReferences(sourceResourceKey, context),
    ...resolveAiGatewayReferences(sourceResourceKey, context),
    ...resolveAppReferences(sourceResourceKey, context),
    ...resolveExternalLocationReferences(sourceResourceKey, context),
    ...resolveJobTriggerReferences(sourceResourceKey, context),
    ...resolvePreparedTaskReferences(sourceResourceKey, context, finalRunJobTargets),
    ...resolveDatabaseInstanceReference(sourceResourceKey, context),
    ...resolveExistingPipelineReference(sourceResourceKey, context),
    ...resolveInstancePoolReferences(sourceResourceKey, context),
    ...resolveVectorEndpointReference(sourceResourceKey, context),
  ]);
};
