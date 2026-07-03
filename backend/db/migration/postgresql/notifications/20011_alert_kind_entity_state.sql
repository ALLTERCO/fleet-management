-- Adds 'entity_state' to the alert_rule / alert_instance kind CHECK
-- constraints. Pairs with the entityState evaluator (discrete-state sibling
-- of entity_threshold). entity_state uses the existing 'threshold' family, so
-- the condition_family constraint is unchanged.

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
        'entity_threshold',
        'entity_state',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
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
        'entity_threshold',
        'entity_state',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'heartbeat',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));

--------------DOWN

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
        'entity_threshold',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'heartbeat',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));

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
        'entity_threshold',
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'heartbeat',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));
