--------------UP
-- Per-device visual decoration ({icon, accent}), next to image_asset_id.
ALTER TABLE device.list
    ADD COLUMN IF NOT EXISTS visual_json JSONB NOT NULL DEFAULT '{}'::jsonb;
--------------DOWN
ALTER TABLE device.list
    DROP COLUMN IF EXISTS visual_json;
