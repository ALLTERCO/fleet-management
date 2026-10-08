--------------UP
SET search_path TO public;

CREATE OR REPLACE FUNCTION device_sensor.fn_events_query_paged(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_kind            VARCHAR(24),
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ,
    p_limit           INTEGER,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    ts        TIMESTAMPTZ,
    device_id INTEGER,
    source    VARCHAR(12),
    kind      VARCHAR(24),
    channel   SMALLINT,
    state     SMALLINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.ts, e.device, e.source, e.kind, e.channel, e.state
      FROM device_sensor.events e
      JOIN device.list dl ON dl.id = e.device
     WHERE e.device = ANY(p_device_ids)
       AND (p_organization_id IS NULL OR dl.organization_id = p_organization_id)
       AND (p_kind IS NULL OR e.kind = p_kind)
       AND e.ts >= p_from
       AND e.ts < p_to
     ORDER BY e.ts DESC, e.device DESC, e.source DESC, e.kind DESC, e.channel DESC NULLS LAST, e.state DESC
     LIMIT p_limit
    OFFSET GREATEST(p_offset, 0);
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION device_sensor.fn_events_query_paged(
    p_organization_id VARCHAR(120),
    p_device_ids      INTEGER[],
    p_kind            VARCHAR(24),
    p_from            TIMESTAMPTZ,
    p_to              TIMESTAMPTZ,
    p_limit           INTEGER,
    p_offset          INTEGER DEFAULT 0
)
RETURNS TABLE (
    ts        TIMESTAMPTZ,
    device_id INTEGER,
    source    VARCHAR(12),
    kind      VARCHAR(24),
    channel   SMALLINT,
    state     SMALLINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.ts, e.device, e.source, e.kind, e.channel, e.state
      FROM device_sensor.events e
      JOIN device.list dl ON dl.id = e.device
     WHERE e.device = ANY(p_device_ids)
       AND (p_organization_id IS NULL OR dl.organization_id = p_organization_id)
       AND (p_kind IS NULL OR e.kind = p_kind)
       AND e.ts >= p_from
       AND e.ts < p_to
     ORDER BY e.ts DESC, e.device DESC, e.source DESC, e.kind DESC, e.channel DESC NULLS LAST
     LIMIT p_limit
    OFFSET GREATEST(p_offset, 0);
$$;
