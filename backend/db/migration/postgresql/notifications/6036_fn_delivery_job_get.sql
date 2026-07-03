--------------UP
-- Fetch one delivery job by id within an organization.
-- Callers must enforce `organization_id` so the FK is scoped.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_get(
    p_organization_id VARCHAR,
    p_id              INTEGER
)
RETURNS TABLE (
    id              INTEGER,
    organization_id VARCHAR,
    alert_id        INTEGER,
    inbox_item_id   INTEGER,
    endpoint_id     INTEGER,
    state           VARCHAR,
    created_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    attempt_count   INTEGER
)
LANGUAGE sql
AS $$
    SELECT
        j.id, j.organization_id, j.alert_id, j.inbox_item_id, j.endpoint_id,
        j.state, j.created_at, j.completed_at, j.attempt_count
    FROM notifications.delivery_jobs j
    WHERE j.organization_id = p_organization_id
      AND j.id = p_id;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_delivery_job_get;
