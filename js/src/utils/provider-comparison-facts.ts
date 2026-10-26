import type { ChangeDesc, Plan } from "../types/plan-schema.ts";
import { deepEqual } from "./deep-equal.ts";

export type ProviderComparisonFacts = {
  readonly oldNewEqual: boolean | null;
  readonly oldRemoteEqual: boolean | null;
};

export const PROVIDER_COMPARISON_FACTS: unique symbol = Symbol("provider-comparison-facts");

type ChangeWithProviderFacts = ChangeDesc & {
  readonly [PROVIDER_COMPARISON_FACTS]?: ProviderComparisonFacts;
};

const containsRedactedMarker = (value: unknown): boolean => {
  if (typeof value === "string") return value.toLowerCase().includes("[redacted]");
  if (Array.isArray(value)) return value.some(containsRedactedMarker);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) => containsRedactedMarker(key) || containsRedactedMarker(child),
  );
};

const compareKnown = (left: unknown, right: unknown): boolean | null =>
  containsRedactedMarker(left) || containsRedactedMarker(right) ? null : deepEqual(left, right);

export const attachProviderComparisonFacts = (
  change: ChangeDesc,
  supplied?: ProviderComparisonFacts,
): ChangeDesc => {
  if (!Object.hasOwn(change, "old") && !Object.hasOwn(change, "new")) return change;
  const oldNewEqual =
    supplied !== undefined
      ? supplied.oldNewEqual
      : Object.hasOwn(change, "old") && Object.hasOwn(change, "new")
        ? compareKnown(change.old, change.new)
        : null;
  const oldRemoteEqual =
    supplied !== undefined
      ? supplied.oldRemoteEqual
      : Object.hasOwn(change, "old") && Object.hasOwn(change, "remote")
        ? compareKnown(change.old, change.remote)
        : null;
  const withFacts: ChangeWithProviderFacts = {
    ...change,
    [PROVIDER_COMPARISON_FACTS]: { oldNewEqual, oldRemoteEqual },
  };
  return withFacts;
};

export const serializePlanWithProviderComparisonFacts = (plan: Plan): Plan => {
  if (plan.plan === undefined) return plan;
  const entries = Object.entries(plan.plan);
  if (!entries.some(([key]) => key.startsWith("resources.model_provider_services."))) return plan;
  return {
    ...plan,
    plan: Object.fromEntries(
      entries.map(([key, entry]) => {
        if (!key.startsWith("resources.model_provider_services.") || entry.changes === undefined)
          return [key, entry];
        return [
          key,
          {
            ...entry,
            changes: Object.fromEntries(
              Object.entries(entry.changes).map(([field, change]) => {
                const withFacts: ChangeWithProviderFacts = change;
                const facts = withFacts[PROVIDER_COMPARISON_FACTS];
                return [
                  field,
                  facts === undefined
                    ? change
                    : {
                        ...change,
                        _dagshund_provider_comparison_facts: {
                          old_new_equal: facts.oldNewEqual,
                          old_remote_equal: facts.oldRemoteEqual,
                        },
                      },
                ];
              }),
            ),
          },
        ];
      }),
    ),
  };
};

export const compareProviderChangeValues = (
  change: ChangeDesc,
  left: "old" | "new" | "remote",
  right: "old" | "new" | "remote",
): boolean | null | undefined => {
  const withFacts: ChangeWithProviderFacts = change;
  const facts = withFacts[PROVIDER_COMPARISON_FACTS];
  if (facts === undefined) return undefined;
  if ((left === "old" && right === "new") || (left === "new" && right === "old"))
    return facts.oldNewEqual;
  if ((left === "old" && right === "remote") || (left === "remote" && right === "old"))
    return facts.oldRemoteEqual;
  return undefined;
};
