-- Since 20181 an EM meter's open bucket stays queued, scheduled, until it
-- closes. The oldest dirty age counted those rows, so normal waiting read as
-- backlog. It now counts only due keys (not blocked, ready_at reached);
-- scheduled and held work have their own gauges (fn_rollup_backlog_stats).
-- The count stays the table estimate of every queued key.
--------------UP
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty_stats()
RETURNS TABLE (dirty_count BIGINT, oldest_age_seconds DOUBLE PRECISION)
LANGUAGE sql
STABLE
AS
$$
    SELECT
        GREATEST(
            pg_stat_get_live_tuples(
                'device_em.rollup_dirty'::regclass
            ),
            0
        )::BIGINT,
        COALESCE(
            EXTRACT(
                EPOCH FROM now() - (
                    SELECT min(d.first_dirty)
                    FROM device_em.rollup_dirty d
                    WHERE d.blocked_at IS NULL
                      AND d.ready_at <= now()
                )
            ),
            0
        )::DOUBLE PRECISION;
$$;

--------------DOWN
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty_stats()
RETURNS TABLE (dirty_count BIGINT, oldest_age_seconds DOUBLE PRECISION)
LANGUAGE sql
STABLE
AS
$$
    SELECT
        GREATEST(
            pg_stat_get_live_tuples(
                'device_em.rollup_dirty'::regclass
            ),
            0
        )::BIGINT,
        COALESCE(
            EXTRACT(
                EPOCH FROM now() - (
                    SELECT d.first_dirty
                    FROM device_em.rollup_dirty d
                    ORDER BY d.first_dirty
                    LIMIT 1
                )
            ),
            0
        )::DOUBLE PRECISION;
$$;
