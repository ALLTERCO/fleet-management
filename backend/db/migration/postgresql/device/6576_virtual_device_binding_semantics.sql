--------------UP
-- Per-binding role semantics so command routing and the read model can
-- enforce writable/required/value_type without depending on a profile being
-- attached. Populated from the source classifier at binding create time.

SET search_path TO device;

ALTER TABLE device.virtual_device_binding
    ADD COLUMN IF NOT EXISTS value_type           VARCHAR(20),
    ADD COLUMN IF NOT EXISTS writable             BOOLEAN,
    ADD COLUMN IF NOT EXISTS required             BOOLEAN,
    ADD COLUMN IF NOT EXISTS unit                 VARCHAR(40),
    ADD COLUMN IF NOT EXISTS source_snapshot_json JSONB,
    ADD COLUMN IF NOT EXISTS role_metadata_json   JSONB;

ALTER TABLE device.virtual_device_binding
    DROP CONSTRAINT IF EXISTS virtual_device_binding_value_type_valid;
ALTER TABLE device.virtual_device_binding
    ADD CONSTRAINT virtual_device_binding_value_type_valid CHECK (
        value_type IS NULL
        OR value_type IN ('boolean', 'number', 'string', 'event', 'json')
    );

-- Backfill from the source component type so legacy rows keep working.
-- Mirrors the source-classifier defaults for non-remapped component types
-- (BTHome subtype remapping requires the source jdoc and stays for the
-- application path; here we use the simpler component-prefix rule).
WITH classified AS (
    SELECT
        b.id,
        split_part(b.source_component_key, ':', 1) AS component_type
    FROM device.virtual_device_binding b
    WHERE b.value_type IS NULL OR b.writable IS NULL OR b.required IS NULL
)
UPDATE device.virtual_device_binding b
   SET value_type = COALESCE(b.value_type, CASE c.component_type
            WHEN 'boolean' THEN 'boolean'
            WHEN 'switch' THEN 'boolean'
            WHEN 'input' THEN 'boolean'
            WHEN 'button' THEN 'event'
            WHEN 'number' THEN 'number'
            WHEN 'temperature' THEN 'number'
            WHEN 'humidity' THEN 'number'
            WHEN 'illuminance' THEN 'number'
            WHEN 'voltmeter' THEN 'number'
            WHEN 'pm1' THEN 'number'
            WHEN 'em' THEN 'number'
            WHEN 'em1' THEN 'number'
            WHEN 'text' THEN 'string'
            WHEN 'enum' THEN 'string'
            ELSE 'json'
       END),
       writable = COALESCE(b.writable, c.component_type IN (
            'boolean', 'number', 'text', 'enum', 'button',
            'switch', 'light', 'cover', 'rgb', 'rgbw', 'cct', 'rgbcct',
            'bthomecontrol'
       )),
       required = COALESCE(b.required, TRUE)
  FROM classified c
 WHERE b.id = c.id;

--------------DOWN
SET search_path TO device;

ALTER TABLE device.virtual_device_binding
    DROP CONSTRAINT IF EXISTS virtual_device_binding_value_type_valid;
ALTER TABLE device.virtual_device_binding
    DROP COLUMN IF EXISTS value_type,
    DROP COLUMN IF EXISTS writable,
    DROP COLUMN IF EXISTS required,
    DROP COLUMN IF EXISTS unit,
    DROP COLUMN IF EXISTS source_snapshot_json,
    DROP COLUMN IF EXISTS role_metadata_json;
