--------------UP
-- An alert's delivery jobs and delivery group commit with the alert, but the
-- flush that sends them is queued after the commit. A crash or a failed queue
-- add in between leaves the jobs 'queued' with nothing to send them, and a
-- later identical fire changes nothing, so it never repairs them.
--
-- fn_delivery_group_unflushed_list returns the groups of jobs that were never
-- claimed and are older than the sweep's age, newest group per job, oldest
-- jobs first. The flush rebuilds every payload from the database, and a send
-- claims its job only while it is 'queued', so a second flush of the same
-- group cannot send a job twice.
SET search_path TO notifications, public;

-- Only never-claimed alert jobs, so the sweep reads a near-empty index.
CREATE INDEX IF NOT EXISTS delivery_jobs_unclaimed_alert
    ON notifications.delivery_jobs (created_at)
    WHERE state = 'queued'
      AND attempt_count = 0
      AND processing_started_at IS NULL
      AND alert_id IS NOT NULL;

CREATE OR REPLACE FUNCTION notifications.fn_delivery_group_unflushed_list(
    p_min_age_ms INTEGER,
    p_max_age_ms INTEGER,
    p_limit      INTEGER
)
RETURNS TABLE (
    group_id BIGINT
)
LANGUAGE sql STABLE
AS $$
    WITH stale AS (
        SELECT j.id, j.alert_id, j.endpoint_id
        FROM notifications.delivery_jobs j
        WHERE j.state = 'queued'
          AND j.attempt_count = 0
          AND j.processing_started_at IS NULL
          AND j.alert_id IS NOT NULL
          AND j.created_at < NOW() - MAKE_INTERVAL(secs => p_min_age_ms / 1000.0)
          AND j.created_at >= NOW() - MAKE_INTERVAL(secs => p_max_age_ms / 1000.0)
        ORDER BY j.created_at
        LIMIT p_limit
    )
    SELECT DISTINCT newest.group_id
    FROM stale s
    CROSS JOIN LATERAL (
        SELECT m.group_id
        FROM notifications.delivery_group_member m
        WHERE m.alert_id = s.alert_id
          AND m.endpoint_id = s.endpoint_id
        ORDER BY m.added_at DESC, m.group_id DESC
        LIMIT 1
    ) newest;
$$;

--------------DOWN
SET search_path TO notifications, public;

DROP FUNCTION IF EXISTS notifications.fn_delivery_group_unflushed_list(INTEGER, INTEGER, INTEGER);
DROP INDEX IF EXISTS notifications.delivery_jobs_unclaimed_alert;
