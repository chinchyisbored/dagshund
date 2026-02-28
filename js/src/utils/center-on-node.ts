import type { ReactFlowInstance } from "@xyflow/react";

/** Center the viewport on a specific node, preserving current zoom.
 *  Returns false if the node is not found in React Flow's internal store. */
export const centerOnNode = (
  instance: ReactFlowInstance,
  nodeId: string,
  options?: { readonly duration?: number },
): boolean => {
  const internal = instance.getInternalNode(nodeId);
  if (internal === undefined) return false;
  const zoom = instance.getZoom();
  const { x, y } = internal.internals.positionAbsolute;
  const width = internal.measured.width ?? 200;
  const height = internal.measured.height ?? 56;
  instance.setCenter(x + width / 2, y + height / 2, { duration: options?.duration ?? 300, zoom });
  return true;
};
