--------------UP
-- A soft-deleted rule is never evaluated again, so its open alerts would stay
-- open forever. Deleting a rule now closes them, with a transition that says why.
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

-- Rules deleted before this change left their alerts open; close them once.
DO $$
DECLARE
    v_rule RECORD;
BEGIN
    FOR v_rule IN
        SELECT r.organization_id, r.id
        FROM notifications.alert_rules r
        WHERE r.deleted_at IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM notifications.alert_instances ai
              WHERE ai.organization_id = r.organization_id
                AND ai.rule_id = r.id
                AND ai.resolved_at IS NULL
          )
    LOOP
        PERFORM notifications.fn_alert_rule_resolve_open_instances(
            v_rule.organization_id, v_rule.id, NULL, 'Fleet Manager'
        );
    END LOOP;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_rule_resolve_open_instances(VARCHAR, INTEGER, VARCHAR, VARCHAR);
