--------------UP
-- True peak power (W) for a report window: MAX of per-bucket max_val across all
-- devices. The rollup stores max_val = highest raw reading in that 15-min window,
-- so this gives the real peak — not a smoothed bucket average. Preserved forever
-- in the rollup even after raw stats expire.

CREATE OR REPLACE FUNCTION device_em.fn_report_power_peak(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE
)
RETURNS DOUBLE PRECISION
LANGUAGE sql STABLE
AS $$
    SELECT MAX(s.max_val) FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from AND s.bucket < p_to
      AND s.tag = 'power';
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_power_peak(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
