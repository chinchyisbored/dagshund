import { buildJobIdMap } from "../graph/resolve-run-job-target.ts";
import type { ActionType, ChangeDesc, PlanEntry } from "../types/plan-schema.ts";
import { mergeSubResources } from "./merge-sub-resources.ts";
import {
  buildPrefixedNodeId,
  extractResourceName,
  extractResourceType,
  type PhantomKind,
} from "./resource-key.ts";
import { getUnknownProp } from "./unknown-record.ts";

/** A deploy-triggered run (resources.job_runs.*) folded onto its target job.
 *  Effects annotate the job without touching its action or diff state. */
export type JobRunEffect = {
  readonly name: string;
  readonly action: ActionType;
  readonly runPageUrl: string | undefined;
  readonly changes: Readonly<Record<string, ChangeDesc>> | undefined;
  readonly newState: unknown;
  readonly remoteState: unknown;
};

type EffectTypeSpec = {
  /** Plan-key type segment whose entries are effects rather than resources. */
  readonly resourceType: string;
  /** Resource type of the entries this effect targets. */
  readonly targetResourceType: string;
  /** Phantom kind used when the numeric target is absent from the plan. */
  readonly phantomKind: PhantomKind;
  /** Extract the numeric target id from the effect entry's state. */
  readonly extractTargetId: (entry: PlanEntry) => number | undefined;
};

const extractJobRunTargetJobId = (entry: PlanEntry): number | undefined => {
  const fromNew = getUnknownProp(getUnknownProp(entry.new_state, "value"), "job_id");
  const jobId =
    typeof fromNew === "number" ? fromNew : getUnknownProp(entry.remote_state, "job_id");
  return typeof jobId === "number" && jobId !== 0 ? jobId : undefined;
};

/** Plan entry types treated as deploy effects, not resources (dagshund-ocb1).
 *  Mirrored in Python: `_EFFECT_RESOURCE_TYPES` in src/dagshund/merge.py. */
export const EFFECT_TYPE_SPECS = {
  job_runs: {
    resourceType: "job_runs",
    targetResourceType: "jobs",
    phantomKind: "job",
    extractTargetId: extractJobRunTargetJobId,
  },
} as const satisfies Readonly<Record<string, EffectTypeSpec>>;

const EFFECT_SPECS_BY_RESOURCE_TYPE: ReadonlyMap<string, EffectTypeSpec> = new Map(
  Object.values(EFFECT_TYPE_SPECS).map((spec) => [spec.resourceType, spec]),
);

/** A plan entry after normalization — may carry the effects targeting it. */
export type NormalizedEntry = PlanEntry & {
  readonly effects?: readonly JobRunEffect[];
};

export type NormalizedPlan = {
  readonly entries: Readonly<Record<string, NormalizedEntry>>;
  /** Effects whose numeric target is not in the plan, keyed by phantom node id (job::<id>). */
  readonly orphanEffects: ReadonlyMap<string, readonly JobRunEffect[]>;
};

/** run_page_url values become href/markdown link targets, and plan files are
 *  arbitrary local input — accept only http(s) URLs free of whitespace and
 *  link-delimiter characters. The unflagged `$` is a true end-of-string anchor
 *  in JS (no trailing-newline tolerance). Mirrored in Python:
 *  `_RUN_PAGE_URL_PATTERN` (which needs fullmatch for the same guarantee). */
const RUN_PAGE_URL_PATTERN = /^https?:\/\/[^\s<>()\\]+$/;

const extractRunPageUrl = (remoteState: unknown): string | undefined => {
  const runPageUrl = getUnknownProp(remoteState, "run_page_url");
  return typeof runPageUrl === "string" && RUN_PAGE_URL_PATTERN.test(runPageUrl)
    ? runPageUrl
    : undefined;
};

const buildJobRunEffect = (key: string, entry: PlanEntry): JobRunEffect => ({
  name: extractResourceName(key),
  action: entry.action ?? "",
  runPageUrl: extractRunPageUrl(entry.remote_state),
  changes: entry.changes,
  newState: entry.new_state,
  remoteState: entry.remote_state,
});

/** Resolve the target resource key: prefer the symbolic depends_on reference,
 *  fall back to numeric id lookup. The id map is built from job entries only
 *  (jobIdMap covers job_runs, the only effect kind), so a match is always a job. */
const resolveEffectTargetKey = (
  entry: PlanEntry,
  spec: EffectTypeSpec,
  targets: Readonly<Record<string, PlanEntry>>,
  jobIdMap: ReadonlyMap<number, string>,
): string | undefined => {
  const depTarget = (entry.depends_on ?? []).find(
    (dep) =>
      extractResourceType(dep.node) === spec.targetResourceType && targets[dep.node] !== undefined,
  );
  if (depTarget !== undefined) return depTarget.node;
  const targetId = spec.extractTargetId(entry);
  return targetId !== undefined ? jobIdMap.get(targetId) : undefined;
};

const sortByName = (effects: readonly JobRunEffect[]): readonly JobRunEffect[] =>
  effects.toSorted((a, b) => a.name.localeCompare(b.name));

/** Normalize a raw plan record: merge sub-resources, then fold effect entries
 *  (job_runs) onto their target jobs as structured annotations. The target's
 *  own action/changes/state stay untouched — effects never promote the parent.
 *  Effects whose target cannot be resolved at all (no depends_on match, no
 *  numeric id) stay standalone entries.
 *  Mirror of `normalize_plan` in src/dagshund/merge.py. */
export const normalizePlan = (rawEntries: Readonly<Record<string, PlanEntry>>): NormalizedPlan => {
  const merged = mergeSubResources(rawEntries);

  // Local accumulation: entries/effect groups are built up, then frozen into the result.
  const targets: Record<string, NormalizedEntry> = {};
  const effectEntries: [string, PlanEntry, EffectTypeSpec][] = [];
  for (const [key, entry] of Object.entries(merged)) {
    const resourceType = extractResourceType(key);
    const spec =
      resourceType !== undefined ? EFFECT_SPECS_BY_RESOURCE_TYPE.get(resourceType) : undefined;
    if (spec === undefined) {
      targets[key] = entry;
    } else {
      effectEntries.push([key, entry, spec]);
    }
  }
  if (effectEntries.length === 0) return { entries: targets, orphanEffects: new Map() };

  // Built from job entries only — effect entries carry the target's job_id in
  // their own remote_state, and any other resource sharing the id must neither
  // shadow the job (map insertion is last-wins) nor receive the effect.
  const jobIdMap = buildJobIdMap(
    Object.entries(targets).filter(([key]) => extractResourceType(key) === "jobs"),
  );
  const effectsByTarget = new Map<string, JobRunEffect[]>();
  const orphansByPhantomId = new Map<string, JobRunEffect[]>();
  for (const [key, entry, spec] of effectEntries) {
    const targetKey = resolveEffectTargetKey(entry, spec, targets, jobIdMap);
    if (targetKey !== undefined) {
      const group = effectsByTarget.get(targetKey) ?? [];
      group.push(buildJobRunEffect(key, entry));
      effectsByTarget.set(targetKey, group);
      continue;
    }
    const targetId = spec.extractTargetId(entry);
    if (targetId === undefined) {
      targets[key] = entry;
      continue;
    }
    const phantomId = buildPrefixedNodeId(spec.phantomKind, String(targetId));
    const group = orphansByPhantomId.get(phantomId) ?? [];
    group.push(buildJobRunEffect(key, entry));
    orphansByPhantomId.set(phantomId, group);
  }

  for (const [targetKey, effects] of effectsByTarget) {
    const target = targets[targetKey];
    if (target !== undefined) targets[targetKey] = { ...target, effects: sortByName(effects) };
  }
  const orphanEffects = new Map(
    [...orphansByPhantomId].map(
      ([phantomId, effects]) => [phantomId, sortByName(effects)] as const,
    ),
  );
  return { entries: targets, orphanEffects };
};
