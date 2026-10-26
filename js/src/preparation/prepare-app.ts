import type { PreparationDiagnostic, Projection } from "../types/prepared-plan.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";

export type AppResourceRef =
  | { readonly kind: "job"; readonly id: string }
  | { readonly kind: "sql_warehouse"; readonly id: string }
  | { readonly kind: "genie_space"; readonly id: string; readonly name: string }
  | { readonly kind: "secret_scope"; readonly name: string }
  | { readonly kind: "serving_endpoint"; readonly name: string }
  | { readonly kind: "experiment"; readonly id: string }
  | {
      readonly kind: "uc_securable";
      readonly fullName: string;
      readonly securableType: "TABLE" | "VOLUME" | "FUNCTION" | "CONNECTION";
    };

const APP_VARIANTS = [
  "job",
  "sql_warehouse",
  "genie_space",
  "secret",
  "serving_endpoint",
  "experiment",
  "uc_securable",
] as const;

const projectRef = (resource: Readonly<Record<string, unknown>>): AppResourceRef | undefined => {
  for (const variant of APP_VARIANTS) {
    if (!Object.hasOwn(resource, variant)) continue;
    const value = resource[variant];
    if (!isUnknownRecord(value)) return undefined;
    if (variant === "job" || variant === "sql_warehouse" || variant === "experiment") {
      const field = variant === "experiment" ? "experiment_id" : "id";
      return typeof value[field] === "string" ? { kind: variant, id: value[field] } : undefined;
    }
    if (variant === "genie_space") {
      return typeof value["space_id"] === "string" && typeof value["name"] === "string"
        ? { kind: variant, id: value["space_id"], name: value["name"] }
        : undefined;
    }
    const field =
      variant === "secret" ? "scope" : variant === "uc_securable" ? "securable_full_name" : "name";
    const name = value[field];
    if (typeof name !== "string") return undefined;
    if (variant === "secret") return { kind: "secret_scope", name };
    if (variant === "uc_securable") {
      const securableType = value["securable_type"];
      if (typeof securableType !== "string") return undefined;
      if (
        securableType !== "TABLE" &&
        securableType !== "VOLUME" &&
        securableType !== "FUNCTION" &&
        securableType !== "CONNECTION"
      )
        return undefined;
      return { kind: variant, fullName: name, securableType };
    }
    return { kind: variant, name };
  }
  return undefined;
};

const isUnknownUcSecurableType = (value: unknown): boolean => {
  if (!isUnknownRecord(value)) return false;
  const type = value["securable_type"];
  return (
    typeof type === "string" &&
    type !== "TABLE" &&
    type !== "VOLUME" &&
    type !== "FUNCTION" &&
    type !== "CONNECTION"
  );
};

const invalid = (resourceKey: string): PreparationDiagnostic => ({
  resourceKey,
  capability: "app-resources",
  reason: "invalid-shape",
});

/** Project only recognized app resource variants; unrelated variants stay opaque. */
export const prepareAppResources = (
  resourceKey: string,
  state: Readonly<Record<string, unknown>> | undefined,
): {
  readonly projection: Projection<readonly AppResourceRef[]>;
  readonly diagnostic?: PreparationDiagnostic;
} => {
  if (state === undefined || !Object.hasOwn(state, "resources"))
    return { projection: { status: "absent" } };
  const resources = state["resources"];
  if (!Array.isArray(resources)) {
    const diagnostic = invalid(resourceKey);
    return { projection: { status: "unsupported", diagnostic }, diagnostic };
  }
  const refs: AppResourceRef[] = [];
  for (const resource of resources) {
    if (!isUnknownRecord(resource)) continue;
    if (!APP_VARIANTS.some((variant) => Object.hasOwn(resource, variant))) continue;
    const ucSecurable = resource["uc_securable"];
    if (isUnknownUcSecurableType(ucSecurable)) continue;
    const ref = projectRef(resource);
    if (ref === undefined) {
      const diagnostic = invalid(resourceKey);
      return { projection: { status: "unsupported", diagnostic }, diagnostic };
    }
    refs.push(ref);
  }
  return { projection: { status: "supported", value: refs } };
};
