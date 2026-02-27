import type { Node } from "@xyflow/react";
import type { DagNodeData } from "../types/graph-types.ts";

/** React Flow types node.data as Record<string, unknown>; our nodes carry DagNodeData.
 *  The cast is unavoidable because React Flow's generic param doesn't propagate to event handlers. */
export const getNodeData = (node: Node): DagNodeData => node.data as DagNodeData;
