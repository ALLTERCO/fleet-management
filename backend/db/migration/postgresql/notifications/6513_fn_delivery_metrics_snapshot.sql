--------------UP
CREATE OR REPLACE FUNCTION notifications.fn_delivery_metrics_snapshot()
RETURNS TABLE (
    queued_count                 BIGINT,
    processing_count             BIGINT,
    dead_letter_count            BIGINT,
    failed_count                 BIGINT,
    oldest_queued_age_ms         BIGINT,
    attempts_15m                 BIGINT,
    failed_attempts_15m          BIGINT,
    terminal_latency_avg_ms      BIGINT,
    disabled_endpoint_count      BIGINT,
    auto_disabled_endpoint_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH job_stats AS (
    SELECT
        COUNT(*) FILTER (WHERE state = 'queued') AS queued_count,
        COUNT(*) FILTER (WHERE state = 'processing') AS processing_count,
        COUNT(*) FILTER (WHERE state = 'dead_letter') AS dead_letter_count,
        COUNT(*) FILTER (WHERE state = 'failed') AS failed_count,
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
    FROM notifications.integration_endpoints
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
DROP FUNCTION IF EXISTS notifications.fn_delivery_metrics_snapshot();
