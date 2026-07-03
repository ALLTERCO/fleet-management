--------------UP
-- Min/max tags must aggregate as MIN/MAX, never AVG. The sync stores
-- per-interval extremes under min_voltage/max_voltage/min_current/max_current;
-- averaging them (the prior behaviour) hides real dips/spikes — e.g. EN 50160
-- voltage-band checks reported false compliance because a 200V dip averaged
-- away. Energy tags keep SUM; everything else keeps AVG. Applied to every
-- report-stats reader: raw (device_em.stats) and rollup (device_em.energy_15min,
-- which keeps true min_val/max_val per bucket).

CREATE OR REPLACE FUNCTION device_em.fn_report_stats(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.ts)            AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
                THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION)
        END                                               AS agg_value
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3;
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_paged(
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
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.ts)            AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
                THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION)
        END                                               AS agg_value
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    phase      VARCHAR(1),
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.ts)            AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.phase,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
                THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION)
        END                                               AS agg_value
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4;
END;
$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase_paged(
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
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    phase      VARCHAR(1),
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.ts)            AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.phase,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
                THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION)
        END                                               AS agg_value
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;

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
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
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
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
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
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
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
            WHEN s.tag IN ('min_voltage', 'min_current')
                THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current')
                THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
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
-- Restore the prior AVG-only aggregation (min/max tags averaged).
CREATE OR REPLACE FUNCTION device_em.fn_report_stats(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.val) AS DOUBLE PRECISION) ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.val) AS DOUBLE PRECISION) ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.val) AS DOUBLE PRECISION) ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.val) AS DOUBLE PRECISION) ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
             THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;
