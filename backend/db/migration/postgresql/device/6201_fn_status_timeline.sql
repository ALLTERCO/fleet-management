--------------UP
CREATE OR REPLACE FUNCTION device.fn_status_timeline(
    p_device_ids INTEGER[],
    p_field      TEXT,
    p_from       TIMESTAMPTZ,
    p_to         TIMESTAMPTZ
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
    -- Compute LAG over the full retained history up to p_to so that state
    -- at the start of the window is always known, even for stable devices.
    ordered AS (
        SELECT
            s.ts,
            s.id AS device_id,
            s.value,
            LAG(s.value) OVER (PARTITION BY s.id ORDER BY s.ts) AS prev_val
        FROM device.status s
        WHERE s.id = ANY(p_device_ids)
            AND s.field = p_field
            AND s.ts <= p_to
    ),
    -- State-change events only
    changes AS (
        SELECT ts, device_id, value, prev_val
        FROM ordered
        WHERE prev_val IS DISTINCT FROM value OR prev_val IS NULL
    ),
    -- For each device: the most recent state at or before p_from, synthesized
    -- as a row at exactly p_from so the canvas always has an initial segment.
    -- Also handles devices first seen within the window (no pre-window history):
    -- their earliest in-window change is synthesized at p_from so the bar starts
    -- at the left edge instead of leaving an unexplained blank.
    -- Note: DISTINCT ON with ORDER BY must be wrapped in a subquery when used
    -- inside a UNION ALL (PostgreSQL only allows one top-level ORDER BY per union).
    initial AS (
        -- Case 1: device has history before the window — use last known state
        SELECT ts, device_id, value, prev_val FROM (
            SELECT DISTINCT ON (device_id)
                p_from AS ts,
                device_id,
                value,
                NULL::NUMERIC AS prev_val
            FROM changes
            WHERE ts <= p_from
            ORDER BY device_id, ts DESC
        ) pre_window
        UNION ALL
        -- Case 2: device first seen inside the window — synthesize from first event
        SELECT ts, device_id, value, prev_val FROM (
            SELECT DISTINCT ON (c.device_id)
                p_from AS ts,
                c.device_id,
                c.value,
                NULL::NUMERIC AS prev_val
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
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_status_timeline(INTEGER[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
