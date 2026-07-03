--------------UP
-- Convert image_asset_id VARCHAR(255) columns to UUID + FK on
-- device.visual_asset. ON DELETE SET NULL keeps decorations renderable
-- as the device-type default if an asset is removed.

ALTER TABLE device.virtual_device
    ALTER COLUMN image_asset_id TYPE UUID USING image_asset_id::uuid;

ALTER TABLE device.virtual_device
    ADD CONSTRAINT virtual_device_image_asset_fk
    FOREIGN KEY (image_asset_id)
    REFERENCES device.visual_asset(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_virtual_device_image_asset
    ON device.virtual_device(image_asset_id)
    WHERE image_asset_id IS NOT NULL;

ALTER TABLE device.blu_device
    ALTER COLUMN image_asset_id TYPE UUID USING image_asset_id::uuid;

ALTER TABLE device.blu_device
    ADD CONSTRAINT blu_device_image_asset_fk
    FOREIGN KEY (image_asset_id)
    REFERENCES device.visual_asset(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_blu_device_image_asset
    ON device.blu_device(image_asset_id)
    WHERE image_asset_id IS NOT NULL;

--------------DOWN
DROP INDEX IF EXISTS device.idx_blu_device_image_asset;
ALTER TABLE device.blu_device
    DROP CONSTRAINT IF EXISTS blu_device_image_asset_fk;
ALTER TABLE device.blu_device
    ALTER COLUMN image_asset_id TYPE VARCHAR(255) USING image_asset_id::text;

DROP INDEX IF EXISTS device.idx_virtual_device_image_asset;
ALTER TABLE device.virtual_device
    DROP CONSTRAINT IF EXISTS virtual_device_image_asset_fk;
ALTER TABLE device.virtual_device
    ALTER COLUMN image_asset_id TYPE VARCHAR(255) USING image_asset_id::text;
