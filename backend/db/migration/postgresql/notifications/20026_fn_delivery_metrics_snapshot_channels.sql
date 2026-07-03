--------------UP
-- fn_delivery_metrics_snapshot was created before notifications.integration_endpoints
-- was renamed to notifications.channels (migration 20021), so its endpoint_stats
-- CTE still reads the old table and errors on every metrics poll. Repoint that one
-- reference. (20025 did the same repair for fn_delivery_job_for_group.)
DROP FUNCTION IF EXISTS notifications.fn_delivery_metrics_snapshot();
CREATE OR REPLACE FUNCTION notifications.fn_delivery_metrics_snapshot()
RETURNS TABLE(
    queued_count                 bigint,
    processing_count             bigint,
    dead_letter_count            bigint,
    failed_count                 bigint,
    oldest_queued_age_ms         bigint,
    attempts_15m                 bigint,
    failed_attempts_15m          bigint,
    terminal_latency_avg_ms      bigint,
    disabled_endpoint_count      bigint,
    auto_disabled_endpoint_count bigint
)
LANGUAGE sql
STABLE
AS $$
WITH job_stats AS (
    SELECT
        COUNT(*) FILTER (WHERE state = 'queued')      AS queued_count,
        COUNT(*) FILTER (WHERE state = 'processing')  AS processing_count,
        COUNT(*) FILTER (WHERE state = 'dead_letter') AS dead_letter_count,
        COUNT(*) FILTER (WHERE state = 'failed')      AS failed_count,
        MIN(created_at) FILTER (WHERE state = 'queued') AS oldest_queued_at
    FROM notifications.delivery_jobs
),
attempt_stats AS (
    SELECT
        COUNT(*) AS attempts_15m,
        COUNT(*) FILTER (WHERE state = 'failed') AS failed_attempts_15m
    FROM notifications.delivery_attempts
    WHERE attempted_at >= NOW() - INTERVAL '15 minutes'
),
latency_stats AS (
    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)::BIGINT
        AS terminal_latency_avg_ms
    FROM notifications.delivery_jobs
    WHERE completed_at >= NOW() - INTERVAL '15 minutes'
      AND state IN ('succeeded', 'failed', 'dead_letter')
      AND completed_at IS NOT NULL
),
endpoint_stats AS (
    SELECT
        COUNT(*) FILTER (WHERE enabled = FALSE OR auto_disabled_at IS NOT NULL)
            AS disabled_endpoint_count,
        COUNT(*) FILTER (WHERE auto_disabled_at IS NOT NULL)
            AS auto_disabled_endpoint_count
    FROM notifications.channels
)
SELECT
    COALESCE(job_stats.queued_count, 0),
    COALESCE(job_stats.processing_count, 0),
    COALESCE(job_stats.dead_letter_count, 0),
    COALESCE(job_stats.failed_count, 0),
    COALESCE(
        EXTRACT(EPOCH FROM (NOW() - job_stats.oldest_queued_at))::BIGINT * 1000,
        0
    ),
    COALESCE(attempt_stats.attempts_15m, 0),
    COALESCE(attempt_stats.failed_attempts_15m, 0),
    COALESCE(latency_stats.terminal_latency_avg_ms, 0),
    COALESCE(endpoint_stats.disabled_endpoint_count, 0),
    COALESCE(endpoint_stats.auto_disabled_endpoint_count, 0)
FROM job_stats
CROSS JOIN attempt_stats
CROSS JOIN latency_stats
CROSS JOIN endpoint_stats;
$$;

--------------DOWN
-- 20021 dropped notifications.integration_endpoints, so the pre-rename body
-- cannot be restored (a LANGUAGE sql function referencing a missing table
-- fails to create). The DOWN re-asserts the corrected definition.
DROP FUNCTION IF EXISTS notifications.fn_delivery_metrics_snapshot();
CREATE OR REPLACE FUNCTION notifications.fn_delivery_metrics_snapshot()
RETURNS TABLE(
    queued_count                 bigint,
    processing_count             bigint,
    dead_letter_count            bigint,
    failed_count                 bigint,
    oldest_queued_age_ms         bigint,
    attempts_15m                 bigint,
    failed_attempts_15m          bigint,
    terminal_latency_avg_ms      bigint,
    disabled_endpoint_count      bigint,
    auto_disabled_endpoint_count bigint
)
LANGUAGE sql
STABLE
AS $$
WITH job_stats AS (
    SELECT
        COUNT(*) FILTER (WHERE state = 'queued')      AS queued_count,
        COUNT(*) FILTER (WHERE state = 'processing')  AS processing_count,
        COUNT(*) FILTER (WHERE state = 'dead_letter') AS dead_letter_count,
        COUNT(*) FILTER (WHERE state = 'failed')      AS failed_count,
        MIN(created_at) FILTER (WHERE state = 'queued') AS oldest_queued_at
    FROM notifications.delivery_jobs
),
attempt_stats AS (
    SELECT
        COUNT(*) AS attempts_15m,
        COUNT(*) FILTER (WHERE state = 'failed') AS failed_attempts_15m
    FROM notifications.delivery_attempts
    WHERE attempted_at >= NOW() - INTERVAL '15 minutes'
),
latency_stats AS (
    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)::BIGINT
        AS terminal_latency_avg_ms
    FROM notifications.delivery_jobs
    WHERE completed_at >= NOW() - INTERVAL '15 minutes'
      AND state IN ('succeeded', 'failed', 'dead_letter')
      AND completed_at IS NOT NULL
),
endpoint_stats AS (
    SELECT
        COUNT(*) FILTER (WHERE enabled = FALSE OR auto_disabled_at IS NOT NULL)
            AS disabled_endpoint_count,
        COUNT(*) FILTER (WHERE auto_disabled_at IS NOT NULL)
            AS auto_disabled_endpoint_count
    FROM notifications.channels
)
SELECT
    COALESCE(job_stats.queued_count, 0),
    COALESCE(job_stats.processing_count, 0),
    COALESCE(job_stats.dead_letter_count, 0),
    COALESCE(job_stats.failed_count, 0),
    COALESCE(
        EXTRACT(EPOCH FROM (NOW() - job_stats.oldest_queued_at))::BIGINT * 1000,
        0
    ),
    COALESCE(attempt_stats.attempts_15m, 0),
    COALESCE(attempt_stats.failed_attempts_15m, 0),
    COALESCE(latency_stats.terminal_latency_avg_ms, 0),
    COALESCE(endpoint_stats.disabled_endpoint_count, 0),
    COALESCE(endpoint_stats.auto_disabled_endpoint_count, 0)
FROM job_stats
CROSS JOIN attempt_stats
CROSS JOIN latency_stats
CROSS JOIN endpoint_stats;
$$;
