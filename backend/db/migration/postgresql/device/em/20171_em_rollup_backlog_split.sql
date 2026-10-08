-- Split the rollup backlog figure. fn_rollup_dirty_stats counts held keys
-- with ready ones, so its oldest age could be a held key, not a slow worker.
-- This reports ready work apart from held and abandoned work by reason.
-- fn_rollup_dirty_stats stays as it is for existing dashboards.
--------------UP
CREATE OR REPLACE FUNCTION device_em.fn_rollup_backlog_stats()
RETURNS TABLE (
    state TEXT,
    reason TEXT,
    buckets BIGINT,
    oldest_age_seconds DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
    WITH blocked AS MATERIALIZED (
        SELECT CASE WHEN d.abandoned_at IS NULL THEN 'held' ELSE 'abandoned' END AS state,
               d.blocked_reason AS reason,
               count(*)::BIGINT AS buckets,
               EXTRACT(EPOCH FROM now() - min(d.bucket))::DOUBLE PRECISION AS oldest_age_seconds
        FROM device_em.rollup_dirty d
        WHERE d.blocked_at IS NOT NULL
        GROUP BY 1, 2
    )
    -- Ready count is the table estimate less the exact blocked count, so the
    -- read stays cheap however large a catch-up backlog grows.
    SELECT 'ready', NULL::TEXT,
           GREATEST(
               pg_stat_get_live_tuples('device_em.rollup_dirty'::regclass)
                   - (SELECT COALESCE(sum(b.buckets), 0) FROM blocked b),
               0
           )::BIGINT,
           COALESCE(
               EXTRACT(EPOCH FROM now() - (
                   SELECT d.first_dirty FROM device_em.rollup_dirty d
                   WHERE d.blocked_at IS NULL ORDER BY d.id LIMIT 1
               )),
               0
           )::DOUBLE PRECISION
    UNION ALL
    SELECT b.state, b.reason, b.buckets, b.oldest_age_seconds FROM blocked b;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_rollup_backlog_stats();
