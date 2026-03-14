import type { Node, ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { centerOnNode } from "../utils/center-on-node.ts";

type ViewportPositioningOptions = {
  readonly baseNodes: readonly Node[];
  readonly isVisible: boolean;
  readonly focusNodeId?: string | null;
  readonly onFocusComplete?: () => void;
  readonly isLayoutReady: boolean;
  readonly directMatchIds: ReadonlySet<string> | null;
};

type ViewportPositioningResult = {
  readonly hasFitted: boolean;
  readonly handleInit: (instance: ReactFlowInstance) => void;
  readonly handleFitView: () => void;
  readonly centerOnNode: (nodeId: string) => void;
};

/** Owns all viewport positioning: initial fit-view, cross-tab focus,
 *  single-match centering, and manual centering on node click/navigate. */
export function useViewportPositioning({
  baseNodes,
  isVisible,
  focusNodeId,
  onFocusComplete,
  isLayoutReady,
  directMatchIds,
}: ViewportPositioningOptions): ViewportPositioningResult {
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  // Never reset — safe because FlowCanvas remounts when the plan changes (keyed on plan identity).
  const hasFittedRef = useRef(false);
  const [hasFitted, setHasFitted] = useState(false);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;
  }, []);

  const handleFitView = useCallback(() => {
    rfInstanceRef.current?.fitView();
  }, []);

  const handleCenterOnNode = useCallback((nodeId: string) => {
    const instance = rfInstanceRef.current;
    if (instance !== null) centerOnNode(instance, nodeId);
  }, []);

  /** Fit the viewport exactly once after the layout produces nodes.
   *  Skipped when focusNodeId is set — the focus effect handles viewport positioning instead.
   *  Deferred until isVisible is true so tabs rendered with display:none don't fitView
   *  against a zero-size container. Uses rAF + setTimeout so React Flow's ResizeObserver
   *  has time to measure node dimensions — especially job group containers which need
   *  multiple measurement passes. */
  useEffect(() => {
    if (rfInstanceRef.current && baseNodes.length > 0 && isVisible && !hasFittedRef.current) {
      if (focusNodeId != null) {
        hasFittedRef.current = true;
        setHasFitted(true);
        return;
      }
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const frameId = requestAnimationFrame(() => {
        timerId = setTimeout(() => {
          hasFittedRef.current = true;
          rfInstanceRef.current?.fitView({ maxZoom: 1, padding: 0.15 });
          setHasFitted(true);
        }, 50);
      });
      return () => {
        cancelAnimationFrame(frameId);
        if (timerId !== undefined) clearTimeout(timerId);
      };
    }
  }, [baseNodes, focusNodeId, isVisible]);

  /** Pan to a specific node when focusNodeId is set (cross-tab navigation).
   *  Waits for layout to be ready so the node exists in React Flow's internal store.
   *  Uses setTimeout rather than rAF because the tab container transitions from
   *  display:none to visible on navigation — React Flow's ResizeObserver needs
   *  time to recalculate before setCenter can position correctly. */
  useEffect(() => {
    if (focusNodeId === null || focusNodeId === undefined) return;
    if (!isLayoutReady) return;
    const timerId = setTimeout(() => {
      const instance = rfInstanceRef.current;
      if (instance === null) return;
      if (centerOnNode(instance, focusNodeId)) {
        onFocusComplete?.();
      }
    }, 50);
    return () => clearTimeout(timerId);
  }, [focusNodeId, onFocusComplete, isLayoutReady]);

  /** Center when search narrows to a single top-level match.
   *  Matches whose parent is also matched are collapsed (e.g. job + its tasks → job). */
  useEffect(() => {
    if (directMatchIds === null || directMatchIds.size === 0) return;

    // Collapse: remove matches whose parent is also matched.
    const topLevel: string[] = [];
    for (const node of baseNodes) {
      if (!directMatchIds.has(node.id)) continue;
      if (node.parentId !== undefined && directMatchIds.has(node.parentId)) continue;
      topLevel.push(node.id);
    }
    if (topLevel.length !== 1) return;

    const instance = rfInstanceRef.current;
    const target = topLevel[0];
    if (instance === null || target === undefined) return;
    centerOnNode(instance, target);
  }, [baseNodes, directMatchIds]);

  return { hasFitted, handleInit, handleFitView, centerOnNode: handleCenterOnNode };
}
