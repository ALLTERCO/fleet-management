--------------UP
-- Per-channel 15-min energy for the report cost pass, kept at finest grain for
-- local-time tariff windows. Unlike fn_report_stats_rollup (which re-buckets up
-- and groups away channel), this reader preserves channel so the cost layer can
-- classify each 15-min slice against the correct time-of-use tariff per channel.
-- Sums across phase so a monophase Pro 3EM (all readings tagged to one phase)
-- still collapses correctly.

CREATE OR REPLACE FUNCTION device_em.fn_report_energy_15min_by_channel(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_tags    VARCHAR(30)[]
)
RETURNS TABLE (
    bucket    TIMESTAMP WITH TIME ZONE,
    device    INTEGER,
    channel   SMALLINT,
    tag       VARCHAR(30),
    energy_wh DOUBLE PRECISION
)
LANGUAGE sql STABLE
AS $$
    SELECT s.bucket, s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from
      AND s.bucket <  p_to
      AND s.tag    = ANY(p_tags)
    GROUP BY s.bucket, s.device, s.channel, s.tag
    ORDER BY s.bucket, s.device, s.channel, s.tag;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_energy_15min_by_channel(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[]);
