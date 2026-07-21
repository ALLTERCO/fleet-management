--------------UP
CREATE UNIQUE INDEX IF NOT EXISTS alert_rules_organization_id_id_unique
    ON notifications.alert_rules (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS alert_instances_organization_id_id_unique
    ON notifications.alert_instances (organization_id, id);

CREATE TABLE IF NOT EXISTS notifications.alert_rule_device_scope (
    organization_id VARCHAR(120) NOT NULL,
    rule_id INTEGER NOT NULL,
    device_id INTEGER NOT NULL,
    PRIMARY KEY (rule_id, device_id),
    FOREIGN KEY (organization_id, rule_id)
        REFERENCES notifications.alert_rules (organization_id, id)
        ON DELETE CASCADE,
    FOREIGN KEY (organization_id, device_id)
        REFERENCES device.list (organization_id, id) ON DELETE RESTRICT
);

INSERT INTO notifications.alert_rule_device_scope (
    organization_id, rule_id, device_id
)
SELECT r.organization_id, r.id, d.id
  FROM notifications.alert_rules r
 CROSS JOIN LATERAL jsonb_array_elements_text(
     COALESCE(r.scope->'deviceIds', '[]'::jsonb)
 ) item(external_id)
  JOIN device.list d
    ON d.organization_id = r.organization_id
   AND d.external_id = item.external_id
ON CONFLICT DO NOTHING;

DO $$
DECLARE expected_count BIGINT;
DECLARE stored_count BIGINT;
BEGIN
    SELECT COALESCE(SUM(jsonb_array_length(scope->'deviceIds')), 0)
      INTO expected_count
      FROM notifications.alert_rules
     WHERE scope ? 'deviceIds';
    SELECT count(*) INTO stored_count
      FROM notifications.alert_rule_device_scope;
    IF expected_count <> stored_count THEN
        RAISE EXCEPTION 'alert rules contain unresolved device references';
    END IF;
END $$;

UPDATE notifications.alert_rules
   SET scope = scope - 'deviceIds'
 WHERE scope ? 'deviceIds';

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_device_scope_replace(
    p_organization_id VARCHAR,
    p_rule_id INTEGER,
    p_external_ids JSONB
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE expected_count INTEGER;
DECLARE stored_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM notifications.alert_rules
         WHERE organization_id = p_organization_id AND id = p_rule_id
    ) THEN
        RAISE EXCEPTION 'alert rule does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'alert_rule';
    END IF;

    DELETE FROM notifications.alert_rule_device_scope
     WHERE organization_id = p_organization_id AND rule_id = p_rule_id;

    SELECT jsonb_array_length(COALESCE(p_external_ids, '[]'::jsonb))
      INTO expected_count;

    INSERT INTO notifications.alert_rule_device_scope (
        organization_id, rule_id, device_id
    )
    SELECT p_organization_id, p_rule_id, d.id
      FROM jsonb_array_elements_text(COALESCE(p_external_ids, '[]'::jsonb))
           item(external_id)
      JOIN device.list d
        ON d.organization_id = p_organization_id
       AND d.external_id = item.external_id
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS stored_count = ROW_COUNT;
    IF expected_count <> stored_count THEN
        RAISE EXCEPTION 'one or more alert scope devices do not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_scopes_public(
    p_organization_id VARCHAR,
    p_rule_ids INTEGER[]
)
RETURNS TABLE (rule_id INTEGER, scope JSONB)
LANGUAGE sql STABLE AS $$
    SELECT r.id,
           CASE WHEN count(s.device_id) = 0 THEN r.scope
                ELSE r.scope || jsonb_build_object(
                    'deviceIds',
                    jsonb_agg(d.external_id ORDER BY d.external_id)
                )
           END
      FROM notifications.alert_rules r
      LEFT JOIN notifications.alert_rule_device_scope s
        ON s.organization_id = r.organization_id AND s.rule_id = r.id
      LEFT JOIN device.list d
        ON d.organization_id = s.organization_id AND d.id = s.device_id
     WHERE r.organization_id = p_organization_id
       AND r.id = ANY(p_rule_ids)
     GROUP BY r.id, r.scope;
$$;

ALTER TABLE notifications.alert_instances
    ADD COLUMN IF NOT EXISTS source_device_id INTEGER;

UPDATE notifications.alert_instances a
   SET source_device_id = d.id
  FROM device.list d
 WHERE a.source_subject_type = 'device'
   AND a.source_device_id IS NULL
   AND d.organization_id = a.organization_id
   AND d.external_id = a.source_subject_id;

UPDATE notifications.alert_instances a
   SET source_device_id = (
       SELECT audit.old_device_id
         FROM device.hardware_replacement_audit audit
        WHERE audit.organization_id = a.organization_id
          AND audit.old_external_id = a.source_subject_id
          AND EXISTS (
              SELECT 1 FROM device.list d
               WHERE d.organization_id = a.organization_id
                 AND d.id = audit.old_device_id
          )
        ORDER BY audit.created_at DESC
        LIMIT 1
   )
 WHERE a.source_subject_type = 'device'
   AND a.source_device_id IS NULL
   AND EXISTS (
       SELECT 1 FROM device.hardware_replacement_audit audit
        WHERE audit.organization_id = a.organization_id
          AND audit.old_external_id = a.source_subject_id
   );

DO $$
BEGIN
    -- Historical alerts may outlive a deleted device. Keep their external-ID
    -- snapshot; all new device alerts are normalized by the trigger below.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'alert_instances_source_device_fk'
           AND conrelid = 'notifications.alert_instances'::regclass
    ) THEN
        ALTER TABLE notifications.alert_instances
            ADD CONSTRAINT alert_instances_source_device_fk
            FOREIGN KEY (organization_id, source_device_id)
            REFERENCES device.list (organization_id, id) ON DELETE RESTRICT;
    END IF;
END $$;

UPDATE notifications.alert_instances
   SET source_subject_id = source_device_id::TEXT,
       fingerprint = regexp_replace(
           fingerprint,
           '^rule:([0-9]+):device:[^:]+',
           'rule:\1:device:' || source_device_id::TEXT
       )
 WHERE source_subject_type = 'device'
   AND source_device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS alert_instances_source_device_idx
    ON notifications.alert_instances (organization_id, source_device_id)
    WHERE source_device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_device_subject_set()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_subject_type <> 'device' THEN
        NEW.source_device_id := NULL;
        RETURN NEW;
    END IF;

    IF NEW.source_device_id IS NULL THEN
        SELECT d.id INTO NEW.source_device_id
          FROM device.list d
         WHERE d.organization_id = NEW.organization_id
           AND d.external_id = NEW.source_subject_id
         LIMIT 1;
    END IF;

    IF NEW.source_device_id IS NULL THEN
        RAISE EXCEPTION 'alert device subject does not exist in organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;
    NEW.source_subject_id := NEW.source_device_id::TEXT;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alert_instance_device_subject_set
    ON notifications.alert_instances;
CREATE TRIGGER alert_instance_device_subject_set
BEFORE INSERT OR UPDATE OF source_subject_type, source_subject_id, source_device_id
ON notifications.alert_instances
FOR EACH ROW EXECUTE FUNCTION notifications.fn_alert_instance_device_subject_set();

CREATE OR REPLACE FUNCTION notifications.fn_reassign_device_ownership(
    p_organization_id VARCHAR,
    p_retained_device_id INTEGER,
    p_temporary_device_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE item RECORD;
DECLARE retained_alert_id INTEGER;
DECLARE retained_fingerprint TEXT;
BEGIN
    IF p_retained_device_id = p_temporary_device_id THEN RETURN; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE organization_id = p_organization_id
           AND id = p_retained_device_id
    ) OR NOT EXISTS (
        SELECT 1 FROM device.list
         WHERE organization_id = p_organization_id
           AND id = p_temporary_device_id
    ) THEN
        RAISE EXCEPTION 'alert ownership reassignment device is outside organization'
            USING ERRCODE = '23503', DETAIL = 'device';
    END IF;

    INSERT INTO notifications.alert_rule_device_scope (
        organization_id, rule_id, device_id
    )
    SELECT organization_id, rule_id, p_retained_device_id
      FROM notifications.alert_rule_device_scope
     WHERE organization_id = p_organization_id
       AND device_id = p_temporary_device_id
    ON CONFLICT DO NOTHING;

    DELETE FROM notifications.alert_rule_device_scope
     WHERE organization_id = p_organization_id
       AND device_id = p_temporary_device_id;

    FOR item IN
        SELECT id, rule_id, fingerprint
          FROM notifications.alert_instances
         WHERE organization_id = p_organization_id
           AND source_device_id = p_temporary_device_id
         ORDER BY id
    LOOP
        retained_fingerprint := regexp_replace(
            item.fingerprint,
            '^rule:([0-9]+):device:[^:]+',
            'rule:\1:device:' || p_retained_device_id::TEXT
        );
        retained_alert_id := NULL;

        SELECT id INTO retained_alert_id
          FROM notifications.alert_instances
         WHERE organization_id = p_organization_id
           AND rule_id = item.rule_id
           AND fingerprint = retained_fingerprint
           AND id <> item.id
           AND state IN (
               'pending', 'active', 'acknowledged', 'recovering',
               'cleared_unack', 'cleared_ack', 'no_data', 'evaluation_error'
           )
         ORDER BY id
         LIMIT 1;

        IF retained_alert_id IS NULL THEN
            UPDATE notifications.alert_instances
               SET source_device_id = p_retained_device_id,
                   source_subject_id = p_retained_device_id::TEXT,
                   fingerprint = retained_fingerprint
             WHERE id = item.id;
            CONTINUE;
        END IF;

        UPDATE notifications.alert_transitions
           SET alert_id = retained_alert_id WHERE alert_id = item.id;
        UPDATE notifications.inbox_items
           SET alert_id = retained_alert_id WHERE alert_id = item.id;
        UPDATE notifications.delivery_jobs
           SET alert_id = retained_alert_id WHERE alert_id = item.id;
        UPDATE notifications.alert_annotations
           SET alert_instance_id = retained_alert_id
         WHERE alert_instance_id = item.id;

        DELETE FROM notifications.delivery_group_member old_member
         USING notifications.delivery_group_member retained_member
         WHERE old_member.alert_id = item.id
           AND retained_member.alert_id = retained_alert_id
           AND retained_member.group_id = old_member.group_id
           AND retained_member.endpoint_id = old_member.endpoint_id;
        UPDATE notifications.delivery_group_member
           SET alert_id = retained_alert_id WHERE alert_id = item.id;

        DELETE FROM notifications.notification_digest_items old_item
         USING notifications.notification_digest_items retained_item
         WHERE old_item.alert_id = item.id
           AND retained_item.alert_id = retained_alert_id
           AND old_item.consumed_at IS NULL
           AND retained_item.consumed_at IS NULL
           AND retained_item.organization_id = old_item.organization_id
           AND retained_item.user_id = old_item.user_id
           AND retained_item.kind = old_item.kind;
        UPDATE notifications.notification_digest_items
           SET alert_id = retained_alert_id WHERE alert_id = item.id;

        DELETE FROM notifications.alert_instances WHERE id = item.id;
    END LOOP;
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_reassign_device_ownership(VARCHAR, INTEGER, INTEGER);
DROP TRIGGER IF EXISTS alert_instance_device_subject_set
    ON notifications.alert_instances;
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_device_subject_set();
DROP INDEX IF EXISTS notifications.alert_instances_source_device_idx;
ALTER TABLE notifications.alert_instances
    DROP CONSTRAINT IF EXISTS alert_instances_source_device_fk,
    DROP COLUMN IF EXISTS source_device_id;
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_scopes_public(VARCHAR, INTEGER[]);
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_device_scope_replace(VARCHAR, INTEGER, JSONB);
DROP TABLE IF EXISTS notifications.alert_rule_device_scope;
DROP INDEX IF EXISTS notifications.alert_instances_organization_id_id_unique;
DROP INDEX IF EXISTS notifications.alert_rules_organization_id_id_unique;
