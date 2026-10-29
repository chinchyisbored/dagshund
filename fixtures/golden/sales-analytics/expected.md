### dagshund plan (v2, cli 1.20.0)

#### alerts (1)
- `~` `alerts/high_return_rate` — update
  - `+` `evaluation.notification`: \{subscriptions: \[\{user\_email: "user1@example.com"\}\]\}
  - `~` `evaluation.threshold.value.double_value`: 0.05 -&gt; 0.03
  - `~` `query_text`: ... -&gt; ...

#### dashboards (1)
- `~` `dashboards/sales_overview` — update
  - `+` `permissions`: \{2 fields\}
  - `~` `serialized_dashboard`: ... -&gt; ...

#### jobs (1)
- `~` `jobs/sales_reporting` — update
  - `~` `tasks[task_key='calculate_daily_revenue'].sql_task.parameters['reporting_window_days']`: "7" -&gt; "30"
  - `+` `tasks[task_key='calculate_returns']`: \{3 fields\}
  - `+` `tasks[task_key='evaluate_return_rate']`: \{3 fields\}
  - `+` `tasks[task_key='refresh_sales_dashboard'].depends_on[task_key='calculate_returns']`: \{task\_key: "calculate\_returns"\}

#### schemas (2)
- `~` `schemas/reporting` — update
  - `+` `grants`: \{3 fields\}
- `~` `schemas/staging` — update
  - `+` `grants`: \{3 fields\}

**~5** update
