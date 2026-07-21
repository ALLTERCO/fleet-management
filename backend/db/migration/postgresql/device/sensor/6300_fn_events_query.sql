--------------UP
-- Query sensor events (door/motion/presence/button/...). Org-scoped via
-- device.list. Optional kind filter. Newest first.
SET search_path TO public;

CREATE OR REPLACE FUNCTION device_sensor.fn_events_query(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_kind            VARCHAR(24),
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ,
    p_limit           INTEGER DEFAULT NULL
)
RETURNS TABLE (
    ts        TIMESTAMPTZ,
    device_id INTEGER,
    source    VARCHAR(12),
    kind      VARCHAR(24),
    channel   SMALLINT,
    state     SMALLINT
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
    SELECT e.ts, e.device, e.source, e.kind, e.channel, e.state
    FROM device_sensor.events e
    JOIN allowed a ON a.id = e.device
    WHERE (p_kind IS NULL OR e.kind = p_kind)
      AND e.ts >= p_from
      AND e.ts <  p_to
    ORDER BY e.ts DESC
    LIMIT p_limit;
END;
$$;
--------------DOWN
DROP FUNCTION IF EXISTS device_sensor.fn_events_query(VARCHAR, INTEGER[], VARCHAR, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
