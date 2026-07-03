--------------UP
-- Add IEC 61850 signal metadata to virtual-component decoration so the
-- report engine knows what AC/DC, quantity, unit and direction each
-- script-emitted component represents. Shape mirrored in
-- src/types/api/measurement.ts (MEASUREMENT_META_SCHEMA).

SET search_path TO device;

ALTER TABLE device.virtual_metadata
    ADD COLUMN IF NOT EXISTS measurement JSONB;

--------------DOWN
SET search_path TO device;
ALTER TABLE device.virtual_metadata
    DROP COLUMN IF EXISTS measurement;
