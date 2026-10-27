import type { ChangeDesc } from "../types/plan-schema.ts";
import { parseDictKeyBracket } from "./change-path.ts";
import type { JobRunEffect } from "./normalize-plan.ts";
import { getUnknownProp, isUnknownRecord } from "./unknown-record.ts";

export type JobRunEffectKind =
  | "create"
  | "recreate"
  | "every-deploy"
  | "file-change"
  | "completed-success"
  | "legacy-skip"
  | "in-progress"
  | "trigger-removed"
  | "cleanup"
  | "delete"
  | "unknown";

export type JobRunEffectSemantics = {
  readonly kind: JobRunEffectKind;
  readonly wording: string;
  readonly stateMessage: string | undefined;
  readonly firesOnDeploy: boolean;
  readonly badgeVisible: boolean;
  readonly watchedPatterns: readonly {
    readonly pattern: string;
    readonly status: "added" | "removed" | "changed";
  }[];
};

const RESULT_STATE_CHANGE_KEY = "result_state";
const CHANGE_VALUE_KEYS = ["old", "new", "remote"] as const;
const TRIGGER_CHANGE_PATHS: ReadonlySet<string> = new Set([
  "lifecycle",
  "lifecycle.triggers",
  "lifecycle.triggers.on_bundle_deploy",
  "lifecycle.triggers_state",
  "lifecycle.triggers_state.on_bundle_deploy",
  "lifecycle.triggers_state.on_file_change",
]);
const AGGREGATE_TRIGGER_CHANGE_PATHS: ReadonlySet<string> = new Set([
  "lifecycle",
  "lifecycle.triggers",
  "lifecycle.triggers_state",
]);
const IN_PROGRESS_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  "PENDING",
  "RUNNING",
  "TERMINATING",
]);
const UNSUCCESSFUL_RESULT_STATES: ReadonlySet<string> = new Set(["FAILED", "CANCELED", "TIMEDOUT"]);
const UNSUCCESSFUL_LIFECYCLE_STATES: ReadonlySet<string> = new Set(["SKIPPED", "INTERNAL_ERROR"]);

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const extractRemoteValues = (
  effect: JobRunEffect,
): {
  readonly resultState: string | undefined;
  readonly lifecycleState: string | undefined;
  readonly stateMessage: string | undefined;
} => {
  const remoteState = effect.remoteState;
  const state = getUnknownProp(remoteState, "state");
  const directResultState = getUnknownProp(remoteState, "result_state");
  const nestedResultState = getUnknownProp(state, "result_state");
  const lifecycleState = getUnknownProp(state, "life_cycle_state");
  const stateMessage = getUnknownProp(state, "state_message");
  return {
    resultState:
      typeof directResultState === "string"
        ? directResultState
        : typeof nestedResultState === "string"
          ? nestedResultState
          : undefined,
    lifecycleState: typeof lifecycleState === "string" ? lifecycleState : undefined,
    stateMessage: asNonEmptyString(stateMessage),
  };
};

const extractTriggerFingerprint = (value: unknown, path: string): string | undefined => {
  if (
    path === "lifecycle.triggers.on_bundle_deploy" ||
    path === "lifecycle.triggers_state.on_bundle_deploy"
  )
    return asNonEmptyString(value);
  if (!isUnknownRecord(value)) return undefined;

  if (path === "lifecycle.triggers" || path === "lifecycle.triggers_state") {
    return asNonEmptyString(getUnknownProp(value, "on_bundle_deploy"));
  }
  if (path === "lifecycle.triggers_state.on_bundle_deploy") return asNonEmptyString(value);
  if (path === "lifecycle") {
    const modern = extractTriggerFingerprint(
      getUnknownProp(value, "triggers_state"),
      "lifecycle.triggers_state",
    );
    if (modern !== undefined) return modern;
    const nestedFingerprint = extractTriggerFingerprint(
      getUnknownProp(value, "triggers"),
      "lifecycle.triggers",
    );
    return nestedFingerprint ?? asNonEmptyString(getUnknownProp(value, "on_bundle_deploy"));
  }
  return undefined;
};

const getChangeValue = (change: ChangeDesc, key: "old" | "new" | "remote"): unknown =>
  getUnknownProp(change, key);

const getPatternSelector = (path: string): string | undefined => {
  const prefix = "lifecycle.triggers_state.on_file_change";
  if (!path.startsWith(prefix)) return undefined;
  const selector = parseDictKeyBracket(path.slice(prefix.length));
  return selector?.rest === "" ? selector.key : undefined;
};

const isTriggerFingerprintChange = (path: string, change: ChangeDesc): boolean => {
  if (!TRIGGER_CHANGE_PATHS.has(path) && getPatternSelector(path) === undefined) return false;
  if (getPatternSelector(path) !== undefined) {
    return CHANGE_VALUE_KEYS.some(
      (key) => asNonEmptyString(getChangeValue(change, key)) !== undefined,
    );
  }
  if (path === "lifecycle.triggers_state.on_file_change") {
    return CHANGE_VALUE_KEYS.some(
      (key) => getFileMap(getChangeValue(change, key), path) !== undefined,
    );
  }
  const hasFileChangeMap =
    (path === "lifecycle" || path === "lifecycle.triggers_state") &&
    CHANGE_VALUE_KEYS.some((key) => getFileMap(getChangeValue(change, key), path) !== undefined);
  if (hasFileChangeMap || change.reason === "trigger removed") return true;

  const values = [
    getChangeValue(change, "old"),
    getChangeValue(change, "new"),
    getChangeValue(change, "remote"),
  ].filter((value) => value !== undefined);
  return (
    values.length > 0 &&
    values.some((value) => extractTriggerFingerprint(value, path) !== undefined)
  );
};

const removeBundleFingerprint = (value: unknown): unknown =>
  asNonEmptyString(value) === undefined ? value : undefined;

const removeFileFingerprints = (value: unknown): unknown => {
  if (!isUnknownRecord(value)) return value;
  const remaining = Object.fromEntries(
    Object.entries(value).filter(([, item]) => asNonEmptyString(item) === undefined),
  );
  return Object.keys(remaining).length > 0 ? remaining : undefined;
};

const removeTriggerFingerprint = (value: unknown, path: string): unknown => {
  if (path === "lifecycle.triggers_state.on_bundle_deploy") return removeBundleFingerprint(value);
  if (getPatternSelector(path) !== undefined)
    return asNonEmptyString(value) === undefined ? value : undefined;
  if (path === "lifecycle.triggers_state.on_file_change") return removeFileFingerprints(value);
  if (!AGGREGATE_TRIGGER_CHANGE_PATHS.has(path) || !isUnknownRecord(value)) return value;
  if (path === "lifecycle.triggers") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "on_bundle_deploy"));
  }
  const cleaned: Record<string, unknown> = { ...value };
  if (path === "lifecycle") {
    const legacy = getUnknownProp(cleaned, "triggers");
    const modern = getUnknownProp(cleaned, "triggers_state");
    if (isUnknownRecord(legacy)) {
      const remaining = Object.fromEntries(
        Object.entries(legacy).filter(([key]) => key !== "on_bundle_deploy"),
      );
      if (Object.keys(remaining).length > 0) cleaned["triggers"] = remaining;
      else delete cleaned["triggers"];
    }
    if (isUnknownRecord(modern)) {
      const remaining = Object.fromEntries(
        Object.entries(modern).filter(
          ([key, item]) => key !== "on_bundle_deploy" || asNonEmptyString(item) === undefined,
        ),
      );
      const fileChanges = removeFileFingerprints(getUnknownProp(modern, "on_file_change"));
      if (fileChanges === undefined) delete remaining["on_file_change"];
      else if (Object.hasOwn(modern, "on_file_change")) remaining["on_file_change"] = fileChanges;
      if (Object.keys(remaining).length > 0) cleaned["triggers_state"] = remaining;
      else delete cleaned["triggers_state"];
    }
  } else {
    if (asNonEmptyString(getUnknownProp(cleaned, "on_bundle_deploy")) !== undefined)
      delete cleaned["on_bundle_deploy"];
    const fileChanges = removeFileFingerprints(getUnknownProp(cleaned, "on_file_change"));
    if (fileChanges === undefined) delete cleaned["on_file_change"];
    else if (Object.hasOwn(cleaned, "on_file_change")) cleaned["on_file_change"] = fileChanges;
  }
  return cleaned;
};

const hasMeaningfulChangeValue = (value: unknown): boolean =>
  value !== undefined && (!isUnknownRecord(value) || Object.keys(value).length > 0);

const hasMeaningfulChangeContent = (change: ChangeDesc): boolean =>
  CHANGE_VALUE_KEYS.some((key) => hasMeaningfulChangeValue(getChangeValue(change, key)));

const cleanTriggerChange = (path: string, change: ChangeDesc): ChangeDesc | undefined => {
  if (!isTriggerFingerprintChange(path, change)) return change;
  if (path === "lifecycle.triggers.on_bundle_deploy") return undefined;
  if (path === "lifecycle.triggers_state.on_bundle_deploy") {
    const cleaned: ChangeDesc = {
      ...change,
      ...(Object.hasOwn(change, "old")
        ? { old: removeBundleFingerprint(getChangeValue(change, "old")) }
        : {}),
      ...(Object.hasOwn(change, "new")
        ? { new: removeBundleFingerprint(getChangeValue(change, "new")) }
        : {}),
      ...(Object.hasOwn(change, "remote")
        ? { remote: removeBundleFingerprint(getChangeValue(change, "remote")) }
        : {}),
    };
    return CHANGE_VALUE_KEYS.some(
      (key) => Object.hasOwn(cleaned, key) && getChangeValue(cleaned, key) !== undefined,
    )
      ? cleaned
      : undefined;
  }
  if (
    path === "lifecycle.triggers_state.on_file_change" ||
    getPatternSelector(path) !== undefined
  ) {
    const clean = (key: "old" | "new" | "remote"): unknown =>
      removeTriggerFingerprint(getChangeValue(change, key), path);
    const cleaned: ChangeDesc = {
      ...change,
      ...(Object.hasOwn(change, "old") ? { old: clean("old") } : {}),
      ...(Object.hasOwn(change, "new") ? { new: clean("new") } : {}),
      ...(Object.hasOwn(change, "remote") ? { remote: clean("remote") } : {}),
    };
    return hasMeaningfulChangeContent(cleaned) ? cleaned : undefined;
  }
  if (!AGGREGATE_TRIGGER_CHANGE_PATHS.has(path)) return change;

  const cleaned: ChangeDesc = {
    ...change,
    ...(Object.hasOwn(change, "old")
      ? { old: removeTriggerFingerprint(getChangeValue(change, "old"), path) }
      : {}),
    ...(Object.hasOwn(change, "new")
      ? { new: removeTriggerFingerprint(getChangeValue(change, "new"), path) }
      : {}),
    ...(Object.hasOwn(change, "remote")
      ? { remote: removeTriggerFingerprint(getChangeValue(change, "remote"), path) }
      : {}),
  };
  return hasMeaningfulChangeContent(cleaned) ? cleaned : undefined;
};

const getFileMap = (
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> | undefined => {
  if (
    value === undefined &&
    (AGGREGATE_TRIGGER_CHANGE_PATHS.has(path) || path === "lifecycle.triggers_state.on_file_change")
  )
    return {};
  if (!isUnknownRecord(value)) return undefined;
  if (path === "lifecycle.triggers_state.on_file_change") {
    return Object.values(value).every((item) => asNonEmptyString(item) !== undefined)
      ? value
      : undefined;
  }
  const triggers = path === "lifecycle" ? getUnknownProp(value, "triggers_state") : value;
  if (path === "lifecycle" && !Object.hasOwn(value, "triggers_state")) return undefined;
  if (!isUnknownRecord(triggers)) return undefined;
  if (path === "lifecycle.triggers_state" && !Object.hasOwn(triggers, "on_file_change")) return {};
  return getFileMap(
    getUnknownProp(triggers, "on_file_change"),
    "lifecycle.triggers_state.on_file_change",
  );
};

const extractWatchedPatterns = (
  effect: JobRunEffect,
): readonly { readonly pattern: string; readonly status: "added" | "removed" | "changed" }[] => {
  const details = new Map<string, "added" | "removed" | "changed">();
  for (const [path, change] of Object.entries(effect.changes ?? {})) {
    if (
      path !== "lifecycle" &&
      path !== "lifecycle.triggers_state" &&
      path !== "lifecycle.triggers_state.on_file_change" &&
      getPatternSelector(path) === undefined
    )
      continue;
    const prefix = "lifecycle.triggers_state.on_file_change";
    const selector = path.startsWith(prefix)
      ? parseDictKeyBracket(path.slice(prefix.length))
      : undefined;
    const selected = selector?.rest === "" ? selector.key : undefined;
    const oldValue = getChangeValue(change, "old");
    const newValue = getChangeValue(change, "new");
    if (
      selected !== undefined &&
      oldValue !== undefined &&
      asNonEmptyString(oldValue) === undefined
    )
      continue;
    if (
      selected !== undefined &&
      newValue !== undefined &&
      asNonEmptyString(newValue) === undefined
    )
      continue;
    const oldMap =
      selected === undefined
        ? getFileMap(oldValue, path)
        : oldValue === undefined
          ? {}
          : { [selected]: oldValue };
    const newMap =
      selected === undefined
        ? getFileMap(newValue, path)
        : newValue === undefined
          ? {}
          : { [selected]: newValue };
    if (oldMap === undefined || newMap === undefined) continue;
    for (const pattern of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
      if (!Object.hasOwn(oldMap, pattern)) details.set(pattern, "added");
      else if (!Object.hasOwn(newMap, pattern)) details.set(pattern, "removed");
      else if (oldMap[pattern] !== newMap[pattern]) details.set(pattern, "changed");
    }
  }
  return [...details]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pattern, status]) => ({ pattern, status }));
};

const isArmedEveryDeployTrigger = (effect: JobRunEffect): boolean =>
  Object.entries(effect.changes ?? {}).some(([path, change]) => {
    if (!TRIGGER_CHANGE_PATHS.has(path)) return false;
    const oldFingerprint = extractTriggerFingerprint(getChangeValue(change, "old"), path);
    const newFingerprint = extractTriggerFingerprint(getChangeValue(change, "new"), path);
    return oldFingerprint !== undefined && newFingerprint !== undefined;
  });

const hasTriggerRemoval = (effect: JobRunEffect): boolean =>
  Object.entries(effect.changes ?? {}).some(
    ([path, change]) => TRIGGER_CHANGE_PATHS.has(path) && change.reason === "trigger removed",
  );

const extractUnsuccessfulOutcome = (
  resultState: string | undefined,
  lifecycleState: string | undefined,
): string | undefined => {
  if (resultState !== undefined && UNSUCCESSFUL_RESULT_STATES.has(resultState)) return resultState;
  if (
    resultState === undefined &&
    lifecycleState !== undefined &&
    UNSUCCESSFUL_LIFECYCLE_STATES.has(lifecycleState)
  ) {
    return lifecycleState;
  }
  return undefined;
};

const baseWording = (kind: JobRunEffectKind, action: string): string => {
  switch (kind) {
    case "create":
      return "runs on deploy";
    case "recreate":
      return "re-runs on deploy";
    case "every-deploy":
      return "runs on every deploy";
    case "file-change":
      return "re-runs on deploy (file-change trigger)";
    case "completed-success":
      return "already ran successfully";
    case "legacy-skip":
      return "already ran";
    case "in-progress":
      return "run still in progress";
    case "trigger-removed":
      return "deploy trigger removed; no run will start";
    case "cleanup":
      return "run entry removed from bundle state; run history preserved";
    case "delete":
      return "bundle run entry will be removed";
    case "unknown":
      return action === "" ? "unchanged" : action;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

const buildSemantics = (
  effect: JobRunEffect,
  kind: JobRunEffectKind,
  outcome: string | undefined = undefined,
  stateMessage: string | undefined = undefined,
): JobRunEffectSemantics => {
  const base = baseWording(kind, effect.action);
  const wording = outcome === undefined ? base : `${base}; previous run ${outcome}`;
  return {
    kind,
    wording,
    stateMessage,
    firesOnDeploy:
      kind === "create" || kind === "recreate" || kind === "every-deploy" || kind === "file-change",
    badgeVisible: kind !== "delete" && kind !== "trigger-removed",
    watchedPatterns: [],
  };
};

export const classifyJobRunEffect = (effect: JobRunEffect): JobRunEffectSemantics => {
  const { resultState, lifecycleState, stateMessage } = extractRemoteValues(effect);

  if (effect.action === "delete" && (effect.gone === true || effect.stateOnly === true)) {
    const wording =
      effect.gone === true
        ? "already absent; removing stale bundle state"
        : "run entry removed from bundle state; run history preserved";
    return {
      kind: "cleanup",
      wording,
      stateMessage,
      firesOnDeploy: false,
      badgeVisible: false,
      watchedPatterns: [],
    };
  }

  if (effect.action === "skip") {
    if (hasTriggerRemoval(effect)) return buildSemantics(effect, "trigger-removed");
    const hasInProgressReason =
      effect.changes?.[RESULT_STATE_CHANGE_KEY]?.reason === "run in progress";
    if (
      hasInProgressReason &&
      lifecycleState !== undefined &&
      IN_PROGRESS_LIFECYCLE_STATES.has(lifecycleState)
    ) {
      return buildSemantics(effect, "in-progress", undefined, stateMessage);
    }
    if (resultState === "SUCCESS") return buildSemantics(effect, "completed-success");
    return buildSemantics(effect, "legacy-skip");
  }

  if (effect.action === "recreate") {
    const outcome = extractUnsuccessfulOutcome(resultState, lifecycleState);
    const watchedPatterns = extractWatchedPatterns(effect);
    const everyDeploy = isArmedEveryDeployTrigger(effect);
    const hasRerunFileChange = watchedPatterns.some(({ status }) => status !== "removed");
    const kind: JobRunEffectKind = everyDeploy
      ? "every-deploy"
      : hasRerunFileChange
        ? "file-change"
        : "recreate";
    return {
      ...buildSemantics(effect, kind, outcome, outcome === undefined ? undefined : stateMessage),
      watchedPatterns,
    };
  }

  if (effect.action === "create")
    return { ...buildSemantics(effect, "create"), watchedPatterns: extractWatchedPatterns(effect) };
  if (effect.action === "delete") return buildSemantics(effect, "delete");
  return buildSemantics(effect, "unknown");
};

export const describeJobRunEffect = (effect: JobRunEffect): string =>
  `${effect.name}: ${classifyJobRunEffect(effect).wording}`;

export const filterJobRunChanges = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
  suppressDetails = false,
): Readonly<Record<string, ChangeDesc>> =>
  suppressDetails
    ? {}
    : Object.fromEntries(
        Object.entries(changes ?? {}).flatMap(([path, change]) => {
          if (path === RESULT_STATE_CHANGE_KEY) return [];
          const filtered =
            TRIGGER_CHANGE_PATHS.has(path) || getPatternSelector(path) !== undefined
              ? cleanTriggerChange(path, change)
              : change;
          return filtered === undefined ? [] : [[path, filtered] as const];
        }),
      );
