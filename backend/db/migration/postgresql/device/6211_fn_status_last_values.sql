--------------UP
-- Batched variant of device.fn_status_last_value — returns the last
-- recorded value for every field in p_fields in a single round-trip.
-- Replaces the per-field N+1 in ShellyMessageHandler.processPendingMessages:
-- 5 K reconnects × ~20 fields = ~100 K queries collapses to ~5 K.
--
-- Used by the Redis hot-path layer when the per-device HASH cache is
-- missing (cold start, first connect after restart). Caller hydrates
-- the HASH from the returned rows.

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
    -- For each (id, field) we want the value at MAX(ts). DISTINCT ON is
    -- the planner-cheap way: pick the first row per field after sorting
    -- by ts DESC. Works against the existing index on (id, field, ts).
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
--------------DOWN
DROP FUNCTION IF EXISTS device.fn_status_last_values(INT, VARCHAR(100)[]);
