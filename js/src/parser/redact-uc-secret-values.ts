import type { ChangeDesc, Plan, PlanEntry } from "../types/plan-schema.ts";
import { attachProviderComparisonFacts } from "../utils/provider-comparison-facts.ts";
import { isUnknownRecord } from "../utils/unknown-record.ts";

const REDACTED_SECRET_VALUE = "[redacted]";
const SECRET_FIELDS: ReadonlySet<string> = new Set(["value", "effective_value"]);
const PROVIDER_RESOURCE_PREFIX = "resources.model_provider_services.";
const PROVIDER_CREDENTIAL_PATHS = [
  ["anthropic", "direct", "api_key", "plaintext"],
  ["azure_openai", "direct", "api_key", "plaintext"],
  ["azure_openai", "direct", "entra_service_principal", "client_secret", "plaintext"],
  ["custom", "direct", "api_key", "plaintext"],
  ["gemini_enterprise", "direct", "api_key", "plaintext"],
  ["microsoft_foundry", "direct", "api_key", "plaintext"],
  ["microsoft_foundry", "direct", "entra_service_principal", "client_secret", "plaintext"],
  ["openai", "direct", "api_key", "plaintext"],
  ["amazon_bedrock", "direct", "aws_access_key", "secret_access_key", "plaintext"],
  ["amazon_bedrock", "direct", "aws_access_key", "access_key_id"],
] as const;

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
  if (raw === null || raw === undefined) return raw;
  // Secret states are an untrusted boundary: unknown non-null shapes must not pass through.
  if (!isUnknownRecord(raw)) return REDACTED_SECRET_VALUE;
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

const redactProviderValue = (value: unknown): unknown =>
  value === null || value === "" || value === REDACTED_SECRET_VALUE ? value : REDACTED_SECRET_VALUE;

const redactProviderConfig = (
  value: unknown,
  paths: readonly (readonly string[])[] = PROVIDER_CREDENTIAL_PATHS,
): unknown => {
  if (value === null || value === "") return value;
  if (!isUnknownRecord(value)) return REDACTED_SECRET_VALUE;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const matching = paths.filter((path) => path[0] === key).map((path) => path.slice(1));
      if (matching.some((path) => path.length === 0)) return [key, redactProviderValue(child)];
      if (matching.length === 0) return [key, child];
      return [key, redactProviderConfig(child, matching)];
    }),
  );
};

const redactProviderChangePayload = (
  value: unknown,
  paths: readonly (readonly string[])[],
): unknown => {
  if (paths.some((path) => path.length === 0)) return redactProviderValue(value);
  const relativePaths = paths.flatMap((path) => path.map((_, index) => path.slice(index)));
  return redactProviderConfig(value, relativePaths);
};

const providerChangePaths = (path: string): readonly (readonly string[])[] => {
  const segments = path.split(".").map((part) => part.split("[", 1)[0]);
  if (segments[0] !== "config") return [];
  const candidate = segments.slice(1);
  return PROVIDER_CREDENTIAL_PATHS.filter(
    (credential) =>
      candidate.length <= credential.length &&
      candidate.every((segment, index) => segment === credential[index]),
  ).map((credential) => credential.slice(candidate.length));
};

const redactProviderChange = (
  change: ChangeDesc,
  paths: readonly (readonly string[])[],
): ChangeDesc => {
  const rawFacts = change["_dagshund_provider_comparison_facts"];
  const suppliedFacts =
    isUnknownRecord(rawFacts) &&
    (typeof rawFacts["old_new_equal"] === "boolean" || rawFacts["old_new_equal"] === null) &&
    (typeof rawFacts["old_remote_equal"] === "boolean" || rawFacts["old_remote_equal"] === null)
      ? {
          oldNewEqual: rawFacts["old_new_equal"],
          oldRemoteEqual: rawFacts["old_remote_equal"],
        }
      : undefined;
  const { _dagshund_provider_comparison_facts: _ignored, ...cleanChange } = change;
  void _ignored;
  const withFacts = attachProviderComparisonFacts(cleanChange, suppliedFacts);
  return {
    ...withFacts,
    ...Object.fromEntries(
      Object.entries(change)
        .filter(([field]) => field === "old" || field === "new" || field === "remote")
        .map(([field, value]) => [field, redactProviderChangePayload(value, paths)]),
    ),
  };
};

const redactProviderEntry = (entry: PlanEntry): PlanEntry => {
  const redactProviderState = (state: unknown): unknown => {
    if (state === null || state === undefined) return state;
    if (!isUnknownRecord(state)) return REDACTED_SECRET_VALUE;
    const wrapped = Object.hasOwn(state, "value") ? state["value"] : state;
    if (!isUnknownRecord(wrapped)) return REDACTED_SECRET_VALUE;
    const redacted = Object.hasOwn(wrapped, "config")
      ? { ...wrapped, config: redactProviderConfig(wrapped["config"]) }
      : wrapped;
    return Object.hasOwn(state, "value") ? { ...state, value: redacted } : redacted;
  };
  const changes = entry.changes;
  return {
    ...entry,
    ...(Object.hasOwn(entry, "new_state")
      ? { new_state: redactProviderState(entry.new_state) }
      : {}),
    ...(Object.hasOwn(entry, "remote_state")
      ? { remote_state: redactProviderState(entry.remote_state) }
      : {}),
    ...(changes === undefined
      ? {}
      : {
          changes: Object.fromEntries(
            Object.entries(changes).map(([path, change]) => [
              path,
              providerChangePaths(path).length > 0
                ? redactProviderChange(change, providerChangePaths(path))
                : change,
            ]),
          ),
        }),
  };
};

const redactEntry = (entry: PlanEntry): PlanEntry => ({
  ...entry,
  ...(Object.hasOwn(entry, "new_state") ? { new_state: redactState(entry.new_state) } : {}),
  ...(Object.hasOwn(entry, "remote_state")
    ? { remote_state: redactState(entry.remote_state) }
    : {}),
  ...(Object.hasOwn(entry, "changes") ? { changes: redactChanges(entry.changes) } : {}),
});

export const redactUcSecretValues = (plan: Plan): Plan => {
  if (plan.plan === undefined) return plan;
  const entries = Object.entries(plan.plan);
  if (!entries.some(([key]) => isUcSecretKey(key) || key.startsWith(PROVIDER_RESOURCE_PREFIX)))
    return plan;
  return {
    ...plan,
    plan: Object.fromEntries(
      entries.map(([key, entry]) => [
        key,
        key.startsWith(PROVIDER_RESOURCE_PREFIX)
          ? redactProviderEntry(entry)
          : isUcSecretKey(key)
            ? redactEntry(entry)
            : entry,
      ]),
    ),
  };
};
