--------------UP
-- Sum every tag the classifier declares cumulative, not just the two
-- electricity ones. DELTA_TAGS (backend/src/modules/energyClassifier.ts)
-- lists seven cumulative tags; this SQL summed two and averaged the rest,
-- so a month of 30 m3 read back as the mean 15-minute delta.
-- volume_storage_l is a tank level and volume_flow_m3h is a rate. Both are
-- instantaneous and both keep averaging.
-- Function bodies only. Signatures are unchanged from 6780, so CREATE OR
-- REPLACE lands on the existing functions and no DROP is needed.
--
-- DEPLOYMENT NOTE. Historical non-electric cumulative reports are corrected
-- on read. Previously averaged totals may increase approximately by their
-- sample count; stored measurements are unchanged.
SET search_path TO device_em, public;

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
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
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
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

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
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
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
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy','volume_l','volume_m3','thermal_energy_kwh','charge_ah','discharge_ah') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;
--------------DOWN
-- Restore the electricity-only SUM list. Signatures unchanged.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
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
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
             ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
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
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.ts), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
             ELSE CAST(AVG(s.val) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices) AND s.ts >= p_from AND s.ts < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_paged(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, s.domain ORDER BY 1, 2, 3 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[], p_bucket TEXT,
    p_per_device BOOLEAN DEFAULT TRUE, p_limit INTEGER DEFAULT NULL, p_offset INTEGER DEFAULT 0,
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (bucket TIMESTAMPTZ, device INTEGER, phase VARCHAR(1), tag VARCHAR(30), agg_value DOUBLE PRECISION, domain VARCHAR(16))
AS $$
BEGIN RETURN QUERY
    SELECT time_bucket(p_bucket::interval, s.bucket), CASE WHEN p_per_device THEN s.device ELSE 0 END, s.phase, s.tag,
        CASE WHEN s.tag IN ('total_act_energy','total_act_ret_energy') THEN CAST(SUM(s.sum_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('min_voltage','min_current') THEN CAST(MIN(s.min_val) AS DOUBLE PRECISION)
             WHEN s.tag IN ('max_voltage','max_current') THEN CAST(MAX(s.max_val) AS DOUBLE PRECISION)
             ELSE CAST(SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0) AS DOUBLE PRECISION) END, s.domain
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY 1, 2, 3, 4, s.domain ORDER BY 1, 2, 3, 4 OFFSET COALESCE(p_offset, 0) LIMIT p_limit;
END; $$ LANGUAGE plpgsql STABLE;
