--------------UP
-- Scope ListReports to the caller's org in SQL and cap rows. NULL org = global
-- provider sees all; LEFT JOIN keeps orphaned instances visible to that view.
DROP FUNCTION IF EXISTS logging.get_report_instances();
CREATE FUNCTION logging.get_report_instances(
    p_organization_id VARCHAR DEFAULT NULL,
    p_limit INT DEFAULT NULL
)
RETURNS SETOF logging.report_instances
LANGUAGE sql
AS $$
  SELECT ri.id, ri.file_path, ri.report_config_id, ri."timestamp"
  FROM logging.report_instances ri
  LEFT JOIN logging.report_configs rc ON rc.id = ri.report_config_id
  WHERE p_organization_id IS NULL OR rc.organization_id = p_organization_id
  ORDER BY ri."timestamp" DESC
  LIMIT p_limit;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS logging.get_report_instances(VARCHAR, INT);
CREATE FUNCTION logging.get_report_instances()
RETURNS SETOF logging.report_instances
LANGUAGE sql
AS $$
  SELECT ri.id, ri.file_path, ri.report_config_id, ri."timestamp"
  FROM logging.report_instances ri
  ORDER BY ri."timestamp" DESC;
$$;
