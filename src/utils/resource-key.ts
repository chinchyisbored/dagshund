/** Extract the short resource name from a resource key (last dot-segment). */
export const extractResourceName = (resourceKey: string): string => {
  const segments = resourceKey.split(".");
  return segments[segments.length - 1] ?? resourceKey;
};
