const RESOURCES_PREFIX = "resources.";

/** Strip the "resources." prefix from resource keys for cleaner display. */
export const formatJsonBlockLabel = (label: string): string =>
  label.startsWith(RESOURCES_PREFIX) ? label.slice(RESOURCES_PREFIX.length) : label;
