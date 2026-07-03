--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
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
LANGUAGE sql
AS $$
    SELECT
        ai.id,
        ai.organization_id,
        ai.rule_id,
        ai.rule_kind,
        ai.state,
        ai.severity,
        ai.source_subject_type,
        ai.source_subject_id,
        ai.title,
        ai.message,
        ai.fingerprint,
        ai.active_since,
        ai.last_triggered_at,
        ai.acknowledged_at,
        ai.acknowledged_by_user_id,
        ai.acknowledged_by_display_name,
        ai.resolved_at,
        ai.silenced_until,
        ai.silence_reason,
        ai.notifications_created_count,
        ai.delivery_jobs_created_count,
        ai.context
    FROM notifications.alert_instances ai
    WHERE ai.organization_id = p_organization_id
      AND ai.id = p_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_alert_instance_get;
