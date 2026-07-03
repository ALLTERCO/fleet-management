--------------UP
ALTER TABLE notifications.alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_kind_valid;
ALTER TABLE notifications.alert_rules
    ADD CONSTRAINT alert_rules_kind_valid
    CHECK (kind IN (
        'device_offline',
        'device_back_online',
        'battery_below',
        'smoke_alarm',
        'flood_alarm',
        'motion_detected',
        'component_threshold',
        'component_state',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'grafana_alert',
        'heartbeat',
        'energy_consumption_threshold',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_rule_kind_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_rule_kind_valid
    CHECK (rule_kind IN (
        'device_offline',
        'device_back_online',
        'battery_below',
        'smoke_alarm',
        'flood_alarm',
        'motion_detected',
        'component_threshold',
        'component_state',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'grafana_alert',
        'heartbeat',
        'energy_consumption_threshold',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));

INSERT INTO notifications.alert_rule_templates (
    template_key, category, label, description,
    kind, severity, config, dedupe_window_sec, cooldown_sec,
    summary_template, message_template, auto_resolve
) VALUES
    ('builtin:consumption_above_5kwh_1h', 'Energy',
     'Consumption above 5 kWh in 1 hour',
     'Fires when persisted energy history shows more than 5 kWh consumed in the last hour.',
     'energy_consumption_threshold', 'warning',
     '{"windowSec":3600,"operator":"gt","thresholdKWh":5}'::jsonb,
     900, 1800, 'High hourly consumption at {{device.name}}',
     '{{device.name}} consumed more than 5 kWh in the last hour.', TRUE),

    ('builtin:consumption_above_20kwh_24h', 'Energy',
     'Consumption above 20 kWh in 24 hours',
     'Fires when persisted energy history shows more than 20 kWh consumed in the last 24 hours.',
     'energy_consumption_threshold', 'warning',
     '{"windowSec":86400,"operator":"gt","thresholdKWh":20}'::jsonb,
     3600, 7200, 'High daily consumption at {{device.name}}',
     '{{device.name}} consumed more than 20 kWh in the last 24 hours.', TRUE)
ON CONFLICT (COALESCE(organization_id, ''), template_key) DO UPDATE
SET category = EXCLUDED.category,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    kind = EXCLUDED.kind,
    severity = EXCLUDED.severity,
    config = EXCLUDED.config,
    dedupe_window_sec = EXCLUDED.dedupe_window_sec,
    cooldown_sec = EXCLUDED.cooldown_sec,
    summary_template = EXCLUDED.summary_template,
    message_template = EXCLUDED.message_template,
    auto_resolve = EXCLUDED.auto_resolve
WHERE notifications.alert_rule_templates.organization_id IS NULL;

--------------DOWN
DELETE FROM notifications.alert_rule_templates
WHERE organization_id IS NULL
  AND template_key IN (
    'builtin:consumption_above_5kwh_1h',
    'builtin:consumption_above_20kwh_24h'
  );

ALTER TABLE notifications.alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_kind_valid;
ALTER TABLE notifications.alert_rules
    ADD CONSTRAINT alert_rules_kind_valid
    CHECK (kind IN (
        'device_offline',
        'device_back_online',
        'battery_below',
        'smoke_alarm',
        'flood_alarm',
        'motion_detected',
        'component_threshold',
        'component_state',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'grafana_alert',
        'heartbeat',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_rule_kind_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_rule_kind_valid
    CHECK (rule_kind IN (
        'device_offline',
        'device_back_online',
        'battery_below',
        'smoke_alarm',
        'flood_alarm',
        'motion_detected',
        'component_threshold',
        'component_state',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'grafana_alert',
        'heartbeat',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));
