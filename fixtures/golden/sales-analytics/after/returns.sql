-- Illustrative source only. The fixture never executes this query.
CREATE OR REPLACE TABLE ${var.catalog_name}.sales_reporting.daily_returns AS
SELECT business_date, SUM(return_amount) AS returns
FROM ${var.catalog_name}.sales_staging.order_lines
WHERE business_date >= date_sub(current_date(), 30)
GROUP BY business_date;
