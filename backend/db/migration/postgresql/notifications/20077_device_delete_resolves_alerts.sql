--------------UP
-- Deleting a device only detached its alert rows (source_device_id -> NULL).
-- Nothing resolved them, so every alert a deleted device had raised stayed
-- open in the inbox for good. The close is written once here: one resolver
-- takes either a rule or a device, the rule wrapper delegates to it, and
-- fn_full_delete calls it so every delete path closes them.
CREATE OR REPLACE FUNCTION notifications.fn_alert_resolve_open_instances(
    p_organization_id     VARCHAR,
    p_rule_id             INTEGER,
    p_device_id           INTEGER,
    p_mode                VARCHAR,
    p_actor_user_id       VARCHAR DEFAULT NULL,
    p_actor_display_name  VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                            INTEGER,
    organization_id               VARCHAR,
    rule_id                       INTEGER,
    rule_kind                     VARCHAR,
    state                         VARCHAR,
    severity                      VARCHAR,
    source_subject_type           VARCHAR,
    source_subject_id             VARCHAR,
    source_location_id            INTEGER,
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
    ack_comment                   TEXT,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row notifications.alert_instances%ROWTYPE;
BEGIN
    -- Fail closed. A call with neither key would resolve the whole tenant.
    IF p_rule_id IS NULL AND p_device_id IS NULL THEN
        RAISE EXCEPTION 'alert resolve needs a rule or a device'
            USING ERRCODE = '22023';
    END IF;

    FOR v_row IN
        UPDATE notifications.alert_instances ai
        SET state = 'resolved',
            resolved_at = NOW()
        WHERE ai.organization_id = p_organization_id
          AND ai.resolved_at IS NULL
          AND (p_rule_id IS NULL OR ai.rule_id = p_rule_id)
          AND (p_device_id IS NULL OR ai.source_device_id = p_device_id)
        RETURNING ai.*
    LOOP
        PERFORM notifications.fn_alert_transition_append(
            v_row.id,
            'resolved',
            p_actor_user_id,
            p_actor_display_name,
            jsonb_build_object('mode', p_mode)
        );
        id := v_row.id;
        organization_id := v_row.organization_id;
        rule_id := v_row.rule_id;
        rule_kind := v_row.rule_kind;
        state := v_row.state;
        severity := v_row.severity;
        source_subject_type := v_row.source_subject_type;
        source_subject_id := v_row.source_subject_id;
        source_location_id := v_row.source_location_id;
        title := v_row.title;
        message := v_row.message;
        fingerprint := v_row.fingerprint;
        active_since := v_row.active_since;
        last_triggered_at := v_row.last_triggered_at;
        acknowledged_at := v_row.acknowledged_at;
        acknowledged_by_user_id := v_row.acknowledged_by_user_id;
        acknowledged_by_display_name := v_row.acknowledged_by_display_name;
        ack_comment := v_row.ack_comment;
        resolved_at := v_row.resolved_at;
        silenced_until := v_row.silenced_until;
        silence_reason := v_row.silence_reason;
        notifications_created_count := v_row.notifications_created_count;
        delivery_jobs_created_count := v_row.delivery_jobs_created_count;
        context := v_row.context;
        RETURN NEXT;
    END LOOP;
    RETURN;
END;
$$;

-- Same signature as before, so Rule.Delete is untouched; the body is now the
-- shared resolver.
CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_resolve_open_instances(
    p_organization_id     VARCHAR,
    p_rule_id             INTEGER,
    p_actor_user_id       VARCHAR DEFAULT NULL,
    p_actor_display_name  VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                            INTEGER,
    organization_id               VARCHAR,
    rule_id                       INTEGER,
    rule_kind                     VARCHAR,
    state                         VARCHAR,
    severity                      VARCHAR,
    source_subject_type           VARCHAR,
    source_subject_id             VARCHAR,
    source_location_id            INTEGER,
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
    ack_comment                   TEXT,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE sql
AS $$
    SELECT * FROM notifications.fn_alert_resolve_open_instances(
        p_organization_id,
        p_rule_id,
        NULL::INTEGER,
        'rule_deleted',
        p_actor_user_id,
        p_actor_display_name
    );
$$;

-- fn_full_delete gains one step: close the device's open alerts before the
-- detach, so no delete path can leave them open. Everything else is 7314.
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

-- Devices deleted before this change left their alerts open. A device subject
-- with no device row is one of those: the trigger refuses to write any other.
DO $$
DECLARE
    v_orphan RECORD;
BEGIN
    FOR v_orphan IN
        UPDATE notifications.alert_instances ai
        SET state = 'resolved',
            resolved_at = NOW()
        WHERE ai.resolved_at IS NULL
          AND ai.source_device_id IS NULL
          AND ai.source_subject_type = 'device'
        RETURNING ai.id
    LOOP
        PERFORM notifications.fn_alert_transition_append(
            v_orphan.id, 'resolved', NULL, 'Fleet Manager',
            '{"mode": "device_deleted"}'::jsonb
        );
    END LOOP;
END;
$$;
--------------DOWN
CREATE OR REPLACE FUNCTION device.fn_full_delete(p_id INT)
RETURNS void
AS
$$
DECLARE
    v_scoped_rule_ids INT[];
BEGIN
    PERFORM set_config('fm.deleting_device_id', p_id::TEXT, true);

    SELECT array_agg(DISTINCT rule_id) INTO v_scoped_rule_ids
      FROM (
          SELECT rule_id FROM notifications.alert_rule_device_scope
           WHERE device_id = p_id
          UNION
          SELECT rule_id FROM notifications.alert_rule_entity_scope
           WHERE device_id = p_id
      ) scoped;

    UPDATE notifications.alert_instances
       SET source_device_id = NULL
     WHERE source_device_id = p_id;

    DELETE FROM notifications.alert_rule_device_scope WHERE device_id = p_id;
    DELETE FROM notifications.alert_rule_entity_scope WHERE device_id = p_id;
    DELETE FROM notifications.alert_rule_template_device_scope WHERE device_id = p_id;
    DELETE FROM notifications.alert_rule_template_entity_scope WHERE device_id = p_id;

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

    PERFORM device.fn_unlink_virtual_sources(p_id);

    DELETE FROM device.status WHERE id = p_id;
    DELETE FROM device.list WHERE id = p_id;
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notifications.fn_alert_rule_resolve_open_instances(
    p_organization_id     VARCHAR,
    p_rule_id             INTEGER,
    p_actor_user_id       VARCHAR DEFAULT NULL,
    p_actor_display_name  VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id                            INTEGER,
    organization_id               VARCHAR,
    rule_id                       INTEGER,
    rule_kind                     VARCHAR,
    state                         VARCHAR,
    severity                      VARCHAR,
    source_subject_type           VARCHAR,
    source_subject_id             VARCHAR,
    source_location_id            INTEGER,
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
    ack_comment                   TEXT,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row notifications.alert_instances%ROWTYPE;
BEGIN
    FOR v_row IN
        UPDATE notifications.alert_instances ai
        SET state = 'resolved',
            resolved_at = NOW()
        WHERE ai.organization_id = p_organization_id
          AND ai.rule_id = p_rule_id
          AND ai.resolved_at IS NULL
        RETURNING ai.*
    LOOP
        PERFORM notifications.fn_alert_transition_append(
            v_row.id,
            'resolved',
            p_actor_user_id,
            p_actor_display_name,
            '{"mode": "rule_deleted"}'::jsonb
        );
        id := v_row.id;
        organization_id := v_row.organization_id;
        rule_id := v_row.rule_id;
        rule_kind := v_row.rule_kind;
        state := v_row.state;
        severity := v_row.severity;
        source_subject_type := v_row.source_subject_type;
        source_subject_id := v_row.source_subject_id;
        source_location_id := v_row.source_location_id;
        title := v_row.title;
        message := v_row.message;
        fingerprint := v_row.fingerprint;
        active_since := v_row.active_since;
        last_triggered_at := v_row.last_triggered_at;
        acknowledged_at := v_row.acknowledged_at;
        acknowledged_by_user_id := v_row.acknowledged_by_user_id;
        acknowledged_by_display_name := v_row.acknowledged_by_display_name;
        ack_comment := v_row.ack_comment;
        resolved_at := v_row.resolved_at;
        silenced_until := v_row.silenced_until;
        silence_reason := v_row.silence_reason;
        notifications_created_count := v_row.notifications_created_count;
        delivery_jobs_created_count := v_row.delivery_jobs_created_count;
        context := v_row.context;
        RETURN NEXT;
    END LOOP;
    RETURN;
END;
$$;

DROP FUNCTION IF EXISTS notifications.fn_alert_resolve_open_instances(VARCHAR, INTEGER, INTEGER, VARCHAR, VARCHAR, VARCHAR);
