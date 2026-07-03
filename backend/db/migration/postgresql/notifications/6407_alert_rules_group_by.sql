--------------UP
-- Phase 0 of alert-grouping: per-rule override of the FM_ALERT_GROUP_BY
-- label set. NULL = use env default. Additive, no value change.

ALTER TABLE notifications.alert_rules
    ADD COLUMN group_by TEXT[];

COMMENT ON COLUMN notifications.alert_rules.group_by IS
    'CSV-style override of FM_ALERT_GROUP_BY label names. NULL = use env default. Example: [''organization_id'', ''rule_id'', ''severity'']';

--------------DOWN
ALTER TABLE notifications.alert_rules
    DROP COLUMN IF EXISTS group_by;
