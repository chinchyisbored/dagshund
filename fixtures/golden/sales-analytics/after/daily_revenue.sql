-- Illustrative source only. The fixture never executes this query.
CREATE OR REPLACE TABLE ${var.catalog_name}.sales_reporting.daily_sales AS
SELECT
  business_date,
  SUM(net_amount) AS revenue,
  SUM(return_amount) / NULLIF(SUM(gross_amount), 0) AS return_rate
FROM ${var.catalog_name}.sales_staging.order_lines
WHERE business_date >= date_sub(current_date(), :reporting_window_days)
GROUP BY business_date;
