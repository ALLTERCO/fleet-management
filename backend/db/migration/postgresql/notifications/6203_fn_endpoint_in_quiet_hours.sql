--------------UP
-- True if NOW() (converted to the endpoint's timezone) falls inside
-- [quiet_hours_start, quiet_hours_end). Windows that wrap midnight
-- (start > end) are supported. NULL window → never in quiet hours.
CREATE OR REPLACE FUNCTION notifications.fn_endpoint_in_quiet_hours(
    p_start INTEGER,
    p_end   INTEGER,
    p_tz    VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_start IS NULL OR p_end IS NULL THEN FALSE
        WHEN p_start = p_end THEN FALSE
        WHEN p_start < p_end THEN
            EXTRACT(HOUR FROM NOW() AT TIME ZONE p_tz)::INTEGER
                >= p_start
            AND EXTRACT(HOUR FROM NOW() AT TIME ZONE p_tz)::INTEGER
                < p_end
        ELSE
            EXTRACT(HOUR FROM NOW() AT TIME ZONE p_tz)::INTEGER
                >= p_start
            OR EXTRACT(HOUR FROM NOW() AT TIME ZONE p_tz)::INTEGER
                < p_end
    END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS notifications.fn_endpoint_in_quiet_hours(INTEGER, INTEGER, VARCHAR);
