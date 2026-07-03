--------------UP
-- Per-BLU decoration parity with virtual_device. Empty visual_json =
-- "no override", renderer falls back to capability-based default.
ALTER TABLE device.blu_device
    ADD COLUMN IF NOT EXISTS visual_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS image_asset_id VARCHAR(255);

--------------DOWN
ALTER TABLE device.blu_device
    DROP COLUMN IF EXISTS image_asset_id,
    DROP COLUMN IF EXISTS visual_json;
