import type { Projection } from "../types/prepared-plan.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";

export type AiGatewayReferences = Readonly<{
  destinations: readonly Readonly<{ type: string; target: string }>[];
  connection: string | undefined;
  serviceCredential: string | undefined;
}>;

const unsupported = (resourceKey: string) => ({
  status: "unsupported" as const,
  diagnostic: {
    resourceKey,
    capability: "ai-gateway-references" as const,
    reason: "invalid-shape" as const,
  },
});

const readServiceCredential = (
  resourceKey: string,
  config: unknown,
): Projection<string | undefined> => {
  if (config === undefined) return { status: "supported", value: undefined };
  if (!isUnknownRecord(config)) return unsupported(resourceKey);
  const arms = [
    ["amazon_bedrock", "service_credential"],
    ["azure_openai", "service_credential"],
    ["microsoft_foundry", "service_credential"],
  ] as const;
  const references = arms.flatMap(([provider, field]) => {
    const arm = config[provider];
    if (arm === undefined) return [];
    if (!isUnknownRecord(arm)) return [undefined];
    const direct = arm["direct"];
    if (direct === undefined) return [];
    if (!isUnknownRecord(direct)) return [undefined];
    const credential = direct[field];
    if (credential === undefined) return [];
    if (!isUnknownRecord(credential) || typeof credential["name"] !== "string") return [undefined];
    return [credential["name"]];
  });
  if (references.some((reference) => reference === undefined)) return unsupported(resourceKey);
  const names = [...new Set(references)];
  if (names.length > 1) return unsupported(resourceKey);
  return { status: "supported", value: names[0] };
};

/** Project only route, explicit MCP connection and schema-backed credential identities. */
export const prepareAiGatewayReferences = (
  resourceKey: string,
  state: Readonly<Record<string, unknown>> | undefined,
): Projection<AiGatewayReferences> => {
  const type = extractResourceType(resourceKey);
  if (type !== "model_services" && type !== "mcp_services" && type !== "model_provider_services")
    return { status: "absent" };
  if (state === undefined) return { status: "absent" };
  const config = state["config"];
  const serviceCredential = readServiceCredential(resourceKey, config);
  if (serviceCredential.status !== "supported") return serviceCredential;
  if (type === "model_provider_services")
    return {
      status: "supported",
      value: {
        destinations: [],
        connection: undefined,
        serviceCredential: serviceCredential.value,
      },
    };
  if (type === "mcp_services") {
    if (config === undefined)
      return {
        status: "supported",
        value: { destinations: [], connection: undefined, serviceCredential: undefined },
      };
    if (!isUnknownRecord(config)) return unsupported(resourceKey);
    const source = config["source_connection"];
    if (source === undefined)
      return {
        status: "supported",
        value: { destinations: [], connection: undefined, serviceCredential: undefined },
      };
    const name = isUnknownRecord(source) ? source["name"] : undefined;
    if (typeof name !== "string") return unsupported(resourceKey);
    return {
      status: "supported",
      value: { destinations: [], connection: name, serviceCredential: undefined },
    };
  }
  if (config === undefined)
    return {
      status: "supported",
      value: { destinations: [], connection: undefined, serviceCredential: undefined },
    };
  if (!isUnknownRecord(config)) return unsupported(resourceKey);
  const routing = config["routing"];
  if (routing === undefined)
    return {
      status: "supported",
      value: { destinations: [], connection: undefined, serviceCredential: undefined },
    };
  if (!isUnknownRecord(routing)) return unsupported(resourceKey);
  const fallback = routing["fallback"];
  if (fallback !== undefined && !isUnknownRecord(fallback)) return unsupported(resourceKey);
  const primary = routing["destinations"];
  const secondary = isUnknownRecord(fallback) ? fallback["destinations"] : undefined;
  if (
    (primary !== undefined && !Array.isArray(primary)) ||
    (secondary !== undefined && !Array.isArray(secondary))
  )
    return unsupported(resourceKey);
  const destinations: { type: string; target: string }[] = [];
  for (const item of [
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(secondary) ? secondary : []),
  ]) {
    if (!isUnknownRecord(item) || typeof item["destination_type"] !== "string")
      return unsupported(resourceKey);
    const kind = item["destination_type"];
    const configKey =
      kind === "DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL"
        ? "external_model_config"
        : kind === "DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL"
          ? "pay_per_token_config"
          : kind === "DESTINATION_TYPE_PROVISIONED_THROUGHPUT_FOUNDATION_MODEL"
            ? "provisioned_throughput_config"
            : undefined;
    if (configKey === undefined) continue;
    const field =
      kind === "DESTINATION_TYPE_EXTERNAL_FOUNDATION_MODEL"
        ? "model_provider_service"
        : kind === "DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL"
          ? "model"
          : "model_serving_endpoint";
    const details = item[configKey];
    const target = isUnknownRecord(details) ? details[field] : undefined;
    if (typeof target !== "string") return unsupported(resourceKey);
    destinations.push({ type: kind, target });
  }
  return {
    status: "supported",
    value: { destinations, connection: undefined, serviceCredential: undefined },
  };
};
