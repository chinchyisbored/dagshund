import type { Edge, Node } from "@xyflow/react";

export type LayoutResult = {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly lateralEdges?: readonly Edge[];
};
