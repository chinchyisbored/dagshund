import type { DagNodeData } from "../types/graph-types.ts";
import { extractPhantomBadge, extractTypeBadge } from "./resource-key.ts";
import { extractTaskTypeBadge } from "./task-type.ts";

/** Collect all badge strings for a node (type badge, task type badge, phantom badge). */
const collectBadges = (data: DagNodeData): string[] => {
  const badges: string[] = [];

  if (data.nodeKind === "phantom") {
    const phantomBadge = extractPhantomBadge(data.resourceKey);
    if (phantomBadge !== undefined) badges.push(phantomBadge);
  } else {
    const typeBadge = extractTypeBadge(data.resourceKey);
    if (typeBadge !== undefined) badges.push(typeBadge);
  }

  if (data.nodeKind === "task") {
    const taskBadge = extractTaskTypeBadge(data.resourceState);
    if (taskBadge !== undefined) badges.push(taskBadge);
  }

  return badges;
};

export type NodeSearchEntry = {
  readonly text: string;
  readonly badgeText: string;
  readonly label: string;
  readonly diffState: string;
};

/** Build search strings for a node: full text (label + badges) and badge-only text. */
export const extractNodeSearchText = (data: DagNodeData): NodeSearchEntry => {
  const badges = collectBadges(data);
  return {
    text: [data.label, ...badges].join("\0").toLowerCase(),
    badgeText: badges.join("\0").toLowerCase(),
    label: data.label.toLowerCase(),
    diffState: data.diffState.toLowerCase(),
  };
};
