import type { ChangeDesc, Plan, PlanEntry } from "../types/plan-schema.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";

const REDACTED_SECRET_VALUE = "[redacted]";
const SECRET_FIELDS: ReadonlySet<string> = new Set(["value", "effective_value"]);

const isUcSecretKey = (key: string): boolean => key.startsWith("resources.secrets.");

const redactStateFields = (
  state: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(state).map(([key, value]) => [
      key,
      SECRET_FIELDS.has(key) ? REDACTED_SECRET_VALUE : value,
    ]),
  );

const redactState = (raw: unknown): unknown => {
  if (!isUnknownRecord(raw)) return raw;
  const wrapped = raw["value"];
  return isUnknownRecord(wrapped)
    ? { ...redactStateFields(raw), value: redactStateFields(wrapped) }
    : redactStateFields(raw);
};

const redactChangePayload = (value: unknown): unknown =>
  value === "" || (typeof value === "string" && value.toLowerCase() === REDACTED_SECRET_VALUE)
    ? value
    : REDACTED_SECRET_VALUE;

const redactChange = (change: ChangeDesc): ChangeDesc => ({
  ...change,
  ...(Object.hasOwn(change, "old") ? { old: redactChangePayload(change.old) } : {}),
  ...(Object.hasOwn(change, "new") ? { new: redactChangePayload(change.new) } : {}),
  ...(Object.hasOwn(change, "remote") ? { remote: redactChangePayload(change.remote) } : {}),
});

const redactChanges = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): Readonly<Record<string, ChangeDesc>> | undefined =>
  changes === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(changes).map(([field, change]) => [
          field,
          SECRET_FIELDS.has(field) ? redactChange(change) : change,
        ]),
      );

const redactEntry = (entry: PlanEntry): PlanEntry => ({
  ...entry,
  new_state: redactState(entry.new_state),
  remote_state: redactState(entry.remote_state),
  changes: redactChanges(entry.changes),
});

export const redactUcSecretValues = (plan: Plan): Plan => {
  if (plan.plan === undefined) return plan;
  const entries = Object.entries(plan.plan);
  if (!entries.some(([key]) => isUcSecretKey(key))) return plan;
  return {
    ...plan,
    plan: Object.fromEntries(
      entries.map(([key, entry]) => [key, isUcSecretKey(key) ? redactEntry(entry) : entry]),
    ),
  };
};
