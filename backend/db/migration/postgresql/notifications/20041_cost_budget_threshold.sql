--------------UP
-- Actual-spend alerts are periodic and use a durable claim at
-- (rule, billing period, threshold). The claim is separate from notification
-- delivery: a retry cannot notify twice after a worker restart.

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
        'change_event', 'device_event'
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
        'change_event', 'device_event'
    ));

CREATE TABLE IF NOT EXISTS notifications.cost_budget_period_fires (
    organization_id VARCHAR NOT NULL,
    rule_id INTEGER NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    threshold_bps INTEGER NOT NULL CHECK (threshold_bps > 0),
    actual_cost DOUBLE PRECISION NOT NULL CHECK (actual_cost >= 0),
    budget_amount DOUBLE PRECISION NOT NULL CHECK (budget_amount > 0),
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, rule_id, period_start, threshold_bps),
    CONSTRAINT cost_budget_period_fires_rule_fk
        FOREIGN KEY (organization_id, rule_id)
        REFERENCES notifications.alert_rules (organization_id, id)
        ON DELETE CASCADE
);

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
          'record_incomplete', 'approaching_new_peak',
          'rate_of_change', 'stuck_sensor'
      );
$$;

-- Rollback disables evaluation but deliberately keeps the new kind and claim
-- rows forward-compatible. Narrowing either CHECK would delete customer rules
-- or alert history; dropping claims would repeat notifications after re-up.
-- This is the same safe rollback policy used by migration 20036.
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
        'change_event', 'device_event'
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
        'change_event', 'device_event'
    ));
