import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { buildPrefixedNodeId } from "../utils/resource-key.ts";

/** Resolve only the source-backed MCP connection form, independently of app name grammar. */
export const resolveExternalConnectionReference = (
  sourceResourceKey: string,
  reference: string,
): ReferenceResolution | undefined => {
  const [collection, fullName, ...rest] = reference.split("/");
  const [catalog, schema, connection, ...extra] = (fullName ?? "").split(".");
  if (
    collection !== "connections" ||
    rest.length > 0 ||
    extra.length > 0 ||
    catalog === undefined ||
    schema === undefined ||
    connection === undefined ||
    catalog.length === 0 ||
    schema.length === 0 ||
    connection.length === 0
  )
    return undefined;
  const identity = `${catalog}.${schema}.${connection}`;
  const nodeId = buildPrefixedNodeId("externalConnection", identity);
  return {
    kind: "phantom",
    sourceResourceKey,
    targetNodeId: nodeId,
    resourceKey: nodeId,
    label: connection,
    phantomKind: "externalConnection",
    placement: { kind: "hierarchy", identity, tier: 2 },
    direction: "entry-to-target",
  };
};
