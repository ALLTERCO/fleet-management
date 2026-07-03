--------------UP
-- Bind device-status SQL functions to an organization. Old signatures dropped
-- so callers cannot bypass tenant filtering.

DROP FUNCTION IF EXISTS device.fn_status_timeline(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION device.fn_status_timeline(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_field           TEXT,
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ
)
RETURNS TABLE (
    ts         TIMESTAMPTZ,
    device_id  INTEGER,
    value      NUMERIC,
    prev_value NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH
    allowed AS (
        SELECT id FROM device.list
         WHERE id = ANY(p_device_ids)
           AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ),
    ordered AS (
        SELECT
            s.ts,
            s.id AS device_id,
            s.value,
            LAG(s.value) OVER (PARTITION BY s.id ORDER BY s.ts) AS prev_val
        FROM device.status s
        WHERE s.id IN (SELECT id FROM allowed)
            AND s.field = p_field
            AND s.ts <= p_to
    ),
    changes AS (
        SELECT ts, device_id, value, prev_val
        FROM ordered
        WHERE prev_val IS DISTINCT FROM value OR prev_val IS NULL
    ),
    initial AS (
        SELECT ts, device_id, value, prev_val FROM (
            SELECT DISTINCT ON (device_id)
                p_from AS ts, device_id, value, NULL::NUMERIC AS prev_val
            FROM changes
            WHERE ts <= p_from
            ORDER BY device_id, ts DESC
        ) pre_window
        UNION ALL
        SELECT ts, device_id, value, prev_val FROM (
            SELECT DISTINCT ON (c.device_id)
                p_from AS ts, c.device_id, c.value, NULL::NUMERIC AS prev_val
            FROM changes c
            WHERE c.ts > p_from
              AND NOT EXISTS (
                    SELECT 1 FROM changes c2
                    WHERE c2.device_id = c.device_id AND c2.ts <= p_from
                )
            ORDER BY c.device_id, c.ts ASC
        ) new_devices
    )
    SELECT ts, device_id, value, prev_val AS prev_value FROM initial
    UNION ALL
    SELECT ts, device_id, value, prev_val AS prev_value FROM changes
    WHERE ts > p_from AND ts <= p_to
    ORDER BY device_id, ts;
END;
$$;

DROP FUNCTION IF EXISTS device.fn_status_chart(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS device.fn_status_chart(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION device.fn_status_chart(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_field           TEXT,
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ,
    p_granularity     TEXT DEFAULT 'hour'
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
    WITH allowed AS (
        SELECT id FROM device.list
         WHERE id = ANY(p_device_ids)
           AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )
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
    WHERE s.id IN (SELECT id FROM allowed)
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

DROP FUNCTION IF EXISTS device.fn_status_environmental_history(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

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

--------------DOWN
DROP FUNCTION IF EXISTS device.fn_status_timeline(VARCHAR, INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS device.fn_status_chart(VARCHAR, INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS device.fn_status_environmental_history(VARCHAR, INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
