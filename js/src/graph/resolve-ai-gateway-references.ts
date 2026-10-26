import type { PlanEntry } from "../types/plan-schema.ts";
import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId, extractResourceType } from "../utils/resource-key.ts";
import { extractStateField } from "./extract-resource-state.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { resolveExternalConnectionReference } from "./resolve-external-connection.ts";

const schemaIdentity = (parent: string | undefined): string | undefined => {
  const match = parent?.match(/^schemas\/([^.]+)\.([^.]+)$/);
  return match === null || match === undefined ? undefined : `${match[1]}.${match[2]}`;
};

const providerIdentity = (entry: PlanEntry): string | undefined => {
  const parent = schemaIdentity(extractStateField(entry, "parent"));
  const id = extractStateField(entry, "model_provider_service_id");
  return parent !== undefined && id !== undefined ? `${parent}.${id}` : undefined;
};

const resolveProvider = (
  sourceResourceKey: string,
  reference: string,
  context: ReferenceResolutionContext,
): ReferenceResolution[] => {
  const match = reference.match(/^model-provider-services\/([^.]+)\.([^.]+)\.([^.]+)$/);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined)
    return [];
  const identity = `${match[1]}.${match[2]}.${match[3]}`;
  const entry = context.entries.find(
    ([key, value]) =>
      extractResourceType(key) === "model_provider_services" &&
      providerIdentity(value) === identity,
  );
  const targetKey = entry?.[0];
  const nodeId =
    targetKey === undefined
      ? undefined
      : context.identityCatalog.nodeIdByResourceKey.get(targetKey);
  if (targetKey !== undefined && nodeId !== undefined)
    return [
      {
        kind: "resolved",
        sourceResourceKey,
        targetNodeId: nodeId,
        targetResourceKey: targetKey,
        provenance: "real",
        direction: "entry-to-target",
      },
    ];
  const phantomId = buildPrefixedNodeId("modelProviderService", identity);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: phantomId,
      resourceKey: phantomId,
      label: match[3],
      phantomKind: "modelProviderService",
      placement: { kind: "hierarchy", identity, tier: 2 },
      direction: "entry-to-target",
    },
  ];
};

const resolveRegisteredModel = (
  sourceResourceKey: string,
  reference: string,
  context: ReferenceResolutionContext,
): ReferenceResolution[] => {
  const match = reference.match(/^models\/([^.]+)\.([^.]+)\.([^.]+)$/);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined)
    return [];
  const identity = `${match[1]}.${match[2]}.${match[3]}`;
  const entry = context.entries.find(
    ([key, value]) =>
      extractResourceType(key) === "registered_models" &&
      (extractStateField(value, "full_name") === identity ||
        extractStateField(value, "name") === identity ||
        `${extractStateField(value, "catalog_name")}.${extractStateField(value, "schema_name")}.${extractStateField(value, "name")}` ===
          identity),
  );
  const targetKey = entry?.[0];
  const nodeId =
    targetKey === undefined
      ? undefined
      : context.identityCatalog.nodeIdByResourceKey.get(targetKey);
  if (targetKey !== undefined && nodeId !== undefined)
    return [
      {
        kind: "resolved",
        sourceResourceKey,
        targetNodeId: nodeId,
        targetResourceKey: targetKey,
        provenance: "real",
        direction: "entry-to-target",
      },
    ];
  const phantomId = buildPrefixedNodeId("registeredModel", identity);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: phantomId,
      resourceKey: phantomId,
      label: match[3],
      phantomKind: "registeredModel",
      placement: { kind: "hierarchy", identity, tier: 2 },
      direction: "entry-to-target",
    },
  ];
};

const resolveServingEndpoint = (
  sourceResourceKey: string,
  reference: string,
  context: ReferenceResolutionContext,
): ReferenceResolution[] => {
  const match = reference.match(/^serving-endpoints\/(.+)$/);
  if (match === null || match[1] === undefined) return [];
  const apiName = match[1];
  const entry = context.entries.find(
    ([key, value]) =>
      extractResourceType(key) === "model_serving_endpoints" &&
      extractStateField(value, "name") === apiName,
  );
  const targetKey = entry?.[0];
  const nodeId =
    targetKey === undefined
      ? undefined
      : context.identityCatalog.nodeIdByResourceKey.get(targetKey);
  if (targetKey !== undefined && nodeId !== undefined)
    return [
      {
        kind: "resolved",
        sourceResourceKey,
        targetNodeId: nodeId,
        targetResourceKey: targetKey,
        provenance: "real",
        direction: "entry-to-target",
      },
    ];
  const phantomId = buildPrefixedNodeId("servingEndpoint", apiName);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: phantomId,
      resourceKey: phantomId,
      label: apiName,
      phantomKind: "servingEndpoint",
      placement: { kind: "workspace-resource", resourceType: "model_serving_endpoints" },
      direction: "entry-to-target",
    },
  ];
};

const resolveServiceCredential = (
  sourceResourceKey: string,
  reference: string,
): ReferenceResolution[] => {
  const match = reference.match(/^credentials\/([^/]+)$/);
  if (match === null || match[1] === undefined) return [];
  const identity = match[1];
  const nodeId = buildPrefixedNodeId("serviceCredential", identity);
  return [
    {
      kind: "phantom",
      sourceResourceKey,
      targetNodeId: nodeId,
      resourceKey: nodeId,
      label: match[1],
      phantomKind: "serviceCredential",
      placement: { kind: "uc-root" },
      direction: "entry-to-target",
    },
  ];
};

export const resolveAiGatewayReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  const prepared = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.aiGatewayReferences;
  if (prepared?.status !== "supported") return [];
  const references: ReferenceResolution[] = [];
  if (
    extractResourceType(sourceResourceKey) === "mcp_services" &&
    prepared.value.connection !== undefined
  ) {
    const connection = resolveExternalConnectionReference(
      sourceResourceKey,
      prepared.value.connection,
    );
    if (connection !== undefined) references.push(connection);
  }
  if (
    extractResourceType(sourceResourceKey) === "model_provider_services" &&
    prepared.value.serviceCredential !== undefined
  )
    references.push(
      ...resolveServiceCredential(sourceResourceKey, prepared.value.serviceCredential),
    );
  for (const destination of prepared.value.destinations) {
    if (destination.type === "DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL")
      references.push(...resolveProvider(sourceResourceKey, destination.target, context));
    else if (destination.type === "DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL")
      references.push(...resolveRegisteredModel(sourceResourceKey, destination.target, context));
    else if (destination.type === "DESTINATION_TYPE_PROVISIONED_THROUGHPUT_FOUNDATION_MODEL")
      references.push(...resolveServingEndpoint(sourceResourceKey, destination.target, context));
  }
  return references;
};
