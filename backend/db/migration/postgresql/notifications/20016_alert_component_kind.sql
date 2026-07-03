-- Rename alert rule component watchers from the old "entity" wording to the
-- public component wording. Organization entity subjects remain unchanged.

--------------UP

ALTER TABLE notifications.alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_kind_valid;
ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_rule_kind_valid;

UPDATE notifications.alert_rules
SET kind = CASE kind
        WHEN 'entity_threshold' THEN 'component_threshold'
        WHEN 'entity_state' THEN 'component_state'
        ELSE kind
    END,
    condition_subkind = CASE condition_subkind
        WHEN 'entity_state' THEN 'component_state'
        ELSE condition_subkind
    END
WHERE kind IN ('entity_threshold', 'entity_state')
   OR condition_subkind = 'entity_state';

UPDATE notifications.alert_instances
SET rule_kind = CASE rule_kind
        WHEN 'entity_threshold' THEN 'component_threshold'
        WHEN 'entity_state' THEN 'component_state'
        ELSE rule_kind
    END
WHERE rule_kind IN ('entity_threshold', 'entity_state');

UPDATE notifications.alert_rule_templates
SET kind = CASE kind
        WHEN 'entity_threshold' THEN 'component_threshold'
        WHEN 'entity_state' THEN 'component_state'
        ELSE kind
    END
WHERE kind IN ('entity_threshold', 'entity_state');

UPDATE notifications.alert_rules
SET config = jsonb_set(
        config,
        '{component}',
        to_jsonb('component:' || substring(config->>'component' FROM 8)),
        false
    )
WHERE config->>'component' LIKE 'entity:%';

UPDATE notifications.alert_rule_templates
SET config = jsonb_set(
        config,
        '{component}',
        to_jsonb('component:' || substring(config->>'component' FROM 8)),
        false
    )
WHERE config->>'component' LIKE 'entity:%';

WITH merged AS (
    SELECT
        r.id,
        COALESCE(jsonb_agg(DISTINCT ids.value ORDER BY ids.value), '[]'::jsonb) AS component_ids
    FROM notifications.alert_rules r
    CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(r.scope->'componentIds', '[]'::jsonb) ||
        COALESCE(r.scope->'entityIds', '[]'::jsonb)
    ) ids(value)
    WHERE r.scope ? 'entityIds'
    GROUP BY r.id
)
UPDATE notifications.alert_rules r
SET scope = (r.scope - 'entityIds' - 'componentIds') ||
            jsonb_build_object('componentIds', merged.component_ids)
FROM merged
WHERE r.id = merged.id;

UPDATE notifications.alert_rules
SET scope = scope - 'entityIds'
WHERE scope ? 'entityIds';

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

--------------DOWN

ALTER TABLE notifications.alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_kind_valid;
ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_rule_kind_valid;

UPDATE notifications.alert_rules
SET kind = CASE kind
        WHEN 'component_threshold' THEN 'entity_threshold'
        WHEN 'component_state' THEN 'entity_state'
        ELSE kind
    END,
    condition_subkind = CASE condition_subkind
        WHEN 'component_state' THEN 'entity_state'
        ELSE condition_subkind
    END
WHERE kind IN ('component_threshold', 'component_state')
   OR condition_subkind = 'component_state';

UPDATE notifications.alert_instances
SET rule_kind = CASE rule_kind
        WHEN 'component_threshold' THEN 'entity_threshold'
        WHEN 'component_state' THEN 'entity_state'
        ELSE rule_kind
    END
WHERE rule_kind IN ('component_threshold', 'component_state');

UPDATE notifications.alert_rule_templates
SET kind = CASE kind
        WHEN 'component_threshold' THEN 'entity_threshold'
        WHEN 'component_state' THEN 'entity_state'
        ELSE kind
    END
WHERE kind IN ('component_threshold', 'component_state');

UPDATE notifications.alert_rules
SET config = jsonb_set(
        config,
        '{component}',
        to_jsonb('entity:' || substring(config->>'component' FROM 11)),
        false
    )
WHERE config->>'component' LIKE 'component:%';

UPDATE notifications.alert_rule_templates
SET config = jsonb_set(
        config,
        '{component}',
        to_jsonb('entity:' || substring(config->>'component' FROM 11)),
        false
    )
WHERE config->>'component' LIKE 'component:%';

WITH merged AS (
    SELECT
        r.id,
        COALESCE(jsonb_agg(DISTINCT ids.value ORDER BY ids.value), '[]'::jsonb) AS entity_ids
    FROM notifications.alert_rules r
    CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(r.scope->'entityIds', '[]'::jsonb) ||
        COALESCE(r.scope->'componentIds', '[]'::jsonb)
    ) ids(value)
    WHERE r.scope ? 'componentIds'
    GROUP BY r.id
)
UPDATE notifications.alert_rules r
SET scope = (r.scope - 'componentIds' - 'entityIds') ||
            jsonb_build_object('entityIds', merged.entity_ids)
FROM merged
WHERE r.id = merged.id;

UPDATE notifications.alert_rules
SET scope = scope - 'componentIds'
WHERE scope ? 'componentIds';

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
        'grafana_alert',
        'heartbeat',
        'rate_of_change',
        'stuck_sensor',
        'composite',
        'anomaly_band',
        'change_event',
        'device_event'
    ));
