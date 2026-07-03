--------------UP
-- Per-group decoration parity with virtual_device + blu_device. Empty
-- JSONB = "no override"; image_asset_id NULL = "no upload".

ALTER TABLE organization.groups
    ADD COLUMN IF NOT EXISTS visual_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS image_asset_id VARCHAR(255);

--------------DOWN
ALTER TABLE organization.groups
    DROP COLUMN IF EXISTS image_asset_id,
    DROP COLUMN IF EXISTS visual_json;
