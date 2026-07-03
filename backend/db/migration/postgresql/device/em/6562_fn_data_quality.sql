--------------UP
-- Per-device coverage: actual distinct buckets vs the expected count given
-- the requested bucket span. The handler reports the score so users can see
-- when missing data is degrading aggregate accuracy.

CREATE OR REPLACE FUNCTION device_em.fn_data_quality(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_bucket  TEXT
)
RETURNS TABLE (
    device         INTEGER,
    actual_buckets INTEGER,
    expected       INTEGER,
    score          DOUBLE PRECISION
)
AS
$$
DECLARE
    v_expected INTEGER;
BEGIN
    -- Total seconds in the window / seconds per bucket. The handler treats
    -- months as a 30-day approximation when picking the granularity; PG
    -- evaluates the interval arithmetic exactly so we get the true span.
    v_expected := GREATEST(
        1,
        CEIL(
            EXTRACT(EPOCH FROM (p_to - p_from))
            / EXTRACT(EPOCH FROM p_bucket::interval)
        )::INTEGER
    );

    RETURN QUERY
    WITH dist AS (
        SELECT
            s.device                                  AS device,
            COUNT(DISTINCT time_bucket(p_bucket::interval, s.ts))::INTEGER
                                                      AS actual_buckets
        FROM device_em.stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag  = 'total_act_energy'
        GROUP BY s.device
    )
    SELECT
        d                                             AS device,
        COALESCE(dist.actual_buckets, 0)              AS actual_buckets,
        v_expected                                    AS expected,
        LEAST(
            1.0,
            COALESCE(dist.actual_buckets, 0)::DOUBLE PRECISION
                / v_expected::DOUBLE PRECISION
        )                                             AS score
    FROM unnest(p_devices) AS d
    LEFT JOIN dist ON dist.device = d
    ORDER BY d;
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_data_quality(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT
);
