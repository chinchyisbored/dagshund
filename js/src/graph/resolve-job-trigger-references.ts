import type { ReferenceResolution } from "../types/reference-resolution.ts";
import { extractResourceType } from "../utils/resource-key.ts";
import { parseThreePartName } from "./extract-resource-state.ts";
import type { ReferenceResolutionContext } from "./reference-resolution-context.ts";
import { resolveVolumeReference } from "./resolve-volume-reference.ts";

const parseVolumeUrl = (url: string): string | undefined => {
  const match = /^\/Volumes\/([^/]+)\/([^/]+)\/([^/]+)(?:\/.*)?$/.exec(url);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined)
    return undefined;
  const fullName = `${match[1]}.${match[2]}.${match[3]}`;
  return parseThreePartName(fullName) === undefined ? undefined : fullName;
};

export const resolveJobTriggerReferences = (
  sourceResourceKey: string,
  context: ReferenceResolutionContext,
): readonly ReferenceResolution[] => {
  if (extractResourceType(sourceResourceKey) !== "jobs") return [];
  const job = context.preparedPlan.byResourceKey.get(sourceResourceKey)?.job;
  if (job?.status !== "supported" || job.value.fileArrivalUrl.status !== "supported") return [];
  const fullName = parseVolumeUrl(job.value.fileArrivalUrl.value);
  return fullName === undefined
    ? []
    : [resolveVolumeReference(sourceResourceKey, fullName, context)];
};
