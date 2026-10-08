--------------UP
-- A snapshot save could re-create a purged device. The save upserted, so a
-- save queued before Device.Delete (Redis-first drainer, or a write that
-- waited on the purge's row lock) inserted the row again with no
-- organization. A purge now fences its external id, and a save only creates
-- a row for an id that was never purged. Admission (fn_admit_batch, the
-- ingress gate) still creates the device again; later saves update that row.
-- The save updates first and inserts in a second statement: a VOLATILE
-- function takes a fresh snapshot per statement, so the insert sees a purge
-- that committed while the update waited on its row lock.
CREATE TABLE IF NOT EXISTS device.deleted_external_identity (
    external_id VARCHAR(50) PRIMARY KEY,
    deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE device.deleted_external_identity IS
    'External ids purged by device.fn_full_delete. Snapshot saves never re-create them; admission does.';

-- Parsed, de-duplicated (last entry wins), retired ids removed.
CREATE OR REPLACE FUNCTION device.fn_snapshot_entries(p_entries JSONB)
RETURNS TABLE (external_id VARCHAR(50), jdoc JSONB)
LANGUAGE sql
STABLE
AS
$$
    SELECT DISTINCT ON (raw.external_id)
           raw.external_id,
           raw.jdoc
    FROM (
        SELECT NULLIF(e.entry->>'external_id', '')::VARCHAR(50) AS external_id,
               NULLIF(e.entry->'jdoc', 'null'::jsonb) AS jdoc,
               e.ordinality
        FROM jsonb_array_elements(
                 CASE
                     WHEN jsonb_typeof(p_entries) = 'array' THEN p_entries
                     ELSE '[]'::jsonb
                 END
             ) WITH ORDINALITY
             AS e(entry, ordinality)
    ) raw
    WHERE raw.external_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM device.retired_external_identity retired
          WHERE retired.external_id = raw.external_id
      )
    ORDER BY raw.external_id, raw.ordinality DESC;
$$;

CREATE OR REPLACE FUNCTION device.fn_add(p_external_id VARCHAR(50), p_jdoc JSONB)
RETURNS void
LANGUAGE plpgsql
AS
$$
BEGIN
    IF p_external_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE device.list
       SET jdoc    = COALESCE(p_jdoc, jdoc),
           updated = now()::TIMESTAMPTZ
     WHERE external_id = p_external_id;
    IF FOUND THEN
        RETURN;
    END IF;

    INSERT INTO device.list (external_id, jdoc)
    SELECT p_external_id, p_jdoc
    WHERE NOT EXISTS (
        SELECT 1
        FROM device.deleted_external_identity deleted
        WHERE deleted.external_id = p_external_id
    )
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
    SET jdoc    = COALESCE(EXCLUDED.jdoc, device.list.jdoc),
        updated = now()::TIMESTAMPTZ;
END;
$$;

CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
AS
$$
DECLARE
    v_updated  VARCHAR[];
    v_inserted BIGINT;
BEGIN
    -- Rows are locked in external_id order, so concurrent batches cannot deadlock.
    WITH entry AS MATERIALIZED (
        SELECT * FROM device.fn_snapshot_entries(p_entries)
    ),
    locked AS (
        SELECT target.id, entry.jdoc
        FROM device.list target
        JOIN entry ON entry.external_id = target.external_id
        ORDER BY target.external_id
        FOR UPDATE OF target
    ),
    updated AS (
        UPDATE device.list AS target
           SET jdoc    = COALESCE(locked.jdoc, target.jdoc),
               updated = now()::TIMESTAMPTZ
          FROM locked
         WHERE target.id = locked.id
        RETURNING target.external_id
    )
    SELECT COALESCE(array_agg(updated.external_id), '{}')
      INTO v_updated
      FROM updated;

    WITH inserted AS (
        INSERT INTO device.list AS target (external_id, jdoc)
        SELECT entry.external_id, entry.jdoc
        FROM device.fn_snapshot_entries(p_entries) entry
        WHERE entry.external_id <> ALL (v_updated)
          AND NOT EXISTS (
              SELECT 1
              FROM device.deleted_external_identity deleted
              WHERE deleted.external_id = entry.external_id
          )
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET jdoc    = COALESCE(EXCLUDED.jdoc, target.jdoc),
            updated = now()::TIMESTAMPTZ
        RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM inserted;

    RETURN cardinality(v_updated) + v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION device.fn_full_delete(p_id INT)
RETURNS void
AS
$$
DECLARE
    v_scoped_rule_ids INT[];
    v_organization_id VARCHAR;
    v_external_id VARCHAR;
BEGIN
    -- Let the alert-instance trigger accept the detach below. Transaction-local.
    PERFORM set_config('fm.deleting_device_id', p_id::TEXT, true);

    SELECT d.organization_id, d.external_id
      INTO v_organization_id, v_external_id
      FROM device.list d
     WHERE d.id = p_id;

    -- Fence the identity so a queued snapshot save cannot re-create the row.
    IF v_external_id IS NOT NULL THEN
        INSERT INTO device.deleted_external_identity (external_id)
        VALUES (v_external_id)
        ON CONFLICT (external_id) DO UPDATE SET deleted_at = now();
    END IF;

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

    -- A deleted device is never evaluated again, so its open alerts close here.
    IF v_organization_id IS NOT NULL THEN
        PERFORM notifications.fn_alert_resolve_open_instances(
            v_organization_id, NULL::INTEGER, p_id, 'device_deleted',
            NULL, NULL
        );
    END IF;

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
-- Restore the upserting saves (20032, 20033) and the unfenced purge (20077).
CREATE OR REPLACE FUNCTION device.fn_add(p_external_id VARCHAR(50), p_jdoc JSONB)
RETURNS void
LANGUAGE sql
AS
$$
    INSERT INTO device.list (external_id, jdoc)
    SELECT p_external_id, p_jdoc
    WHERE p_external_id IS NOT NULL
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
    SET jdoc    = COALESCE(EXCLUDED.jdoc, device.list.jdoc),
        updated = now()::TIMESTAMPTZ;
$$;

CREATE OR REPLACE FUNCTION device.fn_add_batch(p_entries JSONB)
RETURNS BIGINT
LANGUAGE sql
AS
$$
    WITH input AS MATERIALIZED (
        SELECT DISTINCT ON (external_id)
               external_id,
               jdoc
        FROM (
            SELECT NULLIF(e.entry->>'external_id', '')::VARCHAR(50) AS external_id,
                   NULLIF(e.entry->'jdoc', 'null'::jsonb) AS jdoc,
                   e.ordinality
            FROM jsonb_array_elements(
                     CASE
                         WHEN jsonb_typeof(p_entries) = 'array' THEN p_entries
                         ELSE '[]'::jsonb
                     END
                 ) WITH ORDINALITY
                 AS e(entry, ordinality)
        ) raw
        WHERE external_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM device.retired_external_identity retired
              WHERE retired.external_id = raw.external_id
          )
        ORDER BY external_id, ordinality DESC
    ),
    upserted AS (
        INSERT INTO device.list AS target (external_id, jdoc)
        SELECT external_id, jdoc
        FROM input
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET jdoc = COALESCE(EXCLUDED.jdoc, target.jdoc),
            updated = now()::TIMESTAMPTZ
        RETURNING 1
    )
    SELECT count(*)::BIGINT FROM upserted;
$$;

CREATE OR REPLACE FUNCTION device.fn_full_delete(p_id INT)
RETURNS void
AS
$$
DECLARE
    v_scoped_rule_ids INT[];
    v_organization_id VARCHAR;
BEGIN
    -- Let the alert-instance trigger accept the detach below. Transaction-local.
    PERFORM set_config('fm.deleting_device_id', p_id::TEXT, true);

    SELECT d.organization_id INTO v_organization_id
      FROM device.list d
     WHERE d.id = p_id;

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

    -- A deleted device is never evaluated again, so its open alerts close here.
    IF v_organization_id IS NOT NULL THEN
        PERFORM notifications.fn_alert_resolve_open_instances(
            v_organization_id, NULL::INTEGER, p_id, 'device_deleted',
            NULL, NULL
        );
    END IF;

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

DROP FUNCTION IF EXISTS device.fn_snapshot_entries(JSONB);
DROP TABLE IF EXISTS device.deleted_external_identity;
