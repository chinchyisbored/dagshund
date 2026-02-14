/**
 * Generates a very-large-complex-plan.json fixture for stress testing.
 * Run: bun tests/fixtures/generate-large-fixture.ts
 */

const BASE_PATH =
  "/Workspace/Users/databricks.squiggly592@passfwd.com/.bundle/dagshund-test-bundle/default";

// --- Job templates ---

/** ETL-style pipeline: linear chain of tasks */
const buildEtlJob = (name: string, action: string, jobId: number) => {
  const tasks = [
    { task_key: "extract", notebook_path: `/${name}/extract` },
    { task_key: "transform", depends_on: ["extract"], notebook_path: `/${name}/transform` },
    { task_key: "load", depends_on: ["transform"], notebook_path: `/${name}/load` },
    { task_key: "validate", depends_on: ["load"], notebook_path: `/${name}/validate` },
    { task_key: "publish", depends_on: ["validate"], notebook_path: `/${name}/publish` },
  ];
  return buildJob(name, action, jobId, tasks);
};

/** Quality-style pipeline: fan-out then fan-in */
const buildQualityJob = (name: string, action: string, jobId: number) => {
  const tasks = [
    { task_key: "setup", notebook_path: `/${name}/setup` },
    {
      task_key: "validate_schema",
      depends_on: ["setup"],
      notebook_path: `/${name}/validate_schema`,
    },
    {
      task_key: "check_nulls",
      depends_on: ["validate_schema"],
      notebook_path: `/${name}/check_nulls`,
    },
    {
      task_key: "check_duplicates",
      depends_on: ["validate_schema"],
      notebook_path: `/${name}/check_duplicates`,
    },
    {
      task_key: "check_referential",
      depends_on: ["validate_schema"],
      notebook_path: `/${name}/check_referential`,
    },
    {
      task_key: "check_ranges",
      depends_on: ["validate_schema"],
      notebook_path: `/${name}/check_ranges`,
    },
    {
      task_key: "aggregate",
      depends_on: ["check_nulls", "check_duplicates", "check_referential", "check_ranges"],
      notebook_path: `/${name}/aggregate`,
    },
    { task_key: "report", depends_on: ["aggregate"], notebook_path: `/${name}/report` },
    { task_key: "notify", depends_on: ["report"], notebook_path: `/${name}/notify` },
  ];
  return buildJob(name, action, jobId, tasks);
};

/** ML-style pipeline: feature eng + training + evaluation branches */
const buildMlJob = (name: string, action: string, jobId: number) => {
  const tasks = [
    { task_key: "fetch_data", notebook_path: `/${name}/fetch_data` },
    { task_key: "feature_eng", depends_on: ["fetch_data"], notebook_path: `/${name}/feature_eng` },
    { task_key: "split_data", depends_on: ["feature_eng"], notebook_path: `/${name}/split_data` },
    {
      task_key: "train_model_a",
      depends_on: ["split_data"],
      notebook_path: `/${name}/train_model_a`,
    },
    {
      task_key: "train_model_b",
      depends_on: ["split_data"],
      notebook_path: `/${name}/train_model_b`,
    },
    {
      task_key: "train_model_c",
      depends_on: ["split_data"],
      notebook_path: `/${name}/train_model_c`,
    },
    { task_key: "evaluate_a", depends_on: ["train_model_a"], notebook_path: `/${name}/evaluate_a` },
    { task_key: "evaluate_b", depends_on: ["train_model_b"], notebook_path: `/${name}/evaluate_b` },
    { task_key: "evaluate_c", depends_on: ["train_model_c"], notebook_path: `/${name}/evaluate_c` },
    {
      task_key: "select_best",
      depends_on: ["evaluate_a", "evaluate_b", "evaluate_c"],
      notebook_path: `/${name}/select_best`,
    },
    {
      task_key: "register_model",
      depends_on: ["select_best"],
      notebook_path: `/${name}/register_model`,
    },
    { task_key: "deploy", depends_on: ["register_model"], notebook_path: `/${name}/deploy` },
  ];
  return buildJob(name, action, jobId, tasks);
};

type TaskDef = {
  readonly task_key: string;
  readonly depends_on?: readonly string[];
  readonly notebook_path: string;
};

const buildJob = (name: string, action: string, jobId: number, tasks: readonly TaskDef[]) => {
  const newState = {
    value: {
      deployment: { kind: "BUNDLE", metadata_file_path: `${BASE_PATH}/state/metadata.json` },
      edit_mode: "UI_LOCKED",
      format: "MULTI_TASK",
      max_concurrent_runs: 1,
      name,
      queue: { enabled: true },
      tasks: tasks.map((t) => ({
        ...(t.depends_on ? { depends_on: t.depends_on.map((k) => ({ task_key: k })) } : {}),
        environment_key: "default",
        notebook_task: { notebook_path: `/Workspace${t.notebook_path}` },
        task_key: t.task_key,
      })),
    },
  };

  const entry: Record<string, unknown> = { action, new_state: newState };

  // Add remote_state for updates
  if (action === "update") {
    entry["remote_state"] = {
      created_time: 1770407353832,
      creator_user_name: "databricks.squiggly592@passfwd.com",
      job_id: jobId,
      run_as_user_name: "databricks.squiggly592@passfwd.com",
      settings: { ...newState.value },
    };
  }

  return entry;
};

/** Build a job with run_job_task referencing another job */
const buildOrchestratorJob = (
  name: string,
  action: string,
  jobId: number,
  targetJobs: readonly { readonly name: string; readonly jobId: number }[],
) => {
  const tasks = [
    {
      task_key: "prepare",
      environment_key: "default",
      notebook_task: { notebook_path: `/Workspace/${name}/prepare` },
    },
    ...targetJobs.map((target, i) => ({
      task_key: `trigger_${target.name}`,
      depends_on:
        i === 0 ? [{ task_key: "prepare" }] : [{ task_key: `trigger_${targetJobs[i - 1]?.name}` }],
      run_job_task: { job_id: target.jobId },
    })),
    {
      task_key: "finalize",
      depends_on: [{ task_key: `trigger_${targetJobs[targetJobs.length - 1]?.name}` }],
      environment_key: "default",
      notebook_task: { notebook_path: `/Workspace/${name}/finalize` },
    },
  ];

  const entry: Record<string, unknown> = {
    action,
    new_state: {
      value: {
        deployment: { kind: "BUNDLE", metadata_file_path: `${BASE_PATH}/state/metadata.json` },
        edit_mode: "UI_LOCKED",
        format: "MULTI_TASK",
        max_concurrent_runs: 1,
        name,
        queue: { enabled: true },
        tasks,
      },
    },
  };

  if (action === "update") {
    entry["remote_state"] = {
      created_time: 1770407353832,
      creator_user_name: "databricks.squiggly592@passfwd.com",
      job_id: jobId,
      run_as_user_name: "databricks.squiggly592@passfwd.com",
    };
  }

  return entry;
};

// --- Assembly ---

const plan: Record<string, unknown> = {};
let nextJobId = 900000000000001;
const actions = ["create", "update", "update", "update"] as const;
// biome-ignore lint/style/noNonNullAssertion: modulo guarantees index is in bounds
const pickAction = (i: number) => actions[i % actions.length]!;

// 10 ETL pipelines (5 tasks each = 50 tasks)
const etlJobs: { name: string; jobId: number }[] = [];
for (let i = 0; i < 10; i++) {
  const name = `etl_pipeline_${String(i + 1).padStart(2, "0")}`;
  const jobId = nextJobId++;
  plan[`resources.jobs.${name}`] = buildEtlJob(name, pickAction(i), jobId);
  etlJobs.push({ name, jobId });
}

// 8 Quality pipelines (9 tasks each = 72 tasks)
const qualityJobs: { name: string; jobId: number }[] = [];
for (let i = 0; i < 8; i++) {
  const name = `quality_check_${String(i + 1).padStart(2, "0")}`;
  const jobId = nextJobId++;
  plan[`resources.jobs.${name}`] = buildQualityJob(name, pickAction(i + 1), jobId);
  qualityJobs.push({ name, jobId });
}

// 6 ML pipelines (12 tasks each = 72 tasks)
for (let i = 0; i < 6; i++) {
  const name = `ml_training_${String(i + 1).padStart(2, "0")}`;
  const jobId = nextJobId++;
  plan[`resources.jobs.${name}`] = buildMlJob(name, pickAction(i + 2), jobId);
}

// 2 orchestrator jobs that trigger other jobs via run_job_task (cross-job edges)
plan["resources.jobs.nightly_orchestrator"] = buildOrchestratorJob(
  "nightly_orchestrator",
  "update",
  nextJobId++,
  etlJobs.slice(0, 4),
);

plan["resources.jobs.weekly_quality_sweep"] = buildOrchestratorJob(
  "weekly_quality_sweep",
  "create",
  nextJobId++,
  qualityJobs.slice(0, 3),
);

// A deleted job
plan["resources.jobs.deprecated_legacy_ingest"] = {
  action: "delete",
  remote_state: {
    created_time: 1770407353832,
    creator_user_name: "databricks.squiggly592@passfwd.com",
    job_id: nextJobId++,
    settings: {
      name: "deprecated_legacy_ingest",
      tasks: [
        { task_key: "ingest", notebook_task: { notebook_path: "/Workspace/legacy/ingest" } },
        {
          task_key: "transform",
          depends_on: [{ task_key: "ingest" }],
          notebook_task: { notebook_path: "/Workspace/legacy/transform" },
        },
        {
          task_key: "load",
          depends_on: [{ task_key: "transform" }],
          notebook_task: { notebook_path: "/Workspace/legacy/load" },
        },
      ],
    },
  },
};

// Some non-job resources for the resources tab
plan["resources.schemas.analytics"] = {
  action: "update",
  new_state: {
    value: { catalog_name: "dagshund", name: "analytics", comment: "Production analytics" },
  },
  remote_state: { catalog_name: "dagshund", name: "analytics", comment: "Analytics" },
  changes: { comment: { action: "update", old: "Analytics", new: "Production analytics" } },
};

plan["resources.schemas.staging"] = {
  action: "create",
  new_state: {
    value: { catalog_name: "dagshund", name: "staging", comment: "Staging environment" },
  },
};

plan["resources.volumes.raw_data"] = {
  action: "update",
  depends_on: [
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Databricks interpolation syntax, not a JS template literal
    { node: "resources.schemas.analytics", label: "${resources.schemas.analytics.name}" },
  ],
  new_state: {
    value: {
      catalog_name: "dagshund",
      schema_name: "analytics",
      name: "raw_data",
      volume_type: "MANAGED",
    },
  },
  remote_state: {
    catalog_name: "dagshund",
    schema_name: "analytics",
    name: "raw_data",
    volume_type: "MANAGED",
  },
};

plan["resources.registered_models.forecasting"] = {
  action: "create",
  new_state: { value: { catalog_name: "dagshund", schema_name: "analytics", name: "forecasting" } },
};

plan["resources.registered_models.anomaly_detector"] = {
  action: "delete",
  remote_state: {
    catalog_name: "dagshund",
    schema_name: "analytics",
    name: "anomaly_detector",
    full_name: "dagshund.analytics.anomaly_detector",
  },
};

// --- Output ---

const fixture = {
  plan_version: 2,
  cli_version: "0.287.0",
  lineage: "stress-test-fixture",
  serial: 1,
  plan,
};

const totalJobs = Object.keys(plan).filter((k) => k.startsWith("resources.jobs.")).length;
const totalTasks = Object.values(plan)
  .map((v) => {
    const entry = v as Record<string, unknown>;
    const newState = entry["new_state"] as { value?: { tasks?: unknown[] } } | undefined;
    return newState?.value?.tasks?.length ?? 0;
  })
  .reduce((a, b) => a + b, 0);

const outputPath = `${import.meta.dir}/very-large-complex-plan.json`;
await Bun.write(outputPath, JSON.stringify(fixture, null, 2));

console.log(`Generated ${outputPath}`);
console.log(`  ${totalJobs} jobs, ${totalTasks} tasks`);
