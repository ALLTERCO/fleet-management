--------------UP
-- Widen virtual-device name columns to match the API NAME_SCHEMA (128).
ALTER TABLE device.virtual_device_profile ALTER COLUMN name TYPE VARCHAR(128);
ALTER TABLE device.virtual_device ALTER COLUMN name TYPE VARCHAR(128);
--------------DOWN
ALTER TABLE device.virtual_device_profile ALTER COLUMN name TYPE VARCHAR(120);
ALTER TABLE device.virtual_device ALTER COLUMN name TYPE VARCHAR(120);
