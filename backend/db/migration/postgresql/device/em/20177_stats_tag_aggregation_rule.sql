--------------UP
-- One home in SQL for how a stats tag folds over time, the copy of
-- energyTagAggregation.ts (an integration test keeps them equal). The report
-- functions listed their tags inline, so each new record tag (reactive and
-- fundamental energy, apparent power and neutral current extremes) fell into
-- the average branch. Bodies only: signatures are unchanged. The raw functions
-- without paging now also add volume_returned_m3, as their paged twins did,
-- and the rollup functions get back the represented-channel scope of 20163
-- that 20176 left out (raw ones have it in fn_stats_readings, 20180).
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_stats_tag_aggregation(p_tag TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN p_tag IN ('total_act_energy','total_act_ret_energy','fund_act_energy','fund_act_ret_energy',
                       'lag_react_energy','lead_react_energy','volume_l','volume_m3','volume_returned_m3',
                       'thermal_energy_kwh','charge_ah','discharge_ah') THEN 'sum'
        WHEN p_tag IN ('min_voltage','min_current','min_power','min_apparent_power','min_neutral_current') THEN 'min'
        WHEN p_tag IN ('max_voltage','max_current','max_power','max_apparent_power','max_neutral_current') THEN 'max'
        ELSE 'mean'
    END;
$$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
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
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
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
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
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
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_stats_readings(p_devices, p_from, p_to, p_tags, FALSE) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

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
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
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
        CASE device_em.fn_stats_tag_aggregation(s.tag)
            WHEN 'sum' THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
            WHEN 'min' THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN 'max' THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
            ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
        AND (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
      -- A custom device in the scope owns the source channels it represents (20163).
      AND NOT EXISTS (
          SELECT 1 FROM device_em.fn_represented_energy_sources(p_devices, p_devices) r
           WHERE r.source_device = s.device AND r.source_channel = COALESCE(s.channel, 0)
             AND s.bucket >= r.effective_from AND s.bucket < r.effective_until
             AND device_em.fn_projection_field_covers(r.projection_field, s.tag))
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

--------------DOWN
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
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
            WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
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
             WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
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
            WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
        ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.fn_stats_readings(p_devices, p_from, p_to, p_tags, FALSE) s
    WHERE (p_commodity IS NULL OR s.commodity = p_commodity)
        AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain
    ORDER BY 1, 2, 3, 4, s.domain
    OFFSET COALESCE(p_offset, 0)
    LIMIT p_limit;
END; $function$;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

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
            WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
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
            WHEN s.tag IN ('min_voltage','min_current','min_power') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
            WHEN s.tag IN ('max_voltage','max_current','max_power') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
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

DROP FUNCTION IF EXISTS device_em.fn_stats_tag_aggregation(TEXT);
