--------------UP
SET search_path TO public;

-- Reads the alerts a burst of events named, in one call. The caller checks
-- permission per id; this only keeps the read inside the tenant.
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_get_many(
    p_organization_id VARCHAR,
    p_ids             INTEGER[]
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
    ack_comment                   VARCHAR,
    resolved_at                   TIMESTAMPTZ,
    silenced_until                TIMESTAMPTZ,
    silence_reason                TEXT,
    notifications_created_count   INTEGER,
    delivery_jobs_created_count   INTEGER,
    context                       JSONB
)
LANGUAGE sql STABLE
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
        ai.source_location_id,
        ai.title,
        ai.message,
        ai.fingerprint,
        ai.active_since,
        ai.last_triggered_at,
        ai.acknowledged_at,
        ai.acknowledged_by_user_id,
        ai.acknowledged_by_display_name,
        ai.ack_comment,
        ai.resolved_at,
        ai.silenced_until,
        ai.silence_reason,
        ai.notifications_created_count,
        ai.delivery_jobs_created_count,
        ai.context
    FROM notifications.alert_instances ai
    WHERE ai.organization_id = p_organization_id
      AND ai.id = ANY(p_ids)
    ORDER BY ai.id;
$$;

--------------DOWN
SET search_path TO public;

DROP FUNCTION IF EXISTS notifications.fn_alert_instance_get_many(VARCHAR, INTEGER[]);
