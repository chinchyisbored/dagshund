import type { DiffState } from "./diff-state.ts";

export type LateralDependencyEntry = {
  readonly nodeId: string;
  readonly label: string;
  readonly resourceKey: string;
  readonly resourceType: string | undefined;
  readonly diffState: DiffState;
};

export type LateralContext = {
  readonly dependsOn: readonly LateralDependencyEntry[];
  readonly dependedOnBy: readonly LateralDependencyEntry[];
};
