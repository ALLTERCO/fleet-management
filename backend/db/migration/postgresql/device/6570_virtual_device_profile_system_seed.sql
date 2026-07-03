--------------UP
-- System profiles (organization_id IS NULL) are shared across every
-- org so the Custom-path wizard has a starter catalog on a fresh org.
-- Loosen the NOT NULL + FK and add a partial unique index so the
-- seeder stays idempotent without colliding with per-org rows.

SET search_path TO device;

ALTER TABLE device.virtual_device_profile
    ALTER COLUMN organization_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS virtual_device_profile_system_key_version
    ON device.virtual_device_profile (key, version)
    WHERE organization_id IS NULL AND deleted_at IS NULL;

--------------DOWN
SET search_path TO device;

DROP INDEX IF EXISTS device.virtual_device_profile_system_key_version;
-- Per-org rows already enforce NOT NULL via app-side checks; restoring
-- the column constraint requires deleting system rows first.
DELETE FROM device.virtual_device_profile WHERE organization_id IS NULL;
ALTER TABLE device.virtual_device_profile
    ALTER COLUMN organization_id SET NOT NULL;
