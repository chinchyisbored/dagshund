/** Map known Databricks task type keys to short display badges. */
const TASK_TYPE_BADGES: Readonly<Record<string, string>> = {
  notebook_task: "notebook",
  python_wheel_task: "wheel",
  run_job_task: "run job",
  sql_task: "sql",
  dbt_task: "dbt",
  pipeline_task: "pipeline",
  spark_jar_task: "spark jar",
  spark_python_task: "spark py",
  spark_submit_task: "spark submit",
  condition_task: "condition",
  for_each_task: "for each",
  clean_rooms_notebook_task: "clean room",
  dashboard_task: "dashboard",
  power_bi_task: "power bi",
};

/** Derive a short task type badge from a task's resource state.
 *  Detects the type by checking which known `_task` key is present.
 *  Returns undefined when no task type key is found. */
export const extractTaskTypeBadge = (
  resourceState: Readonly<Record<string, unknown>> | undefined,
): string | undefined => {
  if (resourceState === undefined) return undefined;

  for (const key of Object.keys(resourceState)) {
    const badge = TASK_TYPE_BADGES[key];
    if (badge !== undefined) return badge;
  }

  // Fallback: first key ending in _task, strip suffix, underscores → spaces
  for (const key of Object.keys(resourceState)) {
    if (key.endsWith("_task")) {
      return key.slice(0, -5).replaceAll("_", " ");
    }
  }

  return undefined;
};
