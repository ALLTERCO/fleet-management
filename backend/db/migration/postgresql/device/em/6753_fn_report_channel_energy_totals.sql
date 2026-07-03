--------------UP
-- Per-(device, channel) energy totals over a window, so a PV config can pick a
-- whole device or a single channel (a 3-phase meter run in monophase mode) as
-- the grid or generation meter. Sums the delta-energy tags (total_act_energy,
-- total_act_ret_energy); the caller filters/splits by channel.

CREATE OR REPLACE FUNCTION device_em.fn_report_channel_energy_totals(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE,
    p_tags    VARCHAR(30)[]
)
RETURNS TABLE (device INTEGER, channel SMALLINT, tag VARCHAR(30), total_wh DOUBLE PRECISION)
LANGUAGE sql STABLE
AS $$
    SELECT s.device, s.channel, s.tag, SUM(s.sum_val)
    FROM device_em.energy_15min s
    WHERE s.device = ANY(p_devices)
      AND s.bucket >= p_from AND s.bucket < p_to
      AND s.tag = ANY(p_tags)
      AND s.domain = 'ac_mains'
    GROUP BY s.device, s.channel, s.tag;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_channel_energy_totals(INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, VARCHAR(30)[]);
