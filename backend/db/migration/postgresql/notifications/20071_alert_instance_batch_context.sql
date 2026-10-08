--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_get_batch_v2(
    p_alert_ids INTEGER[]
)
RETURNS TABLE (
    id                   INTEGER,
    organization_id      VARCHAR,
    rule_id              INTEGER,
    rule_kind            VARCHAR,
    state                VARCHAR,
    severity             VARCHAR,
    title                TEXT,
    message              TEXT,
    source_subject_type  VARCHAR,
    source_subject_id    VARCHAR,
    context              JSONB,
    last_triggered_at    TIMESTAMPTZ,
    active_since         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        i.id, i.organization_id, i.rule_id, i.rule_kind, i.state,
        i.severity, i.title, i.message,
        i.source_subject_type, i.source_subject_id, i.context,
        i.last_triggered_at, i.active_since
    FROM notifications.alert_instances i
    WHERE i.id = ANY(p_alert_ids);
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_get_batch_v2(INTEGER[]);
