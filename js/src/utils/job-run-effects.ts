import type { ChangeDesc } from "../types/plan-schema.ts";
import type { JobRunEffect } from "./normalize-plan.ts";
import { getUnknownProp, isUnknownRecord } from "./unknown-record.ts";

export type JobRunEffectKind =
  | "create"
  | "recreate"
  | "every-deploy"
  | "completed-success"
  | "legacy-skip"
  | "in-progress"
  | "trigger-removed"
  | "delete"
  | "unknown";

export type JobRunEffectSemantics = {
  readonly kind: JobRunEffectKind;
  readonly wording: string;
  readonly stateMessage: string | undefined;
  readonly firesOnDeploy: boolean;
  readonly badgeVisible: boolean;
};

const RESULT_STATE_CHANGE_KEY = "result_state";
const CHANGE_VALUE_KEYS = ["old", "new", "remote"] as const;
const TRIGGER_CHANGE_PATHS: ReadonlySet<string> = new Set([
  "lifecycle",
  "lifecycle.triggers",
  "lifecycle.triggers.on_bundle_deploy",
]);
const AGGREGATE_TRIGGER_CHANGE_PATHS: ReadonlySet<string> = new Set([
  "lifecycle",
  "lifecycle.triggers",
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
  if (path === "lifecycle.triggers.on_bundle_deploy") return asNonEmptyString(value);
  if (!isUnknownRecord(value)) return undefined;

  if (path === "lifecycle.triggers") {
    return asNonEmptyString(getUnknownProp(value, "on_bundle_deploy"));
  }
  if (path === "lifecycle") {
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

const isTriggerFingerprintChange = (path: string, change: ChangeDesc): boolean => {
  if (!TRIGGER_CHANGE_PATHS.has(path)) return false;
  if (change.reason === "trigger removed") return true;

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

const removeTriggerFingerprint = (value: unknown, path: string): unknown => {
  if (!AGGREGATE_TRIGGER_CHANGE_PATHS.has(path) || !isUnknownRecord(value)) return value;

  const withoutDirectTrigger = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "on_bundle_deploy"),
  );
  if (path === "lifecycle.triggers") return withoutDirectTrigger;

  const triggers = getUnknownProp(value, "triggers");
  if (!isUnknownRecord(triggers)) return withoutDirectTrigger;
  const withoutNestedTrigger = removeTriggerFingerprint(triggers, "lifecycle.triggers");
  if (isUnknownRecord(withoutNestedTrigger) && Object.keys(withoutNestedTrigger).length === 0) {
    return Object.fromEntries(
      Object.entries(withoutDirectTrigger).filter(([key]) => key !== "triggers"),
    );
  }
  return { ...withoutDirectTrigger, triggers: withoutNestedTrigger };
};

const hasMeaningfulChangeValue = (value: unknown): boolean =>
  value !== undefined && (!isUnknownRecord(value) || Object.keys(value).length > 0);

const hasMeaningfulChangeContent = (change: ChangeDesc): boolean =>
  CHANGE_VALUE_KEYS.some((key) => hasMeaningfulChangeValue(getChangeValue(change, key)));

const cleanTriggerChange = (path: string, change: ChangeDesc): ChangeDesc | undefined => {
  if (!isTriggerFingerprintChange(path, change)) return change;
  if (path === "lifecycle.triggers.on_bundle_deploy") return undefined;
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
    case "completed-success":
      return "already ran successfully";
    case "legacy-skip":
      return "already ran";
    case "in-progress":
      return "run still in progress";
    case "trigger-removed":
      return "deploy trigger removed; no run will start";
    case "delete":
      return "run record will be deleted";
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
    firesOnDeploy: kind === "create" || kind === "recreate" || kind === "every-deploy",
    badgeVisible: kind !== "delete" && kind !== "trigger-removed",
  };
};

export const classifyJobRunEffect = (effect: JobRunEffect): JobRunEffectSemantics => {
  const { resultState, lifecycleState, stateMessage } = extractRemoteValues(effect);

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
    const kind: JobRunEffectKind = isArmedEveryDeployTrigger(effect) ? "every-deploy" : "recreate";
    return buildSemantics(effect, kind, outcome, outcome === undefined ? undefined : stateMessage);
  }

  if (effect.action === "create") return buildSemantics(effect, "create");
  if (effect.action === "delete") return buildSemantics(effect, "delete");
  return buildSemantics(effect, "unknown");
};

export const describeJobRunEffect = (effect: JobRunEffect): string =>
  `${effect.name}: ${classifyJobRunEffect(effect).wording}`;

export const filterJobRunChanges = (
  changes: Readonly<Record<string, ChangeDesc>> | undefined,
): Readonly<Record<string, ChangeDesc>> =>
  Object.fromEntries(
    Object.entries(changes ?? {}).flatMap(([path, change]) => {
      if (path === RESULT_STATE_CHANGE_KEY) return [];
      const filtered = TRIGGER_CHANGE_PATHS.has(path) ? cleanTriggerChange(path, change) : change;
      return filtered === undefined ? [] : [[path, filtered] as const];
    }),
  );
