import type { PlanEntry } from "../types/plan-schema.ts";
import type { PreparedPlan } from "../types/prepared-plan.ts";
import type { ReferenceIdentityCatalog } from "../types/reference-resolution.ts";
import type { OwnedDerivedNodeRefs } from "./derived-node-specs.ts";
import type { ReferenceIndexes } from "./reference-specs.ts";

export type ReferenceResolutionContext = {
  readonly entries: readonly (readonly [string, PlanEntry])[];
  readonly indexes: ReferenceIndexes;
  readonly preparedPlan: PreparedPlan;
  readonly identityCatalog: ReferenceIdentityCatalog;
  readonly ownedDerivedRefs: OwnedDerivedNodeRefs;
};
