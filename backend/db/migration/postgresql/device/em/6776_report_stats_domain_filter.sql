--------------UP
-- Domain-aware Energy.Query aggregation. device_em.stats and the 15-min rollup
-- carry a `domain` column, but every report-stats reader ignored it — so fleet
-- power/voltage aggregates silently mixed dc_battery (bm) rows into ac_mains.
-- Each reader gains a trailing `p_domain TEXT DEFAULT 'ac_mains'`, filters
-- `<alias>.domain = p_domain`, and returns the domain as the last column. DC is
-- opt-in (default ac_mains) so the fix is non-breaking. Covers every function
-- Energy.Query + the streaming export call: raw + rollup, plain + by-phase,
-- unpaged + paged. Adding a RETURNS TABLE column changes the return type, so
-- each is DROPped then re-CREATEd. fn_report_metric_stats /
-- fn_report_channel_energy_totals already hardcode ac_mains and are left alone.

DROP FUNCTION IF EXISTS device_em.fn_report_stats(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_by_phase(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_by_phase_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_by_phase(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_by_phase_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER);

CREATE FUNCTION device_em.fn_report_stats(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION,
    domain     VARCHAR(16)
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
        END                                               AS agg_value,
        s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3;
END;
$$
LANGUAGE plpgsql;

CREATE FUNCTION device_em.fn_report_stats_paged(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_limit      INTEGER DEFAULT NULL,
    p_offset     INTEGER DEFAULT 0,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION,
    domain     VARCHAR(16)
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
        END                                               AS agg_value,
        s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_by_phase(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    phase      VARCHAR(1),
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION,
    domain     VARCHAR(16)
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
        END                                               AS agg_value,
        s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4;
END;
$$
LANGUAGE plpgsql;

CREATE FUNCTION device_em.fn_report_stats_by_phase_paged(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_limit      INTEGER DEFAULT NULL,
    p_offset     INTEGER DEFAULT 0,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    phase      VARCHAR(1),
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION,
    domain     VARCHAR(16)
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
        END                                               AS agg_value,
        s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION,
    domain    VARCHAR(16)
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
        END                                              AS agg_value,
        s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_limit      INTEGER DEFAULT NULL,
    p_offset     INTEGER DEFAULT 0,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION,
    domain    VARCHAR(16)
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
        END                                              AS agg_value,
        s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    phase     VARCHAR(1),
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION,
    domain    VARCHAR(16)
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
        END                                              AS agg_value,
        s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4;
END;
$$
LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_limit      INTEGER DEFAULT NULL,
    p_offset     INTEGER DEFAULT 0,
    p_domain     TEXT DEFAULT 'ac_mains'
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    phase     VARCHAR(1),
    tag       VARCHAR(30),
    agg_value DOUBLE PRECISION,
    domain    VARCHAR(16)
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
        END                                              AS agg_value,
        s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag  = ANY(p_tags)
      AND s.domain = p_domain
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
-- Restore the 6760 signatures (no p_domain, no returned domain column).
DROP FUNCTION IF EXISTS device_em.fn_report_stats(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_by_phase(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_by_phase_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_by_phase(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS device_em.fn_report_stats_rollup_by_phase_paged(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER, TEXT);

CREATE FUNCTION device_em.fn_report_stats(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION device_em.fn_report_stats_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_by_phase(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql;

CREATE FUNCTION device_em.fn_report_stats_by_phase_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices INTEGER[], p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE,
    p_tags VARCHAR(30)[], p_bucket TEXT, p_per_device BOOLEAN DEFAULT TRUE,
    p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (bucket TIMESTAMP WITH TIME ZONE, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION)
AS $$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage', 'min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage', 'max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;
