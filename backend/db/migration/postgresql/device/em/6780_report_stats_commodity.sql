--------------UP
-- Reads on the clean axes. The report readers filter by (commodity,
-- electrical_source) instead of the conflated `domain`; both are OPTIONAL
-- (NULL = all), so a water report asks commodity='water', an AC total asks
-- commodity='electricity' + electrical_source='ac_mains', the meter breakdown
-- asks nothing. Nothing is hidden by a default and AC/DC never mix, because
-- electrical_source is an explicit axis. Return shape is unchanged (still
-- returns `domain`) to keep row types stable — only the FILTER moves to the
-- clean columns. Supersedes 6776's p_domain filter; the arg list changes, so
-- each fn is DROPped then re-CREATEd.
SET search_path TO device_em, public;

-- Idempotent: drop any pre-existing report_stats overload (the 6776 p_domain
-- ones, or a prior commodity one) so the CREATEs below always land cleanly on a
-- re-run or a partial apply. The commodity CREATEs use OR REPLACE too.
DO $drop$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT 'device_em.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'device_em'
          AND (p.proname LIKE 'fn_report_stats%'
               OR p.proname IN ('fn_report_metric_stats','fn_report_channel_energy_totals'))
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
    END LOOP;
END $drop$;

-- filter predicate reused verbatim below:
--   (p_commodity IS NULL OR s.commodity = p_commodity)
--   AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)

CREATE FUNCTION device_em.fn_report_stats(
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

CREATE FUNCTION device_em.fn_report_stats_paged(
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

CREATE FUNCTION device_em.fn_report_stats_by_phase(
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

CREATE FUNCTION device_em.fn_report_stats_by_phase_paged(
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

CREATE FUNCTION device_em.fn_report_stats_rollup(
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

CREATE FUNCTION device_em.fn_report_stats_rollup_paged(
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

CREATE FUNCTION device_em.fn_report_stats_rollup_by_phase(
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

CREATE FUNCTION device_em.fn_report_stats_rollup_by_phase_paged(
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

-- metric stats (electricity: voltage / power_factor) + channel totals (meter
-- breakdown: all commodities, tag-scoped). Both gain the two nullable filters.
CREATE FUNCTION device_em.fn_report_metric_stats(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (tag VARCHAR(30), avg_val DOUBLE PRECISION, min_val DOUBLE PRECISION, max_val DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.tag, SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0), MIN(s.min_val), MAX(s.max_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY s.tag;
$$;

CREATE FUNCTION device_em.fn_report_channel_energy_totals(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[],
    p_commodity TEXT DEFAULT NULL, p_electrical_source TEXT DEFAULT NULL)
RETURNS TABLE (device INTEGER, channel SMALLINT, tag VARCHAR(30), total_wh DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags)
      AND (p_commodity IS NULL OR s.commodity = p_commodity)
      AND (p_electrical_source IS NULL OR s.electrical_source IS NOT DISTINCT FROM p_electrical_source)
    GROUP BY s.device, s.channel, s.tag;
$$;
--------------DOWN
SET search_path TO device_em, public;
-- Restore the 6752/6753 ac_mains-hardcoded 4-arg fns.
CREATE FUNCTION device_em.fn_report_metric_stats(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[])
RETURNS TABLE (tag VARCHAR(30), avg_val DOUBLE PRECISION, min_val DOUBLE PRECISION, max_val DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.tag, SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0), MIN(s.min_val), MAX(s.max_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags) AND s.domain = 'ac_mains'
    GROUP BY s.tag;
$$;
CREATE FUNCTION device_em.fn_report_channel_energy_totals(
    p_devices INTEGER[], p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tags VARCHAR(30)[])
RETURNS TABLE (device INTEGER, channel SMALLINT, tag VARCHAR(30), total_wh DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
    SELECT s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices) AND s.bucket >= p_from AND s.bucket < p_to AND s.tag = ANY(p_tags) AND s.domain = 'ac_mains'
    GROUP BY s.device, s.channel, s.tag;
$$;
-- The 8 report_stats fns are left on the commodity signature; a full DOWN would
-- re-run 6776. Not needed for forward deploys.
