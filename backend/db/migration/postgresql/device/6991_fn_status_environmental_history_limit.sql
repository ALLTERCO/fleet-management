--------------UP
-- Add p_limit (NULL = unbounded); drop the old signature.
DROP FUNCTION IF EXISTS device.fn_status_environmental_history(
    VARCHAR, INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION device.fn_status_environmental_history(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_field_pattern   TEXT,
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ,
    p_limit           INTEGER DEFAULT NULL
)
RETURNS TABLE (
    bucket    TIMESTAMPTZ,
    device_id INTEGER,
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
        time_bucket('1 hour', s.ts) as bucket,
        s.id as device_id,
        AVG(s.value)::NUMERIC as avg_value,
        MIN(s.value)::NUMERIC as min_value,
        MAX(s.value)::NUMERIC as max_value
    FROM device.status s
    WHERE s.id IN (SELECT id FROM allowed)
        AND s.field_group LIKE p_field_pattern
        AND s.ts >= p_from
        AND s.ts <= p_to
    GROUP BY time_bucket('1 hour', s.ts), s.id
    ORDER BY bucket
    LIMIT p_limit;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_status_environmental_history(
    VARCHAR, INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER
);

CREATE OR REPLACE FUNCTION device.fn_status_environmental_history(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_field_pattern   TEXT,
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ
)
RETURNS TABLE (
    bucket    TIMESTAMPTZ,
    device_id INTEGER,
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
        time_bucket('1 hour', s.ts) as bucket,
        s.id as device_id,
        AVG(s.value)::NUMERIC as avg_value,
        MIN(s.value)::NUMERIC as min_value,
        MAX(s.value)::NUMERIC as max_value
    FROM device.status s
    WHERE s.id IN (SELECT id FROM allowed)
        AND s.field_group LIKE p_field_pattern
        AND s.ts >= p_from
        AND s.ts <= p_to
    GROUP BY time_bucket('1 hour', s.ts), s.id
    ORDER BY bucket;
END;
$$;
