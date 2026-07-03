--------------UP
CREATE OR REPLACE FUNCTION device.fn_status_chart(
    p_device_ids INTEGER[],
    p_field      TEXT,
    p_from       TIMESTAMPTZ,
    p_to         TIMESTAMPTZ,
    p_granularity TEXT DEFAULT 'hour'
)
RETURNS TABLE (
    bucket    TIMESTAMPTZ,
    device_id INTEGER,
    avg_val   NUMERIC,
    min_val   NUMERIC,
    max_val   NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        time_bucket(
            CASE WHEN p_granularity = 'day' THEN INTERVAL '1 day' ELSE INTERVAL '1 hour' END,
            s.ts
        ) AS bucket,
        s.id AS device_id,
        AVG(s.value)::NUMERIC AS avg_val,
        MIN(s.value)::NUMERIC AS min_val,
        MAX(s.value)::NUMERIC AS max_val
    FROM device.status s
    WHERE s.id = ANY(p_device_ids)
        AND s.field = p_field
        AND s.ts >= p_from
        AND s.ts <= p_to
    GROUP BY time_bucket(
        CASE WHEN p_granularity = 'day' THEN INTERVAL '1 day' ELSE INTERVAL '1 hour' END,
        s.ts
    ), s.id
    ORDER BY bucket;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_status_chart(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS device.fn_status_chart(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
