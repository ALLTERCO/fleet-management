--------------UP
-- Bound the last-value seed to the newest day of device.status so the
-- planner excludes the older, compressed chunks. The seed only runs for a
-- device's connect-time snapshot; a value older than the window is treated
-- as unknown, which yields no delta rather than a wrong one.
CREATE OR REPLACE FUNCTION device.fn_status_last_values(
    p_id INT,
    p_fields VARCHAR(100)[]
)
RETURNS TABLE (
    field VARCHAR(100),
    last_value NUMERIC(28, 8)
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (s.field)
        s.field,
        s."value" AS last_value
    FROM device.status s
    WHERE s.id = p_id
      AND s.field = ANY(p_fields)
      AND s.ts > now() - INTERVAL '24 hours'
    ORDER BY s.field, s.ts DESC;
END;
$$
LANGUAGE plpgsql STABLE;
--------------DOWN
CREATE OR REPLACE FUNCTION device.fn_status_last_values(
    p_id INT,
    p_fields VARCHAR(100)[]
)
RETURNS TABLE (
    field VARCHAR(100),
    last_value NUMERIC(28, 8)
)
AS
$$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (s.field)
        s.field,
        s."value" AS last_value
    FROM device.status s
    WHERE s.id = p_id
      AND s.field = ANY(p_fields)
    ORDER BY s.field, s.ts DESC;
END;
$$
LANGUAGE plpgsql STABLE;
