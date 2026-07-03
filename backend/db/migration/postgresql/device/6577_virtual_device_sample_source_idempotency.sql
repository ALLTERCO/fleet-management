--------------UP
-- Enforce projection idempotency at the DB layer: one sample-source row
-- per (virtual device, role, binding, source timestamp). Lets the
-- projection service use ON CONFLICT DO NOTHING instead of NOT EXISTS,
-- which closes the race window for concurrent writers.

SET search_path TO device;

CREATE UNIQUE INDEX IF NOT EXISTS
    idx_virtual_device_sample_source_idempotency
    ON device.virtual_device_sample_source (
        virtual_device_list_id,
        role_key,
        binding_id,
        source_ts
    );

--------------DOWN
SET search_path TO device;

DROP INDEX IF EXISTS device.idx_virtual_device_sample_source_idempotency;
