--------------UP
ALTER TABLE device.list
    ADD COLUMN kind VARCHAR(24) NOT NULL DEFAULT 'physical';

ALTER TABLE device.list
    ADD CONSTRAINT device_list_kind_valid CHECK (
        kind IN ('physical', 'bluetooth', 'extracted', 'composed', 'connector')
    );

CREATE INDEX idx_device_list_kind ON device.list (kind);
CREATE INDEX idx_device_list_org_kind ON device.list (organization_id, kind);
CREATE UNIQUE INDEX idx_device_list_non_physical_external_unique
    ON device.list (external_id)
    WHERE kind <> 'physical' AND external_id IS NOT NULL;

ALTER TABLE device.list
    ADD CONSTRAINT device_list_id_organization_unique UNIQUE (id, organization_id);
--------------DOWN
ALTER TABLE device.list
    DROP CONSTRAINT IF EXISTS device_list_id_organization_unique;

DROP INDEX IF EXISTS device.idx_device_list_non_physical_external_unique;
DROP INDEX IF EXISTS device.idx_device_list_org_kind;
DROP INDEX IF EXISTS device.idx_device_list_kind;

ALTER TABLE device.list
    DROP CONSTRAINT IF EXISTS device_list_kind_valid;

ALTER TABLE device.list
    DROP COLUMN IF EXISTS kind;
