--------------UP
-- Per-hour-of-day load profile (kWh) for the requested device set + window.
-- Returns 24 rows (hour 0-23). Empty hours are absent — caller fills with 0.

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

--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_hourly_profile(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT);
