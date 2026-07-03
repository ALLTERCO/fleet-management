--------------UP
-- Always-on / phantom-load detector. Bins per-device power samples into a
-- rolling window of `p_window` (e.g. 15 minutes), takes the average per
-- window, and returns the SMALLEST resulting average over the period —
-- i.e. the sustained baseline that ran the entire window.
--
-- A pure JS floor over coarser buckets would conflate "off" minutes with
-- night-time idle and miss devices that are always drawing 5-20 W.

CREATE OR REPLACE FUNCTION device_em.fn_always_on(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_window  TEXT DEFAULT '15 minutes'
)
RETURNS TABLE (
    device           INTEGER,
    floor_watts      DOUBLE PRECISION,
    sample_count     INTEGER
)
AS
$$
BEGIN
    RETURN QUERY
    WITH binned AS (
        SELECT
            s.device                                          AS device,
            time_bucket(p_window::interval, s.ts)             AS bucket,
            AVG(s.val)                                        AS avg_watts,
            COUNT(*)::INTEGER                                 AS samples
        FROM device_em.stats s
        WHERE s.device = ANY(p_devices)
          AND s.ts >= p_from
          AND s.ts <  p_to
          AND s.tag  = 'power'
        GROUP BY s.device, bucket
    )
    SELECT
        binned.device                                         AS device,
        MIN(binned.avg_watts)::DOUBLE PRECISION               AS floor_watts,
        SUM(binned.samples)::INTEGER                          AS sample_count
    FROM binned
    GROUP BY binned.device
    ORDER BY binned.device;
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_always_on(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, TEXT
);
