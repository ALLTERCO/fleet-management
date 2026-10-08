--------------UP
SET search_path TO public;

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

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
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
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
        ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
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
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
        ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

--------------DOWN
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
    ORDER BY 1, 2, 3, 4
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

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
    ORDER BY 1, 2, 3
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
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
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
        ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
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
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','volume_returned_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
        ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain
    ORDER BY 1, 2, 3
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;
