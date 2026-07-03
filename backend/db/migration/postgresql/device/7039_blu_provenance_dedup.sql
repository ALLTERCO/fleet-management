--------------UP
-- Dedup existing rows (keep lowest id) then add a unique index so the writer's
-- ON CONFLICT DO NOTHING makes replayed broadcasts idempotent.
DELETE FROM device.blu_sample_provenance a
USING device.blu_sample_provenance b
WHERE a.id > b.id
  AND a.blu_device_list_id = b.blu_device_list_id
  AND a.component_key = b.component_key
  AND a.received_at = b.received_at
  AND a.transport_id IS NOT DISTINCT FROM b.transport_id;

CREATE UNIQUE INDEX IF NOT EXISTS device__blu_sample_provenance_dedup
    ON device.blu_sample_provenance (
        blu_device_list_id, component_key, received_at, transport_id
    ) NULLS NOT DISTINCT;

--------------DOWN
DROP INDEX IF EXISTS device.device__blu_sample_provenance_dedup;
