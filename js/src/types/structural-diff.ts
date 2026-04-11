/** Discriminated union describing the structural diff of a single change field. */

export type ScalarDiff = {
  readonly kind: "scalar";
  readonly old: unknown;
  readonly new: unknown;
};

export type ArrayElementStatus = "added" | "removed" | "unchanged";

export type ArrayElement = {
  readonly status: ArrayElementStatus;
  readonly value: unknown;
  /** Human-readable identity label, e.g. "task_key=check_duplicates" */
  readonly identityLabel: string | undefined;
};

export type ArrayDiff = {
  readonly kind: "array";
  readonly elements: readonly ArrayElement[];
};

export type ObjectEntryStatus = "added" | "removed" | "modified" | "unchanged";

export type ObjectEntry = {
  readonly key: string;
  readonly status: ObjectEntryStatus;
  readonly old: unknown;
  readonly new: unknown;
};

export type ObjectDiff = {
  readonly kind: "object";
  readonly entries: readonly ObjectEntry[];
};

export type CreateOnlyDiff = {
  readonly kind: "create-only";
  readonly value: unknown;
};

export type DeleteOnlyDiff = {
  readonly kind: "delete-only";
  readonly value: unknown;
};

export type StructuralDiff = ScalarDiff | ArrayDiff | ObjectDiff | CreateOnlyDiff | DeleteOnlyDiff;

type BaselineLabel = "old" | "remote";

/** A diff between two values (old↔new, or remote↔new for drift). */
export type DiffResult = {
  readonly kind: "diff";
  readonly diff: StructuralDiff;
  readonly baselineLabel: BaselineLabel;
  /** "drift" when the diff compares remote→new because the bundle will overwrite
   *  a manually-edited remote value (old == new != remote). */
  readonly semantic: "normal" | "drift";
};

/** A field the remote has that the bundle does not manage. Informational only —
 *  nothing is being created, removed, or updated by the deploy. */
export type RemoteOnlyResult = {
  readonly kind: "remote-only";
  readonly value: unknown;
};

export type StructuralDiffResult = DiffResult | RemoteOnlyResult;
