import type { NodeProps } from "@xyflow/react";

// React Flow's NodeProps is parameterised over a full Node<TData, TType> with
// many runtime-only fields (position, selected, dragging, …) the node
// components never read. Fabricating those just to satisfy the compiler in
// tests adds noise without catching bugs. Centralise the single cast here so
// individual tests stay focused on the data they actually care about.
// biome-ignore lint/suspicious/noExplicitAny: see note above
type LooseNodeProps = NodeProps<any>;

export const makeNodeProps = <TData>(id: string, data: TData): LooseNodeProps =>
  ({ id, data }) as unknown as LooseNodeProps;
