--------------UP
-- BTHome gas object IDs 75/76 were historically stored with the same
-- (volume_m3, unspecified, water) identity as valid cubic-metre water meters.
-- The persisted rollup does not retain BTHome obj_id or the configuration
-- snapshot that produced a row, so rewriting that history would guess.
--
-- This bounded diagnostic exposes the ambiguous point/range and the first row
-- that was definitively classified as gas after the forward fix. Operators can
-- repair an explicitly verified meter and period; the migration never relabels
-- data automatically.
CREATE OR REPLACE FUNCTION device_em.fn_volume_history_classification_guard(
    p_devices INTEGER[],
    p_from    TIMESTAMP WITH TIME ZONE,
    p_to      TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    device                    INTEGER,
    channel                   SMALLINT,
    first_ambiguous_bucket    TIMESTAMP WITH TIME ZONE,
    last_ambiguous_bucket     TIMESTAMP WITH TIME ZONE,
    first_valid_gas_bucket    TIMESTAMP WITH TIME ZONE,
    ambiguous_bucket_count    BIGINT,
    ambiguous_volume_m3       DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
AS
$$
BEGIN
    IF p_devices IS NULL OR cardinality(p_devices) = 0 THEN
        RAISE EXCEPTION 'p_devices must contain at least one device';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RAISE EXCEPTION 'p_to must be later than p_from';
    END IF;

    RETURN QUERY
    SELECT
        e.device,
        e.channel,
        MIN(e.bucket) FILTER (
            WHERE e.domain = 'unspecified' AND e.commodity = 'water'
        ),
        MAX(e.bucket) FILTER (
            WHERE e.domain = 'unspecified' AND e.commodity = 'water'
        ),
        MIN(e.bucket) FILTER (
            WHERE e.domain = 'gas' AND e.commodity = 'gas'
        ),
        COUNT(*) FILTER (
            WHERE e.domain = 'unspecified' AND e.commodity = 'water'
        ),
        COALESCE(SUM(e.sum_val) FILTER (
            WHERE e.domain = 'unspecified' AND e.commodity = 'water'
        ), 0)::DOUBLE PRECISION
    FROM device_em.energy_15min e
    WHERE e.device = ANY(p_devices)
      AND e.bucket >= p_from
      AND e.bucket < p_to
      AND e.tag = 'volume_m3'
      AND (
          (e.domain = 'unspecified' AND e.commodity = 'water')
          OR (e.domain = 'gas' AND e.commodity = 'gas')
      )
    GROUP BY e.device, e.channel
    HAVING COUNT(*) FILTER (
        WHERE e.domain = 'unspecified' AND e.commodity = 'water'
    ) > 0
    ORDER BY e.device, e.channel;
END;
$$;

COMMENT ON FUNCTION device_em.fn_volume_history_classification_guard(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE
) IS
    'Reports ambiguous historical m3 volume rows without guessing water versus gas; first_valid_gas_bucket is the defensible gas coverage start.';
--------------DOWN
DROP FUNCTION IF EXISTS device_em.fn_volume_history_classification_guard(
    INTEGER[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE
);
