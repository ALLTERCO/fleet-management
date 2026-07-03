--------------UP
-- Read side of the 15-minute rollup. Same return shape and call convention as
-- device_em.fn_report_stats[_paged] / _by_phase[_paged], but reads the
-- pre-aggregated device_em.energy_15min and re-buckets up to the requested
-- interval (p_bucket must be >= 15 min). Energy-delta tags re-sum; instantaneous
-- tags re-average via SUM(sum_val)/SUM(sample_count). The repository routes
-- buckets < 15 min to the raw functions and 15 min+ to these.

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.bucket)        AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
            THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION)
        END                                              AS agg_value
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_limit      INTEGER DEFAULT NULL,
    p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.bucket)        AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
            THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION)
        END                                              AS agg_value
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    phase     VARCHAR(1),
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.bucket)        AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.phase,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
            THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION)
        END                                              AS agg_value
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_limit      INTEGER DEFAULT NULL,
    p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    phase     VARCHAR(1),
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.bucket)        AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.phase,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
            THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION)
        END                                              AS agg_value
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_by_phase_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_by_phase(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN);
