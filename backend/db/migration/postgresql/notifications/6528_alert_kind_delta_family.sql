--------------UP
-- Add 'rate_of_change' and 'stuck_sensor' to the kind/rule_kind CHECK
-- constraints. Both belong to the new delta family.

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
        'stuck_sensor'
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
        'firmware_operation_failed',
        'backup_operation_failed',
        'automation_run_failed',
        'heartbeat',
        'rate_of_change',
        'stuck_sensor'
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
        'heartbeat'
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
        'heartbeat'
    ));
