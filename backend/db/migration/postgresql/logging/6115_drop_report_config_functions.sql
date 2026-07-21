--------------UP
-- LINT-IGNORE: additive-only (deliberate legacy function removal)
-- Drop the dead legacy report-config / report-instance SQL functions. They have
-- no caller: the AddReportConfig RPC is gone and report_instances is never
-- written. Superseded by the async report job system (Report.Generate +
-- exportJobStore) and the ReportTemplate saved-report system. The empty
-- report_configs / report_instances TABLES are left in place — this repo's
-- migration policy is additive-only (no DROP TABLE); the tables carry no data
-- and no code references them. IF EXISTS keeps this idempotent.

DROP FUNCTION IF EXISTS logging.add_report_config(VARCHAR, JSONB);
DROP FUNCTION IF EXISTS logging.add_report_config(VARCHAR, JSONB, VARCHAR);
DROP FUNCTION IF EXISTS logging.add_report_config(VARCHAR, JSONB, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS logging.update_report_config(INT, VARCHAR, JSONB);
DROP FUNCTION IF EXISTS logging.delete_report_config(INT);
DROP FUNCTION IF EXISTS logging.delete_report_config(INT, VARCHAR);
DROP FUNCTION IF EXISTS logging.get_report_config(INT);
DROP FUNCTION IF EXISTS logging.get_report_configs();
DROP FUNCTION IF EXISTS logging.get_report_configs(VARCHAR);

DROP FUNCTION IF EXISTS logging.add_report_instance(TEXT, INT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS logging.update_report_instance(INT, TEXT, INT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS logging.delete_report_instance(INT);
DROP FUNCTION IF EXISTS logging.delete_all_report_instances();
DROP FUNCTION IF EXISTS logging.get_report_instance(INT);
DROP FUNCTION IF EXISTS logging.get_report_instances();
DROP FUNCTION IF EXISTS logging.get_report_instances(VARCHAR, INT);
DROP FUNCTION IF EXISTS logging.get_report_instances_by_config(INT);
--------------DOWN
SELECT 1;
