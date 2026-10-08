-- One rule for every raw energy read, the same one the 15-minute rollup uses:
-- in a 15-minute bucket that has device records (em_sync) only those count,
-- and each second counts once (the lowest value, as the rollup takes it). So a
-- 1- or 5-minute total equals the 15-minute total of a closed interval, and a
-- retried commit that stored a row twice is not added twice.
--
-- Readers: the four raw report functions here, the custom-device raw history
-- (historyRepository.ts) and the raw export (streamingExport.ts, logical rows).
--------------UP
-- Whole 15-minute buckets are read so the em_sync choice matches the rollup.
CREATE OR REPLACE FUNCTION device_em.fn_stats_readings(
    p_devices INT[],
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_tags VARCHAR(30)[],
    p_logical BOOLEAN
)
RETURNS TABLE (
    ts TIMESTAMPTZ,
    device INT,
    tag VARCHAR(30),
    domain VARCHAR(16),
    phase VARCHAR(1),
    channel SMALLINT,
    val DOUBLE PRECISION,
    source VARCHAR(16),
    commodity VARCHAR(12),
    electrical_source VARCHAR(16)
)
LANGUAGE sql
STABLE
AS $$
    WITH input AS (
        SELECT s.ts, s.device, s.tag, s.domain, s.phase, s.channel,
               s.val::DOUBLE PRECISION AS val, s.source, s.commodity, s.electrical_source
        FROM device_em.stats s
        WHERE NOT p_logical AND s.device = ANY(p_devices) AND s.tag = ANY(p_tags)
          AND s.ts >= time_bucket(INTERVAL '15 min', p_from)
          AND s.ts < time_bucket(INTERVAL '15 min', p_to - INTERVAL '1 microsecond')
                     + INTERVAL '15 min'
        UNION ALL
        SELECT s.ts, s.device, s.tag, s.domain, s.phase, s.channel,
               s.val, s.source, s.commodity, s.electrical_source
        FROM device_em.logical_stats s
        WHERE p_logical AND s.device = ANY(p_devices) AND s.tag = ANY(p_tags)
          AND s.ts >= time_bucket(INTERVAL '15 min', p_from)
          AND s.ts < time_bucket(INTERVAL '15 min', p_to - INTERVAL '1 microsecond')
                     + INTERVAL '15 min'
    ), gated AS (
        SELECT i.*,
               bool_or(i.source IS NOT DISTINCT FROM 'em_sync') OVER (
                   PARTITION BY i.device, i.tag, i.domain, i.phase, i.channel,
                                time_bucket(INTERVAL '15 min', i.ts)
               ) AS bucket_synced
        FROM input i
    )
    SELECT DISTINCT ON (g.device, g.tag, g.domain, g.phase, g.channel, g.ts)
           g.ts, g.device, g.tag, g.domain, g.phase, g.channel, g.val,
           g.source, g.commodity, g.electrical_source
    FROM gated g
    WHERE (g.source IS NOT DISTINCT FROM 'em_sync' OR NOT g.bucket_synced)
      AND g.ts >= p_from AND g.ts < p_to
    ORDER BY g.device, g.tag, g.domain, g.phase, g.channel, g.ts, g.val;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
             ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_stats_readings(p_devices, p_from, p_to, p_tags, FALSE) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
        ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_stats_readings(p_devices, p_from, p_to, p_tags, FALSE) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
             ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_stats_readings(p_devices, p_from, p_to, p_tags, FALSE) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    phase character varying,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
        ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_stats_readings(p_devices, p_from, p_to, p_tags, FALSE) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

--------------DOWN
CREATE OR REPLACE FUNCTION device_em.fn_report_stats(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
             ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
        ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
             ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase_paged(
    p_devices integer[],
    p_from timestamp with time zone,
    p_to timestamp with time zone,
    p_tags character varying[],
    p_bucket text,
    p_per_device boolean DEFAULT true,
    p_limit integer DEFAULT NULL::integer,
    p_offset integer DEFAULT 0,
    p_commodity text DEFAULT NULL::text,
    p_electrical_source text DEFAULT NULL::text
)
RETURNS TABLE (
    bucket timestamp with time zone,
    device integer,
    phase character varying,
    tag character varying,
    agg_value double precision,
    domain character varying
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
        ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

DROP FUNCTION IF EXISTS device_em.fn_stats_readings(INT[], TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR[], BOOLEAN);
