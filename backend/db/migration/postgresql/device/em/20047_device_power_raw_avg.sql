--------------UP
-- Fine Energy.Query buckets read raw history. Route their active/apparent
-- power through the same coincident device-total SSOT as peaks, rather than
-- averaging phase rows in fn_report_stats.
SET search_path TO device_em, public;

CREATE OR REPLACE FUNCTION device_em.fn_device_power_avg_raw(
    p_devices   INTEGER[],
    p_from      TIMESTAMP WITH TIME ZONE,
    p_to        TIMESTAMP WITH TIME ZONE,
    p_bucket    TEXT,
    p_phase_tag TEXT DEFAULT 'power',
    p_total_tag TEXT DEFAULT 'total_power'
)
RETURNS TABLE (
    bucket TIMESTAMP WITH TIME ZONE,
    device INTEGER,
    avg_w  DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT time_bucket(p_bucket::INTERVAL, p.ts) AS bucket,
           p.device,
           AVG(p.watts) AS avg_w
    FROM device_em.fn_power_instant(
             p_devices, p_from, p_to, p_phase_tag, p_total_tag) p
    GROUP BY 1, p.device
    ORDER BY 1, p.device;
$$;
--------------DOWN
SET search_path TO device_em, public;
DROP FUNCTION IF EXISTS device_em.fn_device_power_avg_raw(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE,
    TEXT, TEXT, TEXT);
