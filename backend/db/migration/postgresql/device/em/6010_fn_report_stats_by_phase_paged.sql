--------------UP
-- Paged variant of device_em.fn_report_stats_by_phase. Same rationale
-- as fn_report_stats_paged — DB-side LIMIT/OFFSET so Energy.Query
-- doesn't materialise multi-million-row sets just to slice them in Node.

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_by_phase_paged(
    p_devices    INTEGER[],
    p_from       TIMESTAMP WITH TIME ZONE,
    p_to         TIMESTAMP WITH TIME ZONE,
    p_tags       VARCHAR(30)[],
    p_bucket     TEXT,
    p_per_device BOOLEAN DEFAULT TRUE,
    p_limit      INTEGER DEFAULT NULL,
    p_offset     INTEGER DEFAULT 0
)
RETURNS TABLE (
    bucket     TIMESTAMP WITH TIME ZONE,
    device     INTEGER,
    phase      VARCHAR(1),
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
        s.phase,
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
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 2, 3, 4
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_stats_by_phase_paged(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE,
    VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER
);
