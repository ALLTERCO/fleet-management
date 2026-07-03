--------------UP
ALTER TABLE device.list ADD COLUMN IF NOT EXISTS catalog_kind TEXT;
COMMENT ON COLUMN device.list.catalog_kind
    IS 'Catalog classification drawn from organization.group_kind or org custom_kinds. NULL = unclassified. Separate from device.list.kind construction type.';

-- Soft reference only: custom kind ids are org-scoped text values.
CREATE INDEX IF NOT EXISTS idx_device_list_catalog_kind
    ON device.list (catalog_kind);

--------------DOWN
DROP INDEX IF EXISTS device.idx_device_list_catalog_kind;
ALTER TABLE device.list DROP COLUMN IF EXISTS catalog_kind;
