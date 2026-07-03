--------------UP
-- Repair existing databases whose group-flush helper was created before the
-- notification destination table was renamed to notifications.channels.
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
#variable_conflict use_column
DECLARE
    v_latest_ids INTEGER[];
BEGIN
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

    UPDATE notifications.delivery_jobs
    SET state = 'superseded',
        completed_at = NOW()
    WHERE alert_id = ANY(p_alert_ids)
      AND endpoint_id = p_endpoint_id
      AND state = 'queued'
      AND NOT (id = ANY(v_latest_ids));

    RETURN QUERY
    SELECT j.id, j.endpoint_id, c.provider
    FROM notifications.delivery_jobs j
    JOIN notifications.channels c ON c.id = j.endpoint_id
    WHERE j.id = ANY(v_latest_ids);
END;
$$;

--------------DOWN
-- Restore the previous function body for a single-step rollback.
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
#variable_conflict use_column
DECLARE
    v_latest_ids INTEGER[];
BEGIN
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
