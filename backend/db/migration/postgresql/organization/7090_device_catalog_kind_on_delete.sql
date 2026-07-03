--------------UP
-- catalog_kind must survive deletion of an org-owned kind: clear the
-- reference rather than block the cascade (mirrors device.list.organization_id
-- ON DELETE SET NULL). Without this, deleting a profile fails on the FK.
ALTER TABLE device.list DROP CONSTRAINT IF EXISTS device_catalog_kind_fk;
ALTER TABLE device.list
    ADD CONSTRAINT device_catalog_kind_fk
    FOREIGN KEY (catalog_kind) REFERENCES organization.kind(id)
    ON DELETE SET NULL;

--------------DOWN
ALTER TABLE device.list DROP CONSTRAINT IF EXISTS device_catalog_kind_fk;
ALTER TABLE device.list
    ADD CONSTRAINT device_catalog_kind_fk
    FOREIGN KEY (catalog_kind) REFERENCES organization.kind(id);
