--------------UP
-- Per-tag stats over a report window: sample-weighted avg (sum/count) and true
-- min/max (across per-bucket extremes). One row per requested tag with data.
-- Extremes stay exact after raw stats expire — the rollup keeps min/max.

CREATE OR REPLACE FUNCTION device_em.fn_report_metric_stats(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_tags    VARCHAR(30)[]
)
RETURNS TABLE (tag VARCHAR(30), avg_val DOUBLE PRECISION, min_val DOUBLE PRECISION, max_val DOUBLE PRECISION)
LANGUAGE sql STABLE
AS $$
    SELECT s.tag,
           SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0),
           MIN(s.min_val),
           MAX(s.max_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from AND s.bucket < p_to
      AND s.tag = ANY(p_tags)
      AND s.domain = 'ac_mains'
    GROUP BY s.tag;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_metric_stats(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[]);
