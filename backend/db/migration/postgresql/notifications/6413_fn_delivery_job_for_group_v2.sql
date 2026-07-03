--------------UP
-- Bug 1 fix: an alert can fire + state-change multiple times in one
-- group_wait window, producing multiple queued delivery_jobs per
-- (alert, endpoint). Flush now picks only the latest queued job per
-- alert and marks the older rows 'superseded' so the endpoint gets one
-- notification instead of N duplicates, and the audit trail records
-- which jobs were collapsed.

DROP FUNCTION IF EXISTS notifications.fn_delivery_job_for_group(
    INTEGER[], INTEGER
);
CREATE OR REPLACE FUNCTION notifications.fn_delivery_job_for_group(
    p_alert_ids   INTEGER[],
    p_endpoint_id INTEGER
)
RETURNS TABLE (
    id           INTEGER,
    endpoint_id  INTEGER,
    provider     VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_latest_ids INTEGER[];
BEGIN
    -- Pick the latest queued job per alert_id for this endpoint.
    SELECT COALESCE(ARRAY_AGG(t.id), ARRAY[]::INTEGER[])
    INTO v_latest_ids
    FROM (
        SELECT DISTINCT ON (j.alert_id) j.id
        FROM notifications.delivery_jobs j
        WHERE j.alert_id = ANY(p_alert_ids)
          AND j.endpoint_id = p_endpoint_id
          AND j.state = 'queued'
        ORDER BY j.alert_id, j.created_at DESC, j.id DESC
    ) t;

    -- Collapse the older queued siblings so they don't sit forever.
    UPDATE notifications.delivery_jobs
    SET state = 'superseded',
        completed_at = NOW()
    WHERE alert_id = ANY(p_alert_ids)
      AND endpoint_id = p_endpoint_id
      AND state = 'queued'
      AND NOT (id = ANY(v_latest_ids));

    RETURN QUERY
    SELECT j.id, j.endpoint_id, e.provider
    FROM notifications.delivery_jobs j
    JOIN notifications.integration_endpoints e ON e.id = j.endpoint_id
    WHERE j.id = ANY(v_latest_ids);
END;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_for_group(
    INTEGER[], INTEGER
);
-- Restore v1 (unchanged semantics — returns ALL queued, no supersede).
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
