--------------UP
CREATE OR REPLACE FUNCTION device.fn_status_environmental_history(
    p_device_ids INTEGER[],
    p_field_pattern TEXT,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS TABLE (
    bucket TIMESTAMPTZ,
    device_id INTEGER,
    avg_value NUMERIC,
    min_value NUMERIC,
    max_value NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket('1 hour', s.ts) as bucket,
        s.id as device_id,
        AVG(s.value)::NUMERIC as avg_value,
        MIN(s.value)::NUMERIC as min_value,
        MAX(s.value)::NUMERIC as max_value
    FROM device.status s
    WHERE s.id = ANY(p_device_ids)
        AND s.field_group LIKE p_field_pattern
        AND s.ts >= p_from
        AND s.ts <= p_to
    GROUP BY time_bucket('1 hour', s.ts), s.id
    ORDER BY bucket;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_status_environmental_history(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
