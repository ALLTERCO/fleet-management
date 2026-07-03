--------------UP
-- Phase 3 condition model: three families (threshold, inactivity, delta)
-- + the trivial event kinds. Each existing legacy kind maps onto exactly
-- one (family, subkind) pair. Old kind stays as the source of truth for
-- evaluator dispatch this phase — Phase 4 cuts dispatch over to the
-- new pair.

ALTER TABLE notifications.alert_rules
    ADD COLUMN IF NOT EXISTS condition_family   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS condition_subkind  VARCHAR(40);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'notifications'
          AND table_name = 'alert_rules'
          AND constraint_name = 'alert_rules_condition_family_valid'
    ) THEN
        ALTER TABLE notifications.alert_rules
            ADD CONSTRAINT alert_rules_condition_family_valid
            CHECK (condition_family IS NULL OR condition_family IN (
                'threshold', 'inactivity', 'delta', 'event', 'composite', 'anomaly'
            ));
    END IF;
END $$;

UPDATE notifications.alert_rules
SET condition_family = CASE kind
        WHEN 'battery_below'             THEN 'threshold'
        WHEN 'entity_threshold'          THEN 'threshold'
        WHEN 'device_offline'            THEN 'inactivity'
        ELSE                                  'event'
    END,
    condition_subkind = CASE kind
        WHEN 'battery_below'             THEN 'battery'
        WHEN 'entity_threshold'          THEN 'custom'
        WHEN 'device_offline'            THEN 'offline'
        WHEN 'device_back_online'        THEN 'device_back_online'
        WHEN 'smoke_alarm'               THEN 'smoke_alarm'
        WHEN 'flood_alarm'               THEN 'flood_alarm'
        WHEN 'motion_detected'           THEN 'motion_detected'
        WHEN 'firmware_operation_failed' THEN 'firmware_operation_failed'
        WHEN 'backup_operation_failed'   THEN 'backup_operation_failed'
        WHEN 'automation_run_failed'     THEN 'automation_run_failed'
        ELSE                                  kind
    END
WHERE condition_family IS NULL;

CREATE INDEX IF NOT EXISTS alert_rules_condition_family_idx
    ON notifications.alert_rules (organization_id, condition_family, enabled);

--------------DOWN
DROP INDEX IF EXISTS notifications.alert_rules_condition_family_idx;
ALTER TABLE notifications.alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_condition_family_valid;
ALTER TABLE notifications.alert_rules
    DROP COLUMN IF EXISTS condition_family;
ALTER TABLE notifications.alert_rules
    DROP COLUMN IF EXISTS condition_subkind;
