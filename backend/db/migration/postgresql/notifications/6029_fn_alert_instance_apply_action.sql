--------------UP
-- Alert state transitions. The literal state values ('active','acknowledged',
-- 'resolved') and action names must match the TS source of truth at
-- backend/src/types/api/alert.ts (ALERT_STATES + ALERT_TRANSITION_ACTIONS).
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_apply_action(
    p_organization_id     VARCHAR,
    p_id                  INTEGER,
    p_action              VARCHAR,
    p_actor_user_id       VARCHAR DEFAULT NULL,
    p_actor_display_name  VARCHAR DEFAULT NULL,
    p_silenced_until      TIMESTAMPTZ DEFAULT NULL,
    p_silence_reason      TEXT DEFAULT NULL,
    p_transition_data     JSONB DEFAULT '{}'::jsonb
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
    title                         VARCHAR,
    message                       TEXT,
    fingerprint                   VARCHAR,
    active_since                  TIMESTAMPTZ,
    last_triggered_at             TIMESTAMPTZ,
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       VARCHAR,
    acknowledged_by_display_name  VARCHAR,
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
    CASE p_action
        WHEN 'acknowledged' THEN
            UPDATE notifications.alert_instances ai
            SET state = 'acknowledged',
                acknowledged_at = NOW(),
                acknowledged_by_user_id = p_actor_user_id,
                acknowledged_by_display_name = p_actor_display_name
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
              AND ai.state <> 'acknowledged'
            RETURNING ai.* INTO v_row;

        WHEN 'unacknowledged' THEN
            UPDATE notifications.alert_instances ai
            SET state = 'active',
                acknowledged_at = NULL,
                acknowledged_by_user_id = NULL,
                acknowledged_by_display_name = NULL
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
              AND ai.state = 'acknowledged'
            RETURNING ai.* INTO v_row;

        WHEN 'silenced' THEN
            UPDATE notifications.alert_instances ai
            SET silenced_until = p_silenced_until,
                silence_reason = p_silence_reason
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
            RETURNING ai.* INTO v_row;

        WHEN 'unsilenced' THEN
            UPDATE notifications.alert_instances ai
            SET silenced_until = NULL,
                silence_reason = NULL
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
              AND (ai.silenced_until IS NOT NULL OR ai.silence_reason IS NOT NULL)
            RETURNING ai.* INTO v_row;

        WHEN 'resolved' THEN
            UPDATE notifications.alert_instances ai
            SET state = 'resolved',
                resolved_at = NOW()
            WHERE ai.organization_id = p_organization_id
              AND ai.id = p_id
              AND ai.resolved_at IS NULL
            RETURNING ai.* INTO v_row;

        ELSE
            RAISE EXCEPTION 'Unsupported alert action: %', p_action
                USING ERRCODE = '22023';
    END CASE;

    IF v_row.id IS NULL THEN
        RETURN;
    END IF;

    PERFORM notifications.fn_alert_transition_append(
        v_row.id,
        p_action,
        p_actor_user_id,
        p_actor_display_name,
        COALESCE(p_transition_data, '{}'::jsonb)
    );

    RETURN QUERY
    SELECT
        v_row.id,
        v_row.organization_id,
        v_row.rule_id,
        v_row.rule_kind,
        v_row.state,
        v_row.severity,
        v_row.source_subject_type,
        v_row.source_subject_id,
        v_row.title,
        v_row.message,
        v_row.fingerprint,
        v_row.active_since,
        v_row.last_triggered_at,
        v_row.acknowledged_at,
        v_row.acknowledged_by_user_id,
        v_row.acknowledged_by_display_name,
        v_row.resolved_at,
        v_row.silenced_until,
        v_row.silence_reason,
        v_row.notifications_created_count,
        v_row.delivery_jobs_created_count,
        v_row.context;
END;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_instance_apply_action;
