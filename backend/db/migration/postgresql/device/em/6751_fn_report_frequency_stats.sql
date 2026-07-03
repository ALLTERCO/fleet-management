--------------UP
-- Grid-frequency stats for a report window: sample-weighted avg (total sum /
-- total sample count across all rollup buckets) and true extremes (min/max of
-- per-bucket min_val / max_val). The rollup preserves min_val and max_val per
-- 15-min bucket so the extremes are exact even after raw stats expire.

CREATE OR REPLACE FUNCTION device_em.fn_report_frequency_stats(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (avg_hz DOUBLE PRECISION, min_hz DOUBLE PRECISION, max_hz DOUBLE PRECISION)
LANGUAGE sql STABLE
AS $$
    SELECT SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0),
           MIN(s.min_val),
           MAX(s.max_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from AND s.bucket < p_to
      AND s.tag = 'frequency';
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_frequency_stats(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
