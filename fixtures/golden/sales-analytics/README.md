# Sales analytics reporting and access-change fixture

This fixture describes a paused weekday sales reporting job and a managed dashboard/alert. Its SQL, dashboard content, and validation task are illustrative sources only. They do not represent real business queries or claim that data was processed, an alert evaluated, or a notification delivered.

## Before and after

Both states own the `sales_staging` and `sales_reporting` schemas, `sales_reporting` job, `sales_overview` dashboard, and `high_return_rate` alert. The job validates inputs, then calculates daily revenue and regional performance in parallel before refreshing the dashboard. In the after state, a returns calculation joins that fan-in; alert evaluation follows the dashboard refresh. The reporting window changes from 7 to 30 days, and the alert threshold changes from 5% to 3%.

The existing revenue task's `reporting_window_days` SQL parameter changes from `7` to `30`, and the illustrative query consumes that parameter. The after state grants `data_analysts` `USE_SCHEMA` and `SELECT` on both owned schemas and `CAN_RUN` on the dashboard. It adds the authenticated workspace caller as an alert subscriber through the native `workspace.current_user.userName` binding, mapped to the pinned AlertV2Subscription `user_email` field. No principal or email is stored in fixture data.

The job and alert schedules are weekdays at 08:00 UTC and explicitly `PAUSED`. Both configurations reuse the existing warehouse `9d0afa601cb95187`, catalog `dagshund`, and `data_analysts` group via `../../externals.yaml`. These are external prerequisites, not fixture-owned resources; do not start, modify, or remove them.

## Captured evidence and lifecycle boundary

`plan.json` is the genuine CLI 1.20.0 plan from the approved named cycle. Its after deployment updated the job, dashboard, and alert; created schema grants and dashboard permissions; and left the two schemas unchanged. The capture records the alert task's `alert_id` as `1563840667367381` (managed alert `high_return_rate`, historical ID) and the job API ID `50978471212936`. These IDs identify the captured plan only and are not authority to delete live resources.

The cycle destroyed its five owned resources and independently confirmed the schemas, job, alert, and isolated bundle root absent. The dashboard is service-TRASHED; physical purge/retention is not claimed. The external warehouse `9d0afa601cb95187` remains STOPPED and was not removed. No job, SQL, dashboard refresh, alert evaluation, or notification was executed. SQL, dashboard content, and validation code are illustrative and make no business-result claim.

Graph consumer coverage records six configured task nodes and dashboard/warehouse relationships. Current public graph builders do not resolve `tasks[].alert_task.alert_id` to the captured managed alert: the input identity is genuine, while the intended task-to-alert edge remains a follow-up for `dagshund-92hu.2`. Notification configuration is also not evidence of delivery. See the G2 row in `fixtures/COVERAGE.md` and the captured-cycle evidence retained in the workflow evidence directory for provenance and teardown details.
