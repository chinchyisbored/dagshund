-- Illustrative source only. The fixture never executes this query.
CREATE OR REPLACE TABLE ${var.catalog_name}.sales_reporting.regional_performance AS
SELECT region, SUM(net_amount) AS revenue
FROM ${var.catalog_name}.sales_staging.order_lines
WHERE business_date >= date_sub(current_date(), 30)
GROUP BY region;
