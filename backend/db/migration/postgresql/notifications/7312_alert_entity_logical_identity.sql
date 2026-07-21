--------------UP
ALTER TABLE notifications.alert_instances
    ADD COLUMN IF NOT EXISTS source_entity_suffix VARCHAR(255);

DROP TRIGGER IF EXISTS alert_instance_device_subject_set
    ON notifications.alert_instances;

WITH normalized AS (
    SELECT a.id,
           a.rule_id,
           a.source_subject_id AS old_subject_id,
           a.fingerprint AS old_fingerprint,
           ref.device_id,
           ref.entity_suffix,
           'rule:' || a.rule_id || ':entity:' || a.source_subject_id AS old_prefix,
           'rule:' || a.rule_id || ':entity:' || ref.device_id::TEXT || '_'
               || ref.entity_suffix AS new_prefix
      FROM notifications.alert_instances a
     CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
         a.organization_id, a.source_subject_id
     ) ref
     WHERE a.source_subject_type = 'entity'
       AND a.source_subject_id NOT LIKE '%:virtual'
       AND ref.device_id IS NOT NULL
       AND ref.entity_suffix IS NOT NULL
), ranked AS (
    SELECT normalized.id,
           ROW_NUMBER() OVER (
               PARTITION BY normalized.rule_id,
                   normalized.new_prefix || substring(
                       normalized.old_fingerprint
                       FROM length(normalized.old_prefix) + 1
                   )
               ORDER BY a.last_triggered_at DESC, normalized.id DESC
           ) AS rank
      FROM normalized
      JOIN notifications.alert_instances a ON a.id = normalized.id
     WHERE a.state IN (
         'pending', 'active', 'acknowledged', 'recovering',
         'cleared_unack', 'cleared_ack', 'no_data', 'evaluation_error'
     )
)
UPDATE notifications.alert_instances a
   SET state = 'resolved', resolved_at = COALESCE(a.resolved_at, NOW())
  FROM ranked
 WHERE a.id = ranked.id AND ranked.rank > 1;

WITH normalized AS (
    SELECT a.id,
           ref.device_id,
           ref.entity_suffix,
           'rule:' || a.rule_id || ':entity:' || a.source_subject_id AS old_prefix,
           'rule:' || a.rule_id || ':entity:' || ref.device_id::TEXT || '_'
               || ref.entity_suffix AS new_prefix
      FROM notifications.alert_instances a
     CROSS JOIN LATERAL organization.fn_normalize_entity_subject(
         a.organization_id, a.source_subject_id
     ) ref
     WHERE a.source_subject_type = 'entity'
       AND a.source_subject_id NOT LIKE '%:virtual'
       AND ref.device_id IS NOT NULL
       AND ref.entity_suffix IS NOT NULL
)
UPDATE notifications.alert_instances a
   SET source_device_id = normalized.device_id,
       source_entity_suffix = normalized.entity_suffix,
       source_subject_id = normalized.device_id::TEXT || '_'
           || normalized.entity_suffix,
       fingerprint = normalized.new_prefix || substring(
           a.fingerprint FROM length(normalized.old_prefix) + 1
       )
  FROM normalized
 WHERE a.id = normalized.id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM notifications.alert_instances
         WHERE source_subject_type = 'entity'
           AND source_subject_id NOT LIKE '%:virtual'
           AND (source_device_id IS NULL OR source_entity_suffix IS NULL)
    ) THEN
        RAISE EXCEPTION 'alert instances contain unresolved physical entity subjects';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS alert_instances_source_entity_idx
    ON notifications.alert_instances (
        organization_id, source_device_id, source_entity_suffix
    ) WHERE source_subject_type = 'entity' AND source_device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_device_subject_set()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE normalized RECORD;
DECLARE old_subject_id VARCHAR;
DECLARE old_prefix TEXT;
DECLARE new_subject_id VARCHAR;
BEGIN
    old_subject_id := NEW.source_subject_id;
    IF NEW.source_subject_type = 'device' THEN
        NEW.source_entity_suffix := NULL;
        IF NEW.source_device_id IS NULL THEN
            SELECT d.id INTO NEW.source_device_id
              FROM device.list d
             WHERE d.organization_id = NEW.organization_id
               AND (d.external_id = NEW.source_subject_id
                    OR d.id::TEXT = NEW.source_subject_id)
             LIMIT 1;
        END IF;
        IF NEW.source_device_id IS NULL THEN
            RAISE EXCEPTION 'alert device subject does not exist in organization'
                USING ERRCODE = '23503', DETAIL = 'device';
        END IF;
        new_subject_id := NEW.source_device_id::TEXT;
        old_prefix := 'rule:' || NEW.rule_id || ':device:' || old_subject_id;
        IF starts_with(NEW.fingerprint, old_prefix) THEN
            NEW.fingerprint := 'rule:' || NEW.rule_id || ':device:'
                || new_subject_id
                || substring(NEW.fingerprint FROM length(old_prefix) + 1);
        END IF;
        NEW.source_subject_id := new_subject_id;
        RETURN NEW;
    END IF;

    IF NEW.source_subject_type = 'entity'
       AND NEW.source_subject_id LIKE '%:virtual'
    THEN
        NEW.source_device_id := NULL;
        NEW.source_entity_suffix := NULL;
        RETURN NEW;
    END IF;

    IF NEW.source_subject_type = 'entity' THEN
        IF NEW.source_device_id IS NULL OR NEW.source_entity_suffix IS NULL THEN
            SELECT * INTO normalized
              FROM organization.fn_normalize_entity_subject(
                  NEW.organization_id, NEW.source_subject_id
              );
            NEW.source_device_id := normalized.device_id;
            NEW.source_entity_suffix := normalized.entity_suffix;
        END IF;
        IF NEW.source_device_id IS NULL OR NEW.source_entity_suffix IS NULL THEN
            RAISE EXCEPTION 'alert physical entity does not exist in organization'
                USING ERRCODE = '23503', DETAIL = 'entity';
        END IF;
        new_subject_id := NEW.source_device_id::TEXT || '_'
            || NEW.source_entity_suffix;
        old_prefix := 'rule:' || NEW.rule_id || ':entity:' || old_subject_id;
        IF starts_with(NEW.fingerprint, old_prefix) THEN
            NEW.fingerprint := 'rule:' || NEW.rule_id || ':entity:'
                || new_subject_id
                || substring(NEW.fingerprint FROM length(old_prefix) + 1);
        END IF;
        NEW.source_subject_id := new_subject_id;
        RETURN NEW;
    END IF;

    NEW.source_device_id := NULL;
    NEW.source_entity_suffix := NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER alert_instance_device_subject_set
BEFORE INSERT OR UPDATE OF
    source_subject_type, source_subject_id, source_device_id, source_entity_suffix
ON notifications.alert_instances
FOR EACH ROW EXECUTE FUNCTION notifications.fn_alert_instance_device_subject_set();

CREATE OR REPLACE FUNCTION notifications.fn_alert_subject_id_public(
    p_subject_type VARCHAR,
    p_subject_id VARCHAR,
    p_external_id VARCHAR,
    p_entity_suffix VARCHAR
)
RETURNS VARCHAR
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_subject_type = 'device' AND p_external_id IS NOT NULL
            THEN p_external_id
        WHEN p_subject_type = 'entity' AND p_external_id IS NOT NULL
             AND p_entity_suffix IS NOT NULL
            THEN p_external_id || '_' || p_entity_suffix
        ELSE p_subject_id
    END;
$$;

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
DECLARE retained_subject_id TEXT;
DECLARE old_prefix TEXT;
DECLARE new_prefix TEXT;
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

    DELETE FROM notifications.alert_rule_entity_scope temporary
     WHERE temporary.organization_id = p_organization_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM notifications.alert_rule_entity_scope retained
            WHERE retained.organization_id = p_organization_id
              AND retained.rule_id = temporary.rule_id
              AND retained.device_id = p_retained_device_id
              AND retained.entity_suffix = temporary.entity_suffix
       );
    UPDATE notifications.alert_rule_entity_scope
       SET device_id = p_retained_device_id
     WHERE organization_id = p_organization_id
       AND device_id = p_temporary_device_id;

    DELETE FROM notifications.alert_rule_template_device_scope temporary
     WHERE temporary.organization_id = p_organization_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM notifications.alert_rule_template_device_scope retained
            WHERE retained.organization_id = p_organization_id
              AND retained.template_id = temporary.template_id
              AND retained.device_id = p_retained_device_id
       );
    UPDATE notifications.alert_rule_template_device_scope
       SET device_id = p_retained_device_id
     WHERE organization_id = p_organization_id
       AND device_id = p_temporary_device_id;

    DELETE FROM notifications.alert_rule_template_entity_scope temporary
     WHERE temporary.organization_id = p_organization_id
       AND temporary.device_id = p_temporary_device_id
       AND EXISTS (
           SELECT 1 FROM notifications.alert_rule_template_entity_scope retained
            WHERE retained.organization_id = p_organization_id
              AND retained.template_id = temporary.template_id
              AND retained.device_id = p_retained_device_id
              AND retained.entity_suffix = temporary.entity_suffix
       );
    UPDATE notifications.alert_rule_template_entity_scope
       SET device_id = p_retained_device_id
     WHERE organization_id = p_organization_id
       AND device_id = p_temporary_device_id;

    FOR item IN
        SELECT id, rule_id, fingerprint, source_subject_type,
               source_subject_id, source_entity_suffix
          FROM notifications.alert_instances
         WHERE organization_id = p_organization_id
           AND source_device_id = p_temporary_device_id
         ORDER BY id
    LOOP
        retained_subject_id := CASE item.source_subject_type
            WHEN 'entity' THEN p_retained_device_id::TEXT || '_'
                || item.source_entity_suffix
            ELSE p_retained_device_id::TEXT
        END;
        old_prefix := 'rule:' || item.rule_id || ':'
            || item.source_subject_type || ':' || item.source_subject_id;
        new_prefix := 'rule:' || item.rule_id || ':'
            || item.source_subject_type || ':' || retained_subject_id;
        retained_fingerprint := new_prefix || substring(
            item.fingerprint FROM length(old_prefix) + 1
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
                   source_subject_id = retained_subject_id,
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
-- Forward-only logical identity migration.
