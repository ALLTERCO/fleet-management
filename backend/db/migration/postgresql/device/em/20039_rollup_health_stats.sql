--------------UP
CREATE INDEX IF NOT EXISTS rollup_dirty_first_dirty
    ON device_em.rollup_dirty (first_dirty);

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

--------------DOWN
CREATE OR REPLACE FUNCTION device_em.fn_rollup_dirty_stats()
RETURNS TABLE (dirty_count BIGINT, oldest_age_seconds DOUBLE PRECISION)
LANGUAGE sql
STABLE
AS
$$
    SELECT count(*)::BIGINT,
           COALESCE(
               EXTRACT(
                   EPOCH FROM now() - (
                       SELECT d.first_dirty
                       FROM device_em.rollup_dirty d
                       ORDER BY d.id
                       LIMIT 1
                   )
               ),
               0
           )::DOUBLE PRECISION
    FROM device_em.rollup_dirty;
$$;

DROP INDEX IF EXISTS device_em.rollup_dirty_first_dirty;
