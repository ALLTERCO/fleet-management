--------------UP
-- Per-device aggregation for Analytics.AttributeWindow brush-to-compare.
-- Reads device_em.stats with the bucket dimension collapsed; one row per
-- device per tag, with the chosen aggregation applied.
DROP FUNCTION IF EXISTS device_em.fn_attribute_window(
    INTEGER[], TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR(30)[], TEXT
);
CREATE FUNCTION device_em.fn_attribute_window(
    p_devices     INTEGER[],
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ,
    p_tags        VARCHAR(30)[],
    p_aggregation TEXT
)
RETURNS TABLE (
    device       INTEGER,
    tag          VARCHAR(30),
    agg_value    DOUBLE PRECISION,
    sample_count INTEGER
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.device                                        AS device,
        s.tag                                           AS tag,
        CASE p_aggregation
            WHEN 'sum'    THEN CAST(SUM(s.val) AS DOUBLE PRECISION)
            WHEN 'avg'    THEN CAST(AVG(s.val) AS DOUBLE PRECISION)
            WHEN 'max'    THEN CAST(MAX(s.val) AS DOUBLE PRECISION)
            WHEN 'latest' THEN (
                SELECT CAST(s2.val AS DOUBLE PRECISION)
                FROM device_em.stats s2
                WHERE s2.device = s.device
                  AND s2.tag = s.tag
                  AND s2.ts >= p_from
                  AND s2.ts <  p_to
                ORDER BY s2.ts DESC
                LIMIT 1
            )
            ELSE CAST(SUM(s.val) AS DOUBLE PRECISION)
        END                                             AS agg_value,
        COUNT(*)::int                                   AS sample_count
    FROM device_em.stats s
    WHERE s.device = ANY(p_devices)
      AND s.ts >= p_from
      AND s.ts <  p_to
      AND s.tag  = ANY(p_tags)
    GROUP BY s.device, s.tag
    ORDER BY s.device, s.tag;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_attribute_window(
    INTEGER[], TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR(30)[], TEXT
);
