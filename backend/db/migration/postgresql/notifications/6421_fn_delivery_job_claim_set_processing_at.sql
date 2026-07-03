--------------UP
-- Stamp processing_started_at on claim so fn_delivery_job_reclaim_stranded
-- can detect crash-mid-processing rows. Preserves the 12-column return
-- shape from 6204 (in_quiet_hours, auto_disabled) — OutboxWorker reads both.
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_claim(INTEGER);
CREATE FUNCTION notifications.fn_delivery_job_claim(
    p_id INTEGER
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
    alert_id          INTEGER,
    inbox_item_id     INTEGER,
    endpoint_id       INTEGER,
    provider          VARCHAR,
    endpoint_name     VARCHAR,
    endpoint_enabled  BOOLEAN,
    endpoint_config   JSONB,
    attempt_count     INTEGER,
    in_quiet_hours    BOOLEAN,
    auto_disabled     BOOLEAN
)
LANGUAGE sql
AS $$
    WITH claimed AS (
        UPDATE notifications.delivery_jobs j
        SET state = 'processing', processing_started_at = NOW()
        WHERE j.id = (
            SELECT id
            FROM notifications.delivery_jobs
            WHERE id = p_id AND state = 'queued'
            FOR UPDATE SKIP LOCKED
        )
        RETURNING j.*
    )
    SELECT
        c.id, c.organization_id, c.alert_id, c.inbox_item_id, c.endpoint_id,
        e.provider, e.name AS endpoint_name, e.enabled AS endpoint_enabled,
        e.config AS endpoint_config, c.attempt_count,
        notifications.fn_endpoint_in_quiet_hours(
            e.quiet_hours_start, e.quiet_hours_end, e.quiet_hours_tz
        ) AS in_quiet_hours,
        (e.auto_disabled_at IS NOT NULL) AS auto_disabled
    FROM claimed c
    JOIN notifications.integration_endpoints e ON e.id = c.endpoint_id;
$$;
--------------DOWN
-- Revert to 6204's body: drop the processing_started_at write, keep the
-- 12-column return shape so OutboxWorker continues to function.
DROP FUNCTION IF EXISTS notifications.fn_delivery_job_claim(INTEGER);
CREATE FUNCTION notifications.fn_delivery_job_claim(
    p_id INTEGER
)
RETURNS TABLE (
    id                INTEGER,
    organization_id   VARCHAR,
    alert_id          INTEGER,
    inbox_item_id     INTEGER,
    endpoint_id       INTEGER,
    provider          VARCHAR,
    endpoint_name     VARCHAR,
    endpoint_enabled  BOOLEAN,
    endpoint_config   JSONB,
    attempt_count     INTEGER,
    in_quiet_hours    BOOLEAN,
    auto_disabled     BOOLEAN
)
LANGUAGE sql
AS $$
    WITH claimed AS (
        UPDATE notifications.delivery_jobs j
        SET state = 'processing'
        WHERE j.id = (
            SELECT id
            FROM notifications.delivery_jobs
            WHERE id = p_id AND state = 'queued'
            FOR UPDATE SKIP LOCKED
        )
        RETURNING j.*
    )
    SELECT
        c.id, c.organization_id, c.alert_id, c.inbox_item_id, c.endpoint_id,
        e.provider, e.name AS endpoint_name, e.enabled AS endpoint_enabled,
        e.config AS endpoint_config, c.attempt_count,
        notifications.fn_endpoint_in_quiet_hours(
            e.quiet_hours_start, e.quiet_hours_end, e.quiet_hours_tz
        ) AS in_quiet_hours,
        (e.auto_disabled_at IS NOT NULL) AS auto_disabled
    FROM claimed c
    JOIN notifications.integration_endpoints e ON e.id = c.endpoint_id;
$$;
