--------------UP
SET search_path TO public;

-- Indistinguishable event copies retain their multiplicity without new identities.
CREATE OR REPLACE FUNCTION device.fn_event_log_query(
    p_organization_id TEXT,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_shelly_ids TEXT[],
    p_component TEXT,
    p_kind TEXT,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    ts TIMESTAMPTZ,
    received_ts TIMESTAMPTZ,
    device_id INT,
    shelly_id VARCHAR,
    organization_id VARCHAR,
    component VARCHAR,
    field VARCHAR,
    prev JSONB,
    next JSONB,
    kind VARCHAR,
    source VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.ts, e.received_ts, e.device_id, e.shelly_id,
           e.organization_id, e.component, e.field, e.prev, e.next,
           e.kind, e.source
      FROM device.event_log e
     WHERE (p_organization_id IS NULL
            OR e.organization_id = p_organization_id)
       AND (p_from IS NULL OR e.ts >= p_from)
       AND (p_to IS NULL OR e.ts < p_to)
       AND (
           p_shelly_ids IS NULL
           OR e.device_id IN (
               SELECT d.id
                 FROM device.list d
                WHERE d.external_id = ANY(p_shelly_ids)
                  AND (
                      p_organization_id IS NULL
                      OR d.organization_id = p_organization_id
                  )
           )
           OR (
               e.device_id IS NULL
               AND e.shelly_id = ANY(p_shelly_ids)
           )
       )
       AND (p_component IS NULL OR e.component = p_component)
       AND (p_kind IS NULL OR e.kind = p_kind)
     ORDER BY e.ts DESC, e.received_ts DESC, e.device_id DESC NULLS LAST,
              e.shelly_id, e.organization_id NULLS LAST, e.component, e.field,
              e.prev NULLS LAST, e.next NULLS LAST, e.kind, e.source NULLS LAST
     LIMIT p_limit OFFSET p_offset;
$$;

--------------DOWN
CREATE OR REPLACE FUNCTION device.fn_event_log_query(
    p_organization_id TEXT,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_shelly_ids TEXT[],
    p_component TEXT,
    p_kind TEXT,
    p_limit INT,
    p_offset INT
)
RETURNS TABLE (
    ts TIMESTAMPTZ,
    received_ts TIMESTAMPTZ,
    device_id INT,
    shelly_id VARCHAR,
    organization_id VARCHAR,
    component VARCHAR,
    field VARCHAR,
    prev JSONB,
    next JSONB,
    kind VARCHAR,
    source VARCHAR
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.ts, e.received_ts, e.device_id, e.shelly_id,
           e.organization_id, e.component, e.field, e.prev, e.next,
           e.kind, e.source
      FROM device.event_log e
     WHERE (p_organization_id IS NULL
            OR e.organization_id = p_organization_id)
       AND (p_from IS NULL OR e.ts >= p_from)
       AND (p_to IS NULL OR e.ts < p_to)
       AND (
           p_shelly_ids IS NULL
           OR e.device_id IN (
               SELECT d.id
                 FROM device.list d
                WHERE d.external_id = ANY(p_shelly_ids)
                  AND (
                      p_organization_id IS NULL
                      OR d.organization_id = p_organization_id
                  )
           )
           OR (
               e.device_id IS NULL
               AND e.shelly_id = ANY(p_shelly_ids)
           )
       )
       AND (p_component IS NULL OR e.component = p_component)
       AND (p_kind IS NULL OR e.kind = p_kind)
     ORDER BY e.ts DESC
     LIMIT p_limit OFFSET p_offset;
$$;
