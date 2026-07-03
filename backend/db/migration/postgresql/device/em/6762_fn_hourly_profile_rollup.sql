--------------UP
-- Route fn_hourly_profile to the long-term 15-min rollup instead of raw
-- device_em.stats. Raw stats are dropped after 31 days, so the usage-profile
-- section silently emptied for windows older than that. The rollup's sum_val
-- is the per-bucket energy (additive), so summing it per hour-of-day is exact.

CREATE OR REPLACE FUNCTION device_em.fn_hourly_profile(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_tz      TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
    hour_of_day  INTEGER,
    consumed_kwh DOUBLE PRECISION,
    returned_kwh DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        EXTRACT(HOUR FROM em.bucket AT TIME ZONE p_tz)::INTEGER AS hour_of_day,
        COALESCE(SUM(em.sum_val) FILTER (WHERE em.tag = 'total_act_energy'),     0) / 1000.0
                                                             AS consumed_kwh,
        COALESCE(SUM(em.sum_val) FILTER (WHERE em.tag = 'total_act_ret_energy'), 0) / 1000.0
                                                             AS returned_kwh
    FROM device_em.energy_15min em
    WHERE em.device = ANY(p_devices)
      AND em.bucket >= p_from
      AND em.bucket <  p_to
      AND em.tag IN ('total_act_energy', 'total_act_ret_energy')
    GROUP BY hour_of_day
    ORDER BY hour_of_day;
END;
$$ LANGUAGE plpgsql STABLE;
--------------DOWN
-- Restore the prior raw-stats body (6564) so rollback is reversible.
CREATE OR REPLACE FUNCTION device_em.fn_hourly_profile(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_tz      TEXT DEFAULT 'UTC'
)
RETURNS TABLE (
    hour_of_day  INTEGER,
    consumed_kwh DOUBLE PRECISION,
    returned_kwh DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        EXTRACT(HOUR FROM s.ts AT TIME ZONE p_tz)::INTEGER  AS hour_of_day,
        COALESCE(SUM(s.val) FILTER (WHERE s.tag = 'total_act_energy'),     0) / 1000.0
                                                             AS consumed_kwh,
        COALESCE(SUM(s.val) FILTER (WHERE s.tag = 'total_act_ret_energy'), 0) / 1000.0
                                                             AS returned_kwh
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts   >= p_from
      AND s.ts   <  p_to
      AND s.tag IN ('total_act_energy', 'total_act_ret_energy')
    GROUP BY hour_of_day
    ORDER BY hour_of_day;
END;
$$ LANGUAGE plpgsql STABLE;
