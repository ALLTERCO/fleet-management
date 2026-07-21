--------------UP
-- Preserve independent probes through history reads and expose the number of
-- readings behind each average. The stored 15-minute rollup already has both.
SET search_path TO public;

DROP FUNCTION IF EXISTS device_sensor.fn_numeric_history(VARCHAR, INTEGER[], VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL, INTEGER);

CREATE FUNCTION device_sensor.fn_numeric_history(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_kind            VARCHAR(24),
    p_source          VARCHAR(12),
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ,
    p_bucket          INTERVAL DEFAULT INTERVAL '1 hour',
    p_limit           INTEGER DEFAULT NULL
)
RETURNS TABLE (
    bucket       TIMESTAMPTZ,
    device_id    INTEGER,
    source       VARCHAR(12),
    channel      SMALLINT,
    sample_count BIGINT,
    avg_value    NUMERIC,
    min_value    NUMERIC,
    max_value    NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH allowed AS (
        SELECT id FROM device.list
         WHERE id = ANY(p_device_ids)
           AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )
    SELECT
        time_bucket(p_bucket, r.bucket) AS bucket,
        r.device AS device_id,
        r.source,
        r.channel,
        SUM(r.sample_count)::BIGINT AS sample_count,
        (SUM(r.sum_val) / NULLIF(SUM(r.sample_count), 0))::NUMERIC AS avg_value,
        MIN(r.min_val)::NUMERIC AS min_value,
        MAX(r.max_val)::NUMERIC AS max_value
    FROM device_sensor.numeric_15min r
    JOIN allowed a ON a.id = r.device
    WHERE r.kind = p_kind
      AND (p_source IS NULL OR r.source = p_source)
      AND r.bucket >= p_from
      AND r.bucket <  p_to
    GROUP BY time_bucket(p_bucket, r.bucket), r.device, r.source, r.channel
    ORDER BY bucket, device_id, source, channel NULLS FIRST
    LIMIT p_limit;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_sensor.fn_numeric_history(VARCHAR, INTEGER[], VARCHAR, VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, INTERVAL, INTEGER);

CREATE FUNCTION device_sensor.fn_numeric_history(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_kind            VARCHAR(24),
    p_source          VARCHAR(12),
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ,
    p_bucket          INTERVAL DEFAULT INTERVAL '1 hour',
    p_limit           INTEGER DEFAULT NULL
)
RETURNS TABLE (
    bucket    TIMESTAMPTZ,
    device_id INTEGER,
    source    VARCHAR(12),
    avg_value NUMERIC,
    min_value NUMERIC,
    max_value NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH allowed AS (
        SELECT id FROM device.list
         WHERE id = ANY(p_device_ids)
           AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )
    SELECT
        time_bucket(p_bucket, r.bucket) AS bucket,
        r.device AS device_id,
        r.source,
        (SUM(r.sum_val) / NULLIF(SUM(r.sample_count), 0))::NUMERIC AS avg_value,
        MIN(r.min_val)::NUMERIC AS min_value,
        MAX(r.max_val)::NUMERIC AS max_value
    FROM device_sensor.numeric_15min r
    JOIN allowed a ON a.id = r.device
    WHERE r.kind = p_kind
      AND (p_source IS NULL OR r.source = p_source)
      AND r.bucket >= p_from
      AND r.bucket <  p_to
    GROUP BY time_bucket(p_bucket, r.bucket), r.device, r.source
    ORDER BY bucket
    LIMIT p_limit;
END;
$$;
