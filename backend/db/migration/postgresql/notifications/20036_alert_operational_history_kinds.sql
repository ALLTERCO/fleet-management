--------------UP
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
        'energy_consumption_threshold', 'record_incomplete',
        'approaching_new_peak', 'rate_of_change', 'stuck_sensor',
        'composite', 'anomaly_band', 'change_event', 'device_event'
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
        'energy_consumption_threshold', 'record_incomplete',
        'approaching_new_peak', 'rate_of_change', 'stuck_sensor',
        'composite', 'anomaly_band', 'change_event', 'device_event'
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
          'record_incomplete', 'approaching_new_peak',
          'rate_of_change', 'stuck_sensor'
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
          'rate_of_change', 'stuck_sensor'
      );
$$;

-- Keep the storage allowlist forward-compatible on rollback. Removing these
-- values would require deleting customer rules and alert history; rolling back
-- the evaluator instead leaves those rows inert and recoverable.
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
        'energy_consumption_threshold', 'record_incomplete',
        'approaching_new_peak', 'rate_of_change', 'stuck_sensor',
        'composite', 'anomaly_band', 'change_event', 'device_event'
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
        'energy_consumption_threshold', 'record_incomplete',
        'approaching_new_peak', 'rate_of_change', 'stuck_sensor',
        'composite', 'anomaly_band', 'change_event', 'device_event'
    ));
