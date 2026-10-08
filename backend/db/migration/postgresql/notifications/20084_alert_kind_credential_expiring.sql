--------------UP
-- Adds 'credential_expiring' to the alert_rule / alert_instance CHECK
-- constraints and to the sweep-org filter. The kind is sweep-only: it reads
-- the ingress credential table, so no device event can fire or clear it.

ALTER TABLE notifications.alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_kind_valid;
ALTER TABLE notifications.alert_rules
    ADD CONSTRAINT alert_rules_kind_valid
    CHECK (kind IN (
        'device_offline', 'device_back_online', 'battery_below',
        'smoke_alarm', 'flood_alarm', 'motion_detected',
        'component_threshold', 'component_state',
        'firmware_operation_failed', 'backup_operation_failed',
        'automation_run_failed', 'grafana_alert', 'heartbeat',
        'energy_consumption_threshold', 'cost_budget_threshold',
        'record_incomplete', 'approaching_new_peak',
        'rate_of_change', 'stuck_sensor', 'composite', 'anomaly_band',
        'change_event', 'device_event', 'credential_expiring'
    ));

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_rule_kind_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_rule_kind_valid
    CHECK (rule_kind IN (
        'device_offline', 'device_back_online', 'battery_below',
        'smoke_alarm', 'flood_alarm', 'motion_detected',
        'component_threshold', 'component_state',
        'firmware_operation_failed', 'backup_operation_failed',
        'automation_run_failed', 'grafana_alert', 'heartbeat',
        'energy_consumption_threshold', 'cost_budget_threshold',
        'record_incomplete', 'approaching_new_peak',
        'rate_of_change', 'stuck_sensor', 'composite', 'anomaly_band',
        'change_event', 'device_event', 'credential_expiring'
    ));

CREATE OR REPLACE FUNCTION notifications.fn_alert_sweep_orgs()
RETURNS TABLE (organization_id VARCHAR)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT r.organization_id
    FROM notifications.alert_rules r
    WHERE r.enabled
      AND r.deleted_at IS NULL
      AND r.kind IN (
          'device_offline', 'heartbeat', 'energy_consumption_threshold',
          'cost_budget_threshold', 'record_incomplete',
          'approaching_new_peak', 'rate_of_change', 'stuck_sensor',
          'credential_expiring'
      );
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION notifications.fn_alert_sweep_orgs()
RETURNS TABLE (organization_id VARCHAR)
LANGUAGE sql STABLE
AS $$
    SELECT DISTINCT r.organization_id
    FROM notifications.alert_rules r
    WHERE r.enabled
      AND r.deleted_at IS NULL
      AND r.kind IN (
          'device_offline', 'heartbeat', 'energy_consumption_threshold',
          'cost_budget_threshold', 'record_incomplete',
          'approaching_new_peak', 'rate_of_change', 'stuck_sensor'
      );
$$;

-- Rollback stops evaluation but deliberately keeps the new kind in both
-- CHECKs. Narrowing either one would delete customer rules or alert history.
-- Same safe rollback policy as migrations 20036 and 20041.
ALTER TABLE notifications.alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_kind_valid;
ALTER TABLE notifications.alert_rules
    ADD CONSTRAINT alert_rules_kind_valid
    CHECK (kind IN (
        'device_offline', 'device_back_online', 'battery_below',
        'smoke_alarm', 'flood_alarm', 'motion_detected',
        'component_threshold', 'component_state',
        'firmware_operation_failed', 'backup_operation_failed',
        'automation_run_failed', 'grafana_alert', 'heartbeat',
        'energy_consumption_threshold', 'cost_budget_threshold',
        'record_incomplete', 'approaching_new_peak',
        'rate_of_change', 'stuck_sensor', 'composite', 'anomaly_band',
        'change_event', 'device_event', 'credential_expiring'
    ));

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_rule_kind_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_rule_kind_valid
    CHECK (rule_kind IN (
        'device_offline', 'device_back_online', 'battery_below',
        'smoke_alarm', 'flood_alarm', 'motion_detected',
        'component_threshold', 'component_state',
        'firmware_operation_failed', 'backup_operation_failed',
        'automation_run_failed', 'grafana_alert', 'heartbeat',
        'energy_consumption_threshold', 'cost_budget_threshold',
        'record_incomplete', 'approaching_new_peak',
        'rate_of_change', 'stuck_sensor', 'composite', 'anomaly_band',
        'change_event', 'device_event', 'credential_expiring'
    ));
