--------------UP
-- Route fn_data_quality to the long-term 15-min rollup instead of raw
-- device_em.stats. Raw stats are dropped after 31 days (6745), so over a
-- report window older than that the coverage score read 0% and raised a
-- spurious "data degraded" anomaly. The rollup retains long-term and is
-- maintained as data arrives, so coverage is correct for any window.

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
    -- Count calendar buckets in the window. EXTRACT(EPOCH '1 month') = 30 days
    -- mis-scores 31-day months; generate_series at the interval is calendar-correct.
    v_expected := GREATEST(
        1,
        (
            SELECT COUNT(*)::INTEGER
            FROM generate_series(
                time_bucket(p_bucket::interval, p_from),
                time_bucket(p_bucket::interval, p_to - INTERVAL '1 microsecond'),
                p_bucket::interval
            )
        )
    );

    RETURN QUERY
    WITH dist AS (
        SELECT
            em.device                                 AS device,
            COUNT(DISTINCT time_bucket(p_bucket::interval, em.bucket))::INTEGER
                                                      AS actual_buckets
        FROM device_em.energy_15min em
        WHERE em.device = ANY(p_devices)
          AND em.bucket >= p_from
          AND em.bucket <  p_to
          AND em.tag    = 'total_act_energy'
        GROUP BY em.device
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
-- Restore the prior raw-stats body (6562) so rollback is reversible.
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
