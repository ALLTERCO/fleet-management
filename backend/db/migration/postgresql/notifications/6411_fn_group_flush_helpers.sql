--------------UP
-- fn_alert_instance_get_batch — batch-load alert_instances by id for
-- the group-flush handler (one round-trip instead of N).
CREATE OR REPLACE FUNCTION notifications.fn_alert_instance_get_batch(
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
    last_triggered_at    TIMESTAMPTZ,
    active_since         TIMESTAMPTZ
)
LANGUAGE sql
AS $$
    SELECT
        i.id, i.organization_id, i.rule_id, i.rule_kind, i.state,
        i.severity, i.title, i.message,
        i.source_subject_type, i.source_subject_id,
        i.last_triggered_at, i.active_since
    FROM notifications.alert_instances i
    WHERE i.id = ANY(p_alert_ids);
$$;

-- fn_delivery_job_for_group — resolve the delivery_jobs row for each
-- (alert_id × endpoint_id) membership entry so the flush can enqueue a
-- delivery_send per job. Jobs were created by fn_delivery_job_create_batch
-- when the alert landed; grouping just defers when we enqueue them.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_for_group(
    p_alert_ids   INTEGER[],
    p_endpoint_id INTEGER
)
RETURNS TABLE (
    id           INTEGER,
    endpoint_id  INTEGER,
    provider     VARCHAR
)
LANGUAGE sql
AS $$
    SELECT j.id, j.endpoint_id, e.provider
    FROM notifications.delivery_jobs j
    JOIN notifications.integration_endpoints e ON e.id = j.endpoint_id
    WHERE j.alert_id = ANY(p_alert_ids)
      AND j.endpoint_id = p_endpoint_id
      AND j.state = 'queued';
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_for_group(INTEGER[], INTEGER);
DROP FUNCTION IF EXISTS notifications.fn_alert_instance_get_batch(INTEGER[]);
