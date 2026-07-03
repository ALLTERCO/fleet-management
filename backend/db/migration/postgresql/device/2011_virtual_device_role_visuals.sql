--------------UP
ALTER TABLE device.virtual_device_binding
    ADD COLUMN IF NOT EXISTS visual_json JSONB NOT NULL DEFAULT '{}'::jsonb;

--------------DOWN
ALTER TABLE device.virtual_device_binding
    DROP COLUMN IF EXISTS visual_json;
