--------------UP
-- Persisted selector facts for Operations policies. These are identities that
-- have actually been recorded, never inferred from a device model. This lives
-- after the device event log migration because the counter catalog reads it.
SET search_path TO public;

CREATE OR REPLACE FUNCTION device_sensor.fn_operation_source_catalog(
    p_organization_id VARCHAR(120),
    p_device_ids INTEGER[]
)
RETURNS TABLE (
    source_type TEXT,
    device_id INTEGER,
    source VARCHAR(12),
    kind VARCHAR(24),
    channel SMALLINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT
        'numeric'::TEXT,
        n.device,
        n.source,
        n.kind,
        n.channel
      FROM device_sensor.numeric_15min n
      JOIN device.list d ON d.id = n.device
     WHERE n.device = ANY(p_device_ids)
       AND d.organization_id = p_organization_id
       AND n.channel IS NOT NULL
    UNION
    SELECT DISTINCT
        'event'::TEXT,
        e.device,
        e.source,
        e.kind,
        e.channel
      FROM device_sensor.events e
      JOIN device.list d ON d.id = e.device
     WHERE e.device = ANY(p_device_ids)
       AND d.organization_id = p_organization_id
       AND e.channel IS NOT NULL
     ORDER BY 1, 2, 3, 4, 5;
$$;

CREATE OR REPLACE FUNCTION device.fn_operation_counter_catalog(
    p_organization_id VARCHAR(120),
    p_shelly_ids VARCHAR(255)[]
)
RETURNS TABLE (
    shelly_id VARCHAR(255),
    component VARCHAR(64),
    counter_field VARCHAR(128)
)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT e.shelly_id, e.component, e.field
      FROM device.event_log e
     WHERE e.organization_id = p_organization_id
       AND e.shelly_id = ANY(p_shelly_ids)
       AND jsonb_typeof(e.next) = 'number'
       AND (e.next #>> '{}') ~ '^[0-9]+$'
     ORDER BY 1, 2, 3;
$$;

--------------DOWN
DROP FUNCTION IF EXISTS device.fn_operation_counter_catalog(VARCHAR, VARCHAR[]);
DROP FUNCTION IF EXISTS device_sensor.fn_operation_source_catalog(VARCHAR, INTEGER[]);
