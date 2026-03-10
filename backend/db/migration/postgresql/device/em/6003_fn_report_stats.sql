--------------UP
CREATE FUNCTION device_em.fn_report_stats(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    tag        VARCHAR(30),
    agg_value  DOUBLE PRECISION
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(p_bucket::interval, s.ts)            AS bucket,
        CASE WHEN p_per_device THEN s.device ELSE 0 END  AS device,
        s.tag,
        CASE
            WHEN s.tag IN ('total_act_energy', 'total_act_ret_energy')
            THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            ELSE CAST(AVG(s.val) AS DOUBLE PRECISION)
        END                                               AS agg_value
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3;
END;
$$
LANGUAGE plpgsql;
--------------DOWN
DROP FUNCTION device_em.fn_report_stats;
