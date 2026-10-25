import { z } from "zod/v4";
import type { PreparationDiagnostic, Projection } from "../types/prepared-plan.ts";

const servedEntitySchema = z
  .record(z.string(), z.unknown())
  .refine(
    (entity) => entity["entity_name"] === undefined || typeof entity["entity_name"] === "string",
  )
  .readonly();
const servedEntitiesSchema = z.array(servedEntitySchema).readonly();
const recordSchema = z.record(z.string(), z.unknown()).readonly();

type ServingProjection = {
  readonly names: Projection<readonly string[]>;
  readonly diagnostic: PreparationDiagnostic | undefined;
};

const unsupported = (resourceKey: string): ServingProjection => {
  const diagnostic: PreparationDiagnostic = {
    resourceKey,
    capability: "serving-endpoint-models",
    reason: "invalid-shape",
  };
  return { names: { status: "unsupported", diagnostic }, diagnostic };
};

/** Validate only the serving endpoint fields consumed by model references. */
export const prepareServingEndpoint = (
  resourceKey: string,
  state: Readonly<Record<string, unknown>> | undefined,
): ServingProjection => {
  if (state === undefined) return { names: { status: "absent" }, diagnostic: undefined };
  const hasConfig = Object.hasOwn(state, "config");
  const config = hasConfig ? recordSchema.safeParse(state["config"]) : undefined;
  if (config !== undefined && !config.success) return unsupported(resourceKey);
  const hasConfigEntities = config?.success && Object.hasOwn(config.data, "served_entities");
  let selected = hasConfigEntities ? config.data["served_entities"] : undefined;
  if (!hasConfigEntities) {
    const hasEndpointDetails = Object.hasOwn(state, "endpoint_details");
    const endpointDetails = hasEndpointDetails
      ? recordSchema.safeParse(state["endpoint_details"])
      : undefined;
    if (endpointDetails !== undefined && !endpointDetails.success) return unsupported(resourceKey);
    const hasEndpointConfig =
      endpointDetails?.success && Object.hasOwn(endpointDetails.data, "config");
    const endpointConfig = hasEndpointConfig
      ? recordSchema.safeParse(endpointDetails.data["config"])
      : undefined;
    if (endpointConfig !== undefined && !endpointConfig.success) return unsupported(resourceKey);
    const hasEndpointEntities =
      endpointConfig?.success && Object.hasOwn(endpointConfig.data, "served_entities");
    selected = hasEndpointEntities ? endpointConfig.data["served_entities"] : undefined;
  }
  if (selected === undefined) {
    return { names: { status: "absent" }, diagnostic: undefined };
  }
  const parsed = servedEntitiesSchema.safeParse(selected);
  if (!parsed.success) return unsupported(resourceKey);
  return {
    names: {
      status: "supported",
      value: parsed.data.flatMap((entity) =>
        typeof entity["entity_name"] === "string" ? [entity["entity_name"]] : [],
      ),
    },
    diagnostic: undefined,
  };
};
