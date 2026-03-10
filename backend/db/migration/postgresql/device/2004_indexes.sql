--------------UP
CREATE INDEX IF NOT EXISTS idx_device_list_external_id
    ON device.list (external_id);

CREATE INDEX IF NOT EXISTS idx_device_groups_devices
    ON device.groups USING GIN (devices);
--------------DOWN
DROP INDEX IF EXISTS device.idx_device_list_external_id;
DROP INDEX IF EXISTS device.idx_device_groups_devices;
