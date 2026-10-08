--------------UP
-- 'system': an alert Fleet raises about itself, so 'entity' stays a device part.
-- No automation rows to move: the engine never stored their 'entity' subjects.
ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_subject_type_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_subject_type_valid
    CHECK (source_subject_type IN (
        'device', 'entity', 'group', 'location', 'tag', 'external', 'system'
    ));

ALTER TABLE notifications.inbox_items
    DROP CONSTRAINT IF EXISTS inbox_items_subject_type_valid;
ALTER TABLE notifications.inbox_items
    ADD CONSTRAINT inbox_items_subject_type_valid
    CHECK (
        source_subject_type IS NULL OR source_subject_type IN (
            'device', 'entity', 'group', 'location', 'tag', 'external',
            'system'
        )
    );

-- Health checks were stored as '<check>:virtual' entities; move them to the
-- form the evaluator now builds so an open one still clears.
-- One open row per (rule, fingerprint): the newest open one wins.
WITH legacy AS (
    SELECT a.id, a.rule_id,
           'rule:' || a.rule_id || ':system:'
               || left(a.source_subject_id, -length(':virtual')) AS fingerprint
      FROM notifications.alert_instances a
     WHERE a.rule_kind = 'system_health'
       AND a.source_subject_type = 'entity'
       AND a.source_subject_id LIKE '%:virtual'
), open_rows AS (
    SELECT a.id, legacy.rule_id, legacy.fingerprint, a.last_triggered_at
      FROM legacy
      JOIN notifications.alert_instances a ON a.id = legacy.id
     WHERE a.resolved_at IS NULL
    UNION ALL
    SELECT a.id, a.rule_id, a.fingerprint, a.last_triggered_at
      FROM notifications.alert_instances a
      JOIN (SELECT DISTINCT rule_id, fingerprint FROM legacy) target
        ON target.rule_id = a.rule_id AND target.fingerprint = a.fingerprint
     WHERE a.resolved_at IS NULL
), ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY rule_id, fingerprint
               ORDER BY last_triggered_at DESC NULLS LAST, id DESC
           ) AS rank
      FROM open_rows
)
UPDATE notifications.alert_instances a
   SET state = 'resolved', resolved_at = NOW()
  FROM ranked
 WHERE a.id = ranked.id AND ranked.rank > 1;

UPDATE notifications.inbox_items i
   SET source_subject_type = 'system',
       source_subject_id = left(i.source_subject_id, -length(':virtual'))
  FROM notifications.alert_instances a
 WHERE a.id = i.alert_id
   AND a.rule_kind = 'system_health'
   AND i.source_subject_type = 'entity'
   AND i.source_subject_id LIKE '%:virtual';

UPDATE notifications.notification_digest_items d
   SET source_subject_type = 'system',
       source_subject_id = left(d.source_subject_id, -length(':virtual'))
  FROM notifications.alert_instances a
 WHERE a.id = d.alert_id
   AND a.rule_kind = 'system_health'
   AND d.source_subject_type = 'entity'
   AND d.source_subject_id LIKE '%:virtual';

UPDATE notifications.alert_instances
   SET source_subject_type = 'system',
       source_subject_id = left(source_subject_id, -length(':virtual')),
       fingerprint = 'rule:' || rule_id || ':system:'
           || left(source_subject_id, -length(':virtual'))
 WHERE rule_kind = 'system_health'
   AND source_subject_type = 'entity'
   AND source_subject_id LIKE '%:virtual';

--------------DOWN
-- Health checks go back to the '<check>:virtual' entity form the old code reads.
UPDATE notifications.inbox_items i
   SET source_subject_type = 'entity',
       source_subject_id = i.source_subject_id || ':virtual'
  FROM notifications.alert_instances a
 WHERE a.id = i.alert_id
   AND a.rule_kind = 'system_health'
   AND i.source_subject_type = 'system';

UPDATE notifications.notification_digest_items d
   SET source_subject_type = 'entity',
       source_subject_id = d.source_subject_id || ':virtual'
  FROM notifications.alert_instances a
 WHERE a.id = d.alert_id
   AND a.rule_kind = 'system_health'
   AND d.source_subject_type = 'system';

UPDATE notifications.alert_instances
   SET source_subject_type = 'entity',
       source_subject_id = source_subject_id || ':virtual',
       fingerprint = 'rule:' || rule_id || ':entity:' || source_subject_id
           || ':virtual'
 WHERE rule_kind = 'system_health'
   AND source_subject_type = 'system';

-- Refuse, not delete: system alerts are tenant history no older type can hold.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM notifications.alert_instances
         WHERE source_subject_type = 'system'
    ) OR EXISTS (
        SELECT 1 FROM notifications.inbox_items
         WHERE source_subject_type = 'system'
    ) THEN
        RAISE EXCEPTION 'system alert subjects exist; remove them before rollback'
            USING ERRCODE = '55000';
    END IF;
END $$;

ALTER TABLE notifications.inbox_items
    DROP CONSTRAINT IF EXISTS inbox_items_subject_type_valid;
ALTER TABLE notifications.inbox_items
    ADD CONSTRAINT inbox_items_subject_type_valid
    CHECK (
        source_subject_type IS NULL OR source_subject_type IN (
            'device', 'entity', 'group', 'location', 'tag', 'external'
        )
    );

ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_subject_type_valid;
ALTER TABLE notifications.alert_instances
    ADD CONSTRAINT alert_instances_subject_type_valid
    CHECK (source_subject_type IN (
        'device', 'entity', 'group', 'location', 'tag', 'external'
    ));
