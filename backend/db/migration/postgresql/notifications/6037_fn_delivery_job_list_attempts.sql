--------------UP
-- Attempts for one delivery job, ordered newest-first for UI display.
-- Org scope is enforced by joining delivery_jobs so a leaked job id
-- from another org still yields zero rows.
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_list_attempts(
    p_organization_id VARCHAR,
    p_job_id          INTEGER
)
RETURNS TABLE (
    id            INTEGER,
    job_id        INTEGER,
    endpoint_id   INTEGER,
    state         VARCHAR,
    attempted_at  TIMESTAMPTZ,
    http_status   INTEGER,
    provider_code VARCHAR,
    error_message TEXT
)
LANGUAGE sql
AS $$
    SELECT
        a.id, a.job_id, a.endpoint_id, a.state, a.attempted_at,
        a.http_status, a.provider_code, a.error_message
    FROM notifications.delivery_attempts a
    JOIN notifications.delivery_jobs j ON j.id = a.job_id
    WHERE j.organization_id = p_organization_id
      AND a.job_id = p_job_id
    ORDER BY a.attempted_at DESC, a.id DESC;
$$;
--------------DOWN
DROP FUNCTION notifications.fn_delivery_job_list_attempts;
