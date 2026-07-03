--------------UP
-- Backstop for databases that recorded the old 6800 before catalog_kind
-- existed. Fresh databases already get this from 6800.
ALTER TABLE device.list ADD COLUMN IF NOT EXISTS catalog_kind TEXT;

COMMENT ON COLUMN device.list.catalog_kind
    IS 'Catalog classification drawn from organization.group_kind or org custom_kinds. NULL = unclassified. Separate from device.list.kind construction type.';

CREATE INDEX IF NOT EXISTS idx_device_list_catalog_kind
    ON device.list (catalog_kind);

--------------DOWN
-- No-op: 6800 owns catalog_kind on fresh databases, so this backstop must not
-- drop it during a partial rollback.
SELECT 1;
