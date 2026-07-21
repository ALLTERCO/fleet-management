--------------UP
-- Deleting a device used to 500: RESTRICT foreign keys from alert history,
-- alert-rule scope, and virtual-device sources blocked the row. fn_full_delete
-- now unlinks the device from everything that referenced it: keep alert history
-- by detaching, drop rule/virtual membership, and pause anything left empty so
-- it never watches the whole fleet or shows stale data. Nothing with its own
-- value is deleted by surprise.

-- The alert-instance trigger re-resolves source_device_id from the subject id,
-- so a plain "SET source_device_id = NULL" would be undone. Let fn_full_delete
-- detach the exact device it is deleting; every other insert/update is
-- unaffected because the guard is gated on fm.deleting_device_id.
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_device_subject_set()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE normalized RECORD;
DECLARE old_subject_id VARCHAR;
DECLARE old_prefix TEXT;
DECLARE new_subject_id VARCHAR;
BEGIN
    old_subject_id := NEW.source_subject_id;

    -- Device delete detaches its alert history (source_device_id -> NULL).
    -- Gated to that device so normal inserts/updates keep resolving as before.
    IF TG_OP = 'UPDATE'
       AND NEW.source_device_id IS NULL
       AND OLD.source_device_id::TEXT
           = current_setting('fm.deleting_device_id', true)
    THEN
        RETURN NEW;
    END IF;

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

-- Unlink a device as a source from every virtual device that reads it, pausing
-- any virtual left without a live source.
CREATE OR REPLACE FUNCTION device.fn_unlink_virtual_sources(p_device_id INT)
RETURNS void
AS
$$
DECLARE
    v_sourced_virtuals INT[];
BEGIN
    SELECT array_agg(DISTINCT virtual_device_list_id) INTO v_sourced_virtuals
      FROM device.virtual_device_binding
     WHERE source_device_list_id = p_device_id;

    DELETE FROM device.virtual_device_binding
     WHERE source_device_list_id = p_device_id;

    IF v_sourced_virtuals IS NOT NULL THEN
        UPDATE device.virtual_device v
           SET enabled = false
         WHERE v.device_list_id = ANY(v_sourced_virtuals)
           AND v.enabled
           AND NOT EXISTS (
               SELECT 1 FROM device.virtual_device_binding b
                WHERE b.virtual_device_list_id = v.device_list_id
                  AND b.effective_to IS NULL);
    END IF;
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device.fn_full_delete(p_id INT)
RETURNS void
AS
$$
DECLARE
    v_scoped_rule_ids INT[];
BEGIN
    -- Let the alert-instance trigger accept the detach below. Transaction-local.
    PERFORM set_config('fm.deleting_device_id', p_id::TEXT, true);

    -- Rules scoped directly to this device, captured before we unscope it, so
    -- the fail-closed check only touches rules this delete actually emptied.
    SELECT array_agg(DISTINCT rule_id) INTO v_scoped_rule_ids
      FROM (
          SELECT rule_id FROM notifications.alert_rule_device_scope
           WHERE device_id = p_id
          UNION
          SELECT rule_id FROM notifications.alert_rule_entity_scope
           WHERE device_id = p_id
      ) scoped;

    -- Keep alert history, drop the live link. title/message/source_subject_id
    -- already hold a readable snapshot of the device.
    UPDATE notifications.alert_instances
       SET source_device_id = NULL
     WHERE source_device_id = p_id;

    -- Remove the device from every rule and template scope. These join rows are
    -- the source of truth the evaluator reads, so deleting them unscopes it.
    DELETE FROM notifications.alert_rule_device_scope WHERE device_id = p_id;
    DELETE FROM notifications.alert_rule_entity_scope WHERE device_id = p_id;
    DELETE FROM notifications.alert_rule_template_device_scope WHERE device_id = p_id;
    DELETE FROM notifications.alert_rule_template_entity_scope WHERE device_id = p_id;

    -- Fail closed: an empty scope matches every device, so a rule this delete
    -- just emptied would alarm on the whole fleet. Disable it instead.
    IF v_scoped_rule_ids IS NOT NULL THEN
        UPDATE notifications.alert_rules r
           SET enabled = false
         WHERE r.id = ANY(v_scoped_rule_ids)
           AND r.enabled
           AND NOT EXISTS (
               SELECT 1 FROM notifications.alert_rule_device_scope s
                WHERE s.rule_id = r.id)
           AND NOT EXISTS (
               SELECT 1 FROM notifications.alert_rule_entity_scope s
                WHERE s.rule_id = r.id)
           AND COALESCE(jsonb_array_length(r.scope->'groupIds'), 0) = 0
           AND COALESCE(jsonb_array_length(r.scope->'locationIds'), 0) = 0
           AND COALESCE(jsonb_array_length(r.scope->'tagIds'), 0) = 0;
    END IF;

    -- Unlink this device as a source; virtuals keep their other sources.
    PERFORM device.fn_unlink_virtual_sources(p_id);

    -- virtual_metadata (a promoted child's host link) stays RESTRICT: the app
    -- demotes hosted children before delete, so this only trips on a failed
    -- demote, where blocking with a clear 409 is the safe outcome.
    DELETE FROM device.status WHERE id = p_id;
    DELETE FROM device.list WHERE id = p_id;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
CREATE OR REPLACE FUNCTION device.fn_full_delete(p_id INT)
RETURNS void
AS
$$
BEGIN
    DELETE FROM device.status WHERE id = p_id;
    DELETE FROM device.list WHERE id = p_id;
END;
$$
LANGUAGE plpgsql;

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
