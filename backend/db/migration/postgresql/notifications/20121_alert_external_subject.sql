--------------UP
-- 'external': an outside alert with no Fleet object, so 'entity' stays a device part.
-- No data to move: since 7312 the trigger rejected Grafana's 'entity' rows.
ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_subject_type_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_subject_type_valid
    CHECK (source_subject_type IN (
        'device', 'entity', 'group', 'location', 'tag', 'external'
    ));

ALTER TABLE notifications.inbox_items
    DROP CONSTRAINT IF EXISTS inbox_items_subject_type_valid;
ALTER TABLE notifications.inbox_items
    ADD CONSTRAINT inbox_items_subject_type_valid
    CHECK (
        source_subject_type IS NULL OR source_subject_type IN (
            'device', 'entity', 'group', 'location', 'tag', 'external'
        )
    );

--------------DOWN
-- Refuse, not delete: external alerts are tenant history no older type can hold.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM notifications.alert_instances
         WHERE source_subject_type = 'external'
    ) OR EXISTS (
        SELECT 1 FROM notifications.inbox_items
         WHERE source_subject_type = 'external'
    ) THEN
        RAISE EXCEPTION 'external alert subjects exist; remove them before rollback'
            USING ERRCODE = '55000';
    END IF;
END $$;

ALTER TABLE notifications.inbox_items
    DROP CONSTRAINT IF EXISTS inbox_items_subject_type_valid;
ALTER TABLE notifications.inbox_items
    ADD CONSTRAINT inbox_items_subject_type_valid
    CHECK (
        source_subject_type IS NULL OR source_subject_type IN (
            'device', 'entity', 'group', 'location', 'tag'
        )
    );

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_subject_type_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_subject_type_valid
    CHECK (source_subject_type IN (
        'device', 'entity', 'group', 'location', 'tag'
    ));
