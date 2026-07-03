--------------UP
-- Paged variant of device_em.fn_report_stats. Pushes LIMIT / OFFSET
-- into the database so the planner can stop early instead of materialising
-- multi-million-row result sets that the Node tier was going to slice
-- anyway.
--
-- Energy.Query: pass p_limit = (page_size + 1) so the caller can detect
-- "more rows exist" without a second COUNT(*). Reports keep using the
-- unpaged fn_report_stats since they intentionally materialise everything
-- into the CSV stream.

CREATE OR REPLACE FUNCTION device_em.fn_report_stats_paged(
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
    ORDER BY 1, 2, 3
    OFFSET COALESCE(p_offset, 0)
    LIMIT  p_limit;
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_report_stats_paged(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE,
    VARCHAR(30)[], TEXT, BOOLEAN, INTEGER, INTEGER
);
